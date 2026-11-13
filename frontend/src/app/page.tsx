"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { api, Product, getToken } from "@/lib/api";
import ProductCard from "@/components/ProductCard";
import { ProductCardSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  Search,
  X,
  SlidersHorizontal,
  MapPin,
  Globe,
  Grid,
  Map as MapIcon,
  BookOpen,
  Laptop,
  Microscope,
  Bike,
  Armchair,
  Dumbbell,
  Package,
  LayoutGrid,
  Loader2,
  Plus,
} from "lucide-react";

const CampusMap = dynamic(() => import("@/components/CampusMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[480px] rounded-md bg-surface-muted flex items-center justify-center text-xs text-text-tertiary">
      Loading campus map…
    </div>
  ),
});

const TYPE_CHIPS = [
  { key: "ALL", label: "All items" },
  { key: "BUY", label: "Buy" },
  { key: "RENT", label: "Rent" },
  { key: "EXCHANGE", label: "Exchange" },
  { key: "DONATE", label: "Donate" },
];

const CATEGORY_CHIPS = [
  { key: "ALL", name: "All", icon: LayoutGrid },
  { key: "Textbooks & Study Material", name: "Textbooks", icon: BookOpen },
  { key: "Electronics & Gadgets", name: "Electronics", icon: Laptop },
  { key: "Lab Equipment & Calculators", name: "Lab kits", icon: Microscope },
  { key: "Cycles & Mobility", name: "Bicycles", icon: Bike },
  { key: "Hostel & Room Essentials", name: "Hostel gear", icon: Armchair },
  { key: "Sports & Fitness", name: "Sports", icon: Dumbbell },
  { key: "Other", name: "Other", icon: Package },
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

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setIsLoggedIn(true);

    const savedCampus =
      typeof window !== "undefined"
        ? localStorage.getItem("px_campus") || localStorage.getItem("preferred_campus") || ""
        : "";
    setSelectedCampus(savedCampus);

    const handleCampusChange = (e: any) => {
      const newCampus =
        e?.detail !== undefined
          ? e.detail
          : localStorage.getItem("px_campus") || localStorage.getItem("preferred_campus") || "";
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
  }, [router]);

  useEffect(() => {
    if (isLoggedIn) {
      api("/products/recommended")
        .then(setRecommended)
        .catch(() => setRecommended([]));
    }
  }, [isLoggedIn]);

  const fetchListings = useCallback(
    (append = false) => {
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
      if (selectedCampus.trim() && selectedCampus !== "ALL") params.append("college", selectedCampus.trim());
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
          const rawItems = Array.isArray(res) ? res : res.items || res;
          const hasItems = Array.isArray(rawItems) && rawItems.length > 0;

          if (!hasItems && !append && useDistanceFilter) {
            const fallbackParams = new URLSearchParams();
            if (query.trim()) fallbackParams.append("q", query.trim());
            if (selectedType !== "ALL") fallbackParams.append("transaction_type", selectedType);
            if (selectedCategory !== "ALL") fallbackParams.append("category", selectedCategory);
            if (selectedCondition !== "ALL") fallbackParams.append("condition", selectedCondition);
            if (selectedCampus.trim() && selectedCampus !== "ALL") fallbackParams.append("college", selectedCampus.trim());
            if (has3DOnly) fallbackParams.append("has_3d", "true");
            if (minPrice.trim()) fallbackParams.append("min_price", minPrice.trim());
            if (maxPrice.trim()) fallbackParams.append("max_price", maxPrice.trim());
            fallbackParams.append("skip", "0");
            fallbackParams.append("limit", String(PAGE_SIZE));

            return api(`/products?${fallbackParams.toString()}`).then((fbRes) => {
              const fbItems = Array.isArray(fbRes) ? fbRes : fbRes.items || [];
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
    },
    [
      useDistanceFilter,
      coords,
      radiusKm,
      query,
      selectedType,
      selectedCategory,
      selectedCondition,
      selectedCampus,
      has3DOnly,
      minPrice,
      maxPrice,
      page,
    ]
  );

  useEffect(() => {
    if (!isLoggedIn) return;
    const timer = setTimeout(() => {
      fetchListings(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    isLoggedIn,
    useDistanceFilter,
    coords,
    radiusKm,
    query,
    selectedType,
    selectedCategory,
    selectedCondition,
    selectedCampus,
    has3DOnly,
    minPrice,
    maxPrice,
  ]);

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
      localStorage.removeItem("px_campus");
    }
    setSelectedCampus("");
  }

  const hasActiveFilters =
    query.trim() !== "" ||
    selectedCategory !== "ALL" ||
    selectedCondition !== "ALL" ||
    minPrice !== "" ||
    maxPrice !== "" ||
    selectedType !== "ALL" ||
    has3DOnly ||
    (selectedCampus !== "" && selectedCampus !== "ALL");

  if (!isLoggedIn) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 text-center px-4">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <p className="text-xs text-text-secondary">Authenticating session…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Campus Scope Notice */}
      {selectedCampus && selectedCampus !== "ALL" && (
        <div className="flex items-center justify-between px-3.5 py-2 rounded-sm bg-surface-muted border border-border text-xs text-text-secondary">
          <span>
            Showing listings for <strong className="text-text">{selectedCampus}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem("px_campus");
              localStorage.removeItem("preferred_campus");
              setSelectedCampus("ALL");
              window.dispatchEvent(new CustomEvent("campusChanged", { detail: "ALL" }));
            }}
            className="text-xs text-primary font-medium hover:underline"
          >
            Show all campuses
          </button>
        </div>
      )}

      {/* Proximity Fallback Notice */}
      {isLocationFallback && (
        <div className="flex items-center justify-between px-3.5 py-2 rounded-sm bg-warning-subtle border border-warning/20 text-xs text-warning">
          <span>
            No listings within {radiusKm} km. Showing campus listings from all colleges.
          </span>
          <button
            type="button"
            onClick={() => {
              setUseDistanceFilter(false);
              setIsLocationFallback(false);
            }}
            className="text-xs font-medium underline"
          >
            Keep all campuses
          </button>
        </div>
      )}

      {/* Sticky Search & Filter Control Bar */}
      <div className="sticky top-14 z-30 bg-bg py-2 space-y-2.5">
        {/* Search Field */}
        <div className="relative">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search textbooks, calculators, bicycles, lab kits…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-9 text-sm bg-surface text-text rounded-sm border border-border focus:border-primary focus:outline-none transition-colors placeholder:text-text-tertiary"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-3 text-text-tertiary hover:text-text p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Horizontally Scrollable Category Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {CATEGORY_CHIPS.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setSelectedCategory(cat.key)}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium shrink-0 border transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-fg border-primary font-semibold"
                    : "bg-surface text-text-secondary border-border hover:border-border-strong hover:text-text"
                }`}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{cat.name}</span>
              </button>
            );
          })}
        </div>

        {/* Secondary Filter Controls Bar */}
        <div className="flex items-center justify-between gap-2 text-xs pt-1">
          {/* Type Filter Chips */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {TYPE_CHIPS.map((type) => {
              const isSelected = selectedType === type.key;
              return (
                <button
                  key={type.key}
                  type="button"
                  onClick={() => setSelectedType(type.key)}
                  className={`h-7 px-2.5 rounded-sm text-xs font-medium shrink-0 transition-colors ${
                    isSelected
                      ? "bg-surface-muted text-text font-semibold border border-border-strong"
                      : "text-text-secondary hover:text-text hover:bg-surface-muted"
                  }`}
                >
                  {type.label}
                </button>
              );
            })}
          </div>

          {/* Filter Drawer Toggle & View Mode Toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 h-7 px-2.5 rounded-sm border text-xs font-medium transition-colors ${
                showFilters || hasActiveFilters
                  ? "bg-surface-muted border-primary text-primary"
                  : "bg-surface border-border text-text-secondary hover:text-text hover:border-border-strong"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filters</span>
              {hasActiveFilters && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>

            {/* Grid / Map toggle */}
            <div className="flex items-center border border-border rounded-sm bg-surface p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                aria-label="Grid view"
                className={`p-1 rounded-xs transition-colors ${
                  viewMode === "grid"
                    ? "bg-surface-muted text-text font-semibold"
                    : "text-text-tertiary hover:text-text"
                }`}
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("map")}
                aria-label="Map view"
                className={`p-1 rounded-xs transition-colors ${
                  viewMode === "map"
                    ? "bg-surface-muted text-text font-semibold"
                    : "text-text-tertiary hover:text-text"
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Expandable Filter Details */}
        {showFilters && (
          <div className="p-3.5 bg-surface border border-border rounded-md space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Location Scope */}
              <div className="space-y-1">
                <span className="text-text-secondary font-medium block">Location scope</span>
                <div className="flex items-center gap-1 border border-border rounded-sm p-0.5 bg-surface-muted">
                  <button
                    type="button"
                    onClick={() => {
                      setUseDistanceFilter(false);
                      setIsLocationFallback(false);
                    }}
                    className={`flex-1 py-1 text-center rounded-xs font-medium transition-colors ${
                      !useDistanceFilter
                        ? "bg-surface text-text font-semibold shadow-xs"
                        : "text-text-secondary hover:text-text"
                    }`}
                  >
                    All campuses
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseDistanceFilter(true)}
                    className={`flex-1 py-1 text-center rounded-xs font-medium transition-colors ${
                      useDistanceFilter
                        ? "bg-surface text-text font-semibold shadow-xs"
                        : "text-text-secondary hover:text-text"
                    }`}
                  >
                    Near me
                  </button>
                </div>
                {useDistanceFilter && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={radiusKm}
                      onChange={(e) => setRadiusKm(Number(e.target.value))}
                      className="w-full"
                    />
                    <span className="text-text font-semibold tabular-nums min-w-[40px]">
                      {radiusKm} km
                    </span>
                  </div>
                )}
              </div>

              {/* Condition */}
              <div className="space-y-1">
                <label className="text-text-secondary font-medium block">Condition</label>
                <select
                  value={selectedCondition}
                  onChange={(e) => setSelectedCondition(e.target.value)}
                  className="w-full h-8 px-2 text-xs bg-surface border border-border rounded-sm focus:border-primary focus:outline-none"
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c === "ALL" ? "All conditions" : c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price range */}
              <div className="space-y-1">
                <label className="text-text-secondary font-medium block">Price range (₹)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    placeholder="Min"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="w-full h-8 px-2 text-xs bg-surface border border-border rounded-sm focus:border-primary focus:outline-none tabular-nums"
                  />
                  <span className="text-text-tertiary">—</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="w-full h-8 px-2 text-xs bg-surface border border-border rounded-sm focus:border-primary focus:outline-none tabular-nums"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary">
                <input
                  type="checkbox"
                  checked={has3DOnly}
                  onChange={(e) => setHas3DOnly(e.target.checked)}
                  className="rounded-xs border-border text-primary focus:ring-primary"
                />
                <span>3D preview only</span>
              </label>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs text-primary font-medium hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Recommended Section (Logged in students) */}
      {isLoggedIn && recommended.length > 0 && !hasActiveFilters && (
        <section aria-label="Recommended items" className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-text uppercase tracking-wider">
              Recommended for you
            </h2>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-none pb-2 -mx-1 px-1">
            {recommended.map((p) => (
              <div key={p.id} className="w-48 sm:w-56 shrink-0">
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Feed Section Header */}
      <div className="flex items-center justify-between pt-1">
        <h2 className="text-sm font-semibold text-text">
          Campus listings
          {!loading && (
            <span className="text-xs font-normal text-text-secondary ml-1.5 tabular-nums">
              ({products.length})
            </span>
          )}
        </h2>
      </div>

      {/* Error State */}
      {error && (
        <ErrorState
          title="Couldn't load listings"
          message={error}
          onRetry={() => fetchListings(false)}
        />
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && products.length === 0 && (
        <EmptyState
          icon={Package}
          title="No listings found"
          description={
            hasActiveFilters
              ? "No items match your filter criteria. Try clearing filters or widening your distance."
              : "No campus listings available at this time."
          }
          actionLabel={hasActiveFilters ? "Clear filters" : "Create first listing"}
          onAction={hasActiveFilters ? resetFilters : () => router.push("/listings/new")}
        />
      )}

      {/* Main Grid or Map Display */}
      {!loading && products.length > 0 && viewMode === "map" ? (
        <div className="rounded-md border border-border overflow-hidden">
          <CampusMap
            products={products}
            userCoords={coords}
            radiusKm={radiusKm}
            height="500px"
          />
        </div>
      ) : !loading && products.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : null}

      {/* Infinite Scroll Sentinel */}
      <div ref={sentinelRef} className="h-12 flex items-center justify-center">
        {loadingMore && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>Loading more listings…</span>
          </div>
        )}
        {!loading && !hasMore && products.length > 0 && (
          <p className="text-xs text-text-tertiary">End of listings</p>
        )}
      </div>
    </div>
  );
}
