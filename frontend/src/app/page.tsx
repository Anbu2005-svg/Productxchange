"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { api, Product, getToken } from "@/lib/api";
import ProductCard from "@/components/ProductCard";
import { ProductCardSkeleton } from "@/components/Skeleton";

const CampusMap = dynamic(() => import("@/components/CampusMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[520px] rounded-2xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-sm text-ink/50 dark:text-stone-400 animate-pulse">
      Loading interactive campus map…
    </div>
  ),
});

const TRANSACTION_TYPES = ["ALL", "BUY", "RENT", "EXCHANGE", "DONATE"];

const TYPE_CHIPS = [
  { key: "ALL", label: "All Items", icon: "✨" },
  { key: "BUY", label: "Buy", icon: "🛒" },
  { key: "EXCHANGE", label: "Swap", icon: "🔄" },
  { key: "RENT", label: "Rent", icon: "⏱️" },
  { key: "DONATE", label: "Free Gifts", icon: "🎁" },
];

const CATEGORIES = [
  "ALL",
  "Textbooks & Study Material",
  "Electronics & Gadgets",
  "Lab Equipment & Calculators",
  "Cycles & Mobility",
  "Hostel & Room Essentials",
  "Sports & Fitness",
  "Other",
];

const CATEGORY_CHIPS = [
  { key: "ALL", name: "All", icon: "✨" },
  { key: "Textbooks & Study Material", name: "Textbooks & Notes", icon: "📚" },
  { key: "Electronics & Gadgets", name: "Tech & Gadgets", icon: "💻" },
  { key: "Lab Equipment & Calculators", name: "Lab Gear", icon: "🔬" },
  { key: "Cycles & Mobility", name: "Cycles", icon: "🚲" },
  { key: "Hostel & Room Essentials", name: "Hostel & Dorm", icon: "🛋️" },
  { key: "Sports & Fitness", name: "Sports", icon: "🏸" },
  { key: "Other", name: "Other", icon: "🎒" },
];

const CONDITIONS = ["ALL", "Brand New", "Like New", "Good", "Fair"];

export default function HomePage() {
  const router = useRouter();
  const [useDistanceFilter, setUseDistanceFilter] = useState(false);
  const [isLocationFallback, setIsLocationFallback] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [recommended, setRecommended] = useState<Product[]>([]);
  const [radiusKm, setRadiusKm] = useState(15);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedCondition, setSelectedCondition] = useState("ALL");
  const [selectedCampus, setSelectedCampus] = useState("");
  const [has3DOnly, setHas3DOnly] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<"grid" | "map">("grid");
  const PAGE_SIZE = 20;

  const sentinelRef = useRef<HTMLDivElement>(null);

  // Request browser geolocation on mount and listen to campus preference
  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setIsLoggedIn(true);

    const savedCampus = typeof window !== "undefined" ? localStorage.getItem("px_campus") || localStorage.getItem("preferred_campus") || "" : "";
    setSelectedCampus(savedCampus);

    const handleCampusChange = (e: any) => {
      const newCampus = e?.detail !== undefined ? e.detail : (localStorage.getItem("px_campus") || localStorage.getItem("preferred_campus") || "");
      setSelectedCampus(newCampus);
    };
    window.addEventListener("campusChanged", handleCampusChange);

    if (!navigator.geolocation) {
      setCoords({ lat: 12.9716, lng: 77.5946 });
      return () => window.removeEventListener("campusChanged", handleCampusChange);
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setCoords({ lat: 12.9716, lng: 77.5946 });
      }
    );

    return () => window.removeEventListener("campusChanged", handleCampusChange);
  }, []);

  // Fetch recommendations if logged in
  useEffect(() => {
    if (isLoggedIn) {
      api("/products/recommended")
        .then(setRecommended)
        .catch(() => setRecommended([]));
    }
  }, [isLoggedIn]);

  const fetchListings = useCallback((append = false) => {
    if (!append) {
      setLoading(true);
      setPage(0);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    const skip = append ? (page + 1) * PAGE_SIZE : 0;
    let url: string;
    const params = new URLSearchParams();

    if (query.trim()) params.append("q", query.trim());
    if (selectedType !== "ALL") params.append("transaction_type", selectedType);
    if (selectedCategory !== "ALL") params.append("category", selectedCategory);
    if (selectedCondition !== "ALL") params.append("condition", selectedCondition);
    if (selectedCampus.trim()) params.append("college", selectedCampus.trim());
    if (has3DOnly) params.append("has_3d", "true");
    if (minPrice.trim()) params.append("min_price", minPrice.trim());
    if (maxPrice.trim()) params.append("max_price", maxPrice.trim());

    if (useDistanceFilter && coords) {
      params.append("lat", String(coords.lat));
      params.append("lng", String(coords.lng));
      params.append("radius_km", String(radiusKm));
      params.append("sort", "distance");
      params.append("offset", String(skip));
      params.append("limit", String(PAGE_SIZE));
      url = `/products/nearby/search?${params.toString()}`;
    } else {
      params.append("skip", String(skip));
      params.append("limit", String(PAGE_SIZE));
      url = `/products?${params.toString()}`;
    }

    api(url)
      .then((res) => {
        const rawItems = Array.isArray(res) ? res : (res.items || res);
        const hasItems = Array.isArray(rawItems) && rawItems.length > 0;

        // If distance search yielded 0 items, fallback to all campus items automatically
        if (!hasItems && !append && useDistanceFilter) {
          const fallbackParams = new URLSearchParams();
          if (query.trim()) fallbackParams.append("q", query.trim());
          if (selectedType !== "ALL") fallbackParams.append("transaction_type", selectedType);
          if (selectedCategory !== "ALL") fallbackParams.append("category", selectedCategory);
          if (selectedCondition !== "ALL") fallbackParams.append("condition", selectedCondition);
          if (selectedCampus.trim()) fallbackParams.append("college", selectedCampus.trim());
          if (has3DOnly) fallbackParams.append("has_3d", "true");
          if (minPrice.trim()) fallbackParams.append("min_price", minPrice.trim());
          if (maxPrice.trim()) fallbackParams.append("max_price", maxPrice.trim());
          fallbackParams.append("skip", "0");
          fallbackParams.append("limit", String(PAGE_SIZE));

          return api(`/products?${fallbackParams.toString()}`).then((fbRes) => {
            const fbItems = Array.isArray(fbRes) ? fbRes : (fbRes.items || []);
            setProducts(fbItems);
            setIsLocationFallback(fbItems.length > 0);
            setHasMore(fbItems.length >= PAGE_SIZE);
          });
        }

        setIsLocationFallback(false);
        if (Array.isArray(res)) {
          if (append) {
            setProducts((prev) => [...prev, ...res]);
          } else {
            setProducts(res);
          }
          setHasMore(res.length >= PAGE_SIZE);
        } else {
          const items = res.items || res;
          if (append) {
            setProducts((prev) => [...prev, ...items]);
          } else {
            setProducts(items);
          }
          setHasMore(res.has_more ?? items.length >= PAGE_SIZE);
        }
        if (append) setPage((p) => p + 1);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  }, [useDistanceFilter, coords, radiusKm, query, selectedType, selectedCategory, selectedCondition, selectedCampus, has3DOnly, minPrice, maxPrice, page]);

  // Refetch when filters change
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchListings(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [useDistanceFilter, coords, radiusKm, query, selectedType, selectedCategory, selectedCondition, selectedCampus, has3DOnly, minPrice, maxPrice]);

  // Infinite Scroll IntersectionObserver (Feature #9)
  useEffect(() => {
    if (!hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchListings(true);
        }
      },
      { rootMargin: "200px" }
    );
    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, fetchListings]);

  function resetFilters() {
    setSelectedType("ALL");
    setSelectedCategory("ALL");
    setSelectedCondition("ALL");
    setMinPrice("");
    setMaxPrice("");
    setQuery("");
    setHas3DOnly(false);
    setUseDistanceFilter(false);
    setIsLocationFallback(false);
    if (typeof window !== "undefined") {
      localStorage.removeItem("preferred_campus");
      setSelectedCampus("");
      window.dispatchEvent(new Event("campusChanged"));
    }
  }

  const hasActiveFilters =
    selectedCategory !== "ALL" ||
    selectedCondition !== "ALL" ||
    minPrice !== "" ||
    maxPrice !== "" ||
    selectedType !== "ALL" ||
    has3DOnly ||
    selectedCampus !== "";

  if (!isLoggedIn) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 text-center px-4 animate-fade-in">
        <div className="w-10 h-10 rounded-full border-3 border-moss border-t-transparent animate-spin" />
        <div className="space-y-1">
          <h3 className="font-bold text-base text-ink dark:text-white">ProductXchange Campus Portal</h3>
          <p className="text-xs text-ink/60 dark:text-stone-400">
            Authentication required. Redirecting to login…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-2">
      {/* Campus Filter Indicator Banner */}
      {selectedCampus && (
        <div className="mb-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-base">🏫</span>
            <span>
              Showing listings exclusively for <strong>{selectedCampus}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem("preferred_campus");
              setSelectedCampus("");
              window.dispatchEvent(new Event("campusChanged"));
            }}
            className="text-xs font-semibold underline hover:text-emerald-700 dark:hover:text-emerald-300"
          >
            Switch to All Campuses
          </button>
        </div>
      )}

      {/* Fallback Location Notice if Near Me found 0 products */}
      {isLocationFallback && (
        <div className="mb-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-base">📍</span>
            <span>
              No listings found within <strong>{radiusKm} km</strong> of your current location. Displaying all available <strong>campus listings across colleges</strong>:
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setUseDistanceFilter(false);
              setIsLocationFallback(false);
            }}
            className="text-xs font-semibold underline hover:text-amber-700 dark:hover:text-amber-300"
          >
            Stay on All Campuses
          </button>
        </div>
      )}

      {/* Campus Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-900/90 via-[#1c2b24] to-[#122019] text-white p-6 sm:p-8 mb-5 shadow-lg border border-emerald-500/20">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-teal-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold uppercase tracking-wider mb-3">
            <span>🌱</span> Campus Peer-to-Peer Economy
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
            Exchange & Discover Essentials Right On <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Your Campus</span>
          </h1>
          <p className="text-xs sm:text-sm text-sand/80 mt-2 leading-relaxed max-w-xl">
            Save money and reduce campus waste. Swap textbooks, lab drafters, electronics, cycles, and hostel gear with verified peers at your college.
          </p>

          <div className="flex flex-wrap items-center gap-3 sm:gap-6 mt-4 pt-4 border-t border-white/10 text-[11px] sm:text-xs text-sand/80 font-medium">
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-400">✓</span> In-Person Campus Handshakes
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-400">✓</span> Zero Platform Fees
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-400">✓</span> 360° Interactive 3D Previews
            </div>
          </div>
        </div>
      </div>

      {/* Category Quick-Select Carousel Ribbon */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto scrollbar-none touch-pan-x pb-1 -mx-1 px-1">
        {CATEGORY_CHIPS.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => setSelectedCategory(cat.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 border ${
              selectedCategory === cat.key
                ? "bg-moss text-white border-moss shadow-sm scale-102"
                : "bg-white/80 dark:bg-stone-900/80 text-ink/70 dark:text-stone-300 border-ink/10 dark:border-white/10 hover:border-moss/40 hover:bg-white dark:hover:bg-stone-800"
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.name}</span>
          </button>
        ))}
      </div>

      {/* Hero Search & Filter Bar */}
      <div className="bg-white/95 dark:bg-[#1a211d]/95 backdrop-blur-xl border border-ink/8 dark:border-white/10 rounded-2xl p-4 sm:p-5 mb-5 sm:mb-6 shadow-sm transition-colors">
        <div className="flex flex-col md:flex-row gap-3 items-stretch">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-3 text-ink/40 dark:text-stone-400 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search books, lab coats, calculators, cycles, hostel items..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full border border-ink/15 dark:border-stone-700 rounded-xl pl-9 pr-8 py-2.5 text-sm text-ink dark:text-white dark:bg-stone-800/80 focus:outline-none focus:border-moss transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-2.5 text-xs text-ink/40 dark:text-stone-400 hover:text-ink dark:hover:text-white p-1"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Transaction Type Filter Pills & 3D Toggle */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none touch-pan-x pb-1 md:pb-0 -mx-1 px-1">
            {TYPE_CHIPS.map((type) => (
              <button
                key={type.key}
                onClick={() => setSelectedType(type.key)}
                className={`text-xs font-semibold px-3 py-2 rounded-xl transition-all shrink-0 flex items-center gap-1.5 ${
                  selectedType === type.key
                    ? "bg-moss text-white shadow-sm"
                    : "bg-sand/60 dark:bg-stone-800 text-ink/70 dark:text-stone-300 hover:bg-sand dark:hover:bg-stone-700"
                }`}
              >
                {type.icon && <span>{type.icon}</span>}
                <span>{type.label}</span>
              </button>
            ))}

            {/* 3D View Only Pill */}
            <button
              onClick={() => setHas3DOnly(!has3DOnly)}
              className={`text-xs font-semibold px-3 py-2 rounded-xl transition-all shrink-0 flex items-center gap-1.5 ${
                has3DOnly
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm ring-1 ring-blue-400"
                  : "bg-sand/60 dark:bg-stone-800 text-ink/70 dark:text-stone-300 hover:bg-sand dark:hover:bg-stone-700"
              }`}
            >
              <span>🧊</span> 3D Only
            </button>

            {/* Filter Toggle Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`text-xs font-semibold px-3 py-2 rounded-xl border transition-all shrink-0 flex items-center gap-1.5 ${
                showFilters || hasActiveFilters
                  ? "bg-moss/10 dark:bg-moss/20 border-moss text-moss dark:text-emerald-300"
                  : "border-ink/15 dark:border-stone-700 text-ink/70 dark:text-stone-300 hover:border-moss"
              }`}
            >
              <span>⚙️</span> Filters {hasActiveFilters && "•"}
            </button>
          </div>
        </div>

        {/* Collapsible Advanced Filters (Feature #3) */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-ink/10 dark:border-stone-800 space-y-3 animate-fade-in text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Category */}
              <div>
                <label className="block font-semibold text-ink/70 dark:text-stone-300 mb-1">Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full border border-ink/20 dark:border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-ink dark:text-white dark:bg-stone-800 focus:outline-none focus:border-moss"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Condition */}
              <div>
                <label className="block font-semibold text-ink/70 dark:text-stone-300 mb-1">Condition</label>
                <select
                  value={selectedCondition}
                  onChange={(e) => setSelectedCondition(e.target.value)}
                  className="w-full border border-ink/20 dark:border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-ink dark:text-white dark:bg-stone-800 focus:outline-none focus:border-moss"
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c === "ALL" ? "All Conditions" : c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price Range */}
              <div className="sm:col-span-2">
                <label className="block font-semibold text-ink/70 dark:text-stone-300 mb-1">Price Range (₹)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Min ₹"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="w-full border border-ink/20 dark:border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-ink dark:text-white dark:bg-stone-800 focus:outline-none focus:border-moss"
                  />
                  <span className="text-ink/40 dark:text-stone-500">—</span>
                  <input
                    type="number"
                    placeholder="Max ₹"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="w-full border border-ink/20 dark:border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-ink dark:text-white dark:bg-stone-800 focus:outline-none focus:border-moss"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedType("DONATE");
                  setMinPrice("0");
                  setMaxPrice("0");
                }}
                className="text-xs text-purple-700 dark:text-purple-300 hover:underline font-semibold"
              >
                🎁 Show Free Donations Only
              </button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs text-clay hover:underline font-semibold"
                >
                  Clear all filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* Location Scope & Proximity Controls */}
        <div className="mt-4 pt-3 border-t border-ink/5 dark:border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-ink/70 dark:text-stone-300 gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink/80 dark:text-stone-200">Location:</span>
            <div className="inline-flex rounded-xl p-0.5 bg-sand/80 dark:bg-stone-800 border border-ink/10 dark:border-stone-700">
              <button
                type="button"
                onClick={() => {
                  setUseDistanceFilter(false);
                  setIsLocationFallback(false);
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  !useDistanceFilter
                    ? "bg-white dark:bg-stone-900 text-moss dark:text-emerald-400 shadow-sm"
                    : "text-ink/60 dark:text-stone-400 hover:text-ink dark:hover:text-white"
                }`}
              >
                🌐 All Campuses
              </button>
              <button
                type="button"
                onClick={() => setUseDistanceFilter(true)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  useDistanceFilter
                    ? "bg-white dark:bg-stone-900 text-moss dark:text-emerald-400 shadow-sm"
                    : "text-ink/60 dark:text-stone-400 hover:text-ink dark:hover:text-white"
                }`}
              >
                📍 Near Me
              </button>
            </div>

            {useDistanceFilter && (
              <div className="flex items-center gap-2 ml-1">
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className="cursor-pointer w-24 accent-moss"
                />
                <strong className="text-moss dark:text-emerald-400 font-semibold">{radiusKm} km</strong>
              </div>
            )}
          </div>

          <span className="text-[11px] text-ink/50 dark:text-stone-400">
            {useDistanceFilter
              ? "Filtering within radius using PostGIS spatial queries"
              : "Showing all items across participating campus colleges"}
          </span>
        </div>
      </div>

      {/* Recommendations Section (Logged-in users only) */}
      {isLoggedIn && recommended.length > 0 && (
        <div className="mb-8 animate-fade-in delay-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-ink dark:text-white flex items-center gap-2">
              <span>✨</span> Recommended for You
            </h2>
          </div>
          <div className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-none touch-pan-x pb-2 -mx-2 px-2 sm:-mx-1 sm:px-1">
            {recommended.map((p) => (
              <div key={p.id} className="w-56 sm:w-64 shrink-0">
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Listing Feed Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-ink dark:text-white flex items-center gap-2">
          <span>Campus Listings</span>
          {!loading && (
            <span className="text-xs font-normal text-ink/50 dark:text-stone-400">({products.length} loaded)</span>
          )}
        </h2>

        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="bg-sand/70 dark:bg-stone-800 p-1 rounded-xl flex items-center gap-1 border border-ink/10 dark:border-stone-700">
            <button
              onClick={() => setViewMode("grid")}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === "grid"
                  ? "bg-white dark:bg-stone-900 text-moss dark:text-emerald-400 shadow-sm"
                  : "text-ink/60 dark:text-stone-400 hover:text-ink dark:hover:text-white"
              }`}
            >
              <span>▦</span> Grid
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === "map"
                  ? "bg-white dark:bg-stone-900 text-moss dark:text-emerald-400 shadow-sm"
                  : "text-ink/60 dark:text-stone-400 hover:text-ink dark:hover:text-white"
              }`}
            >
              <span>🗺️</span> Campus Map
            </button>
          </div>

          <Link
            href="/listings/new"
            className="text-xs font-semibold text-moss dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
          >
            <span>+</span> Post an item
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm rounded-xl mb-4">
          {error}
        </div>
      )}

      {/* Shimmer Skeleton Loading State (Feature #7) */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && products.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-stone-900 border border-ink/10 dark:border-white/10 rounded-2xl p-8 transition-colors">
          <span className="text-4xl">🎒</span>
          <h3 className="font-bold text-base text-ink dark:text-white mt-2">No listings found nearby</h3>
          <p className="text-xs text-ink/60 dark:text-stone-400 mt-1 max-w-sm mx-auto">
            Try expanding your distance radius slider or clearing search filters.
          </p>
          <Link
            href="/listings/new"
            className="mt-4 inline-flex items-center gap-1 bg-moss text-white font-semibold text-xs px-4 py-2 rounded-lg hover:bg-moss/90 transition-colors shadow-sm"
          >
            Be the first to list an item
          </Link>
        </div>
      )}

      {/* Products Content: Grid or Campus Map */}
      {!loading && viewMode === "map" ? (
        <div className="mb-6 animate-fade-in overflow-hidden rounded-2xl border border-ink/10 dark:border-stone-800">
          <CampusMap
            products={products}
            userCoords={coords}
            radiusKm={radiusKm}
            height="480px"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

      {/* Infinite Scroll Sentinel (Feature #9) */}
      <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-6">
        {loadingMore && (
          <div className="flex items-center gap-2 text-xs text-ink/60 dark:text-stone-400 animate-pulse">
            <svg className="animate-spin h-4 w-4 text-moss" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading more campus items…
          </div>
        )}
      </div>
    </div>
  );
}
