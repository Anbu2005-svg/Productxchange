"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSavedProducts, Product, getToken } from "@/lib/api";
import ProductCard from "@/components/ProductCard";
import { ProductCardSkeleton } from "@/components/Skeleton";

export default function SavedProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login?redirect=/saved");
      return;
    }

    getSavedProducts()
      .then((data) => {
        setProducts(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load saved listings");
        setLoading(false);
      });
  }, [router]);

  return (
    <div className="max-w-5xl mx-auto py-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">❤️</span>
            <h1 className="text-2xl font-bold text-ink dark:text-white">Saved Listings & Watchlist</h1>
          </div>
          <p className="text-sm text-ink/70 dark:text-stone-300 mt-1">
            Bookmarked campus items you are interested in. Price drops and updates appear here.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-moss dark:text-emerald-400 hover:underline"
        >
          ← Explore more nearby items
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm rounded-xl mb-4">
          {error}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {[1, 2, 3].map((i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && products.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-stone-900 border border-ink/10 dark:border-white/10 rounded-2xl p-8 transition-colors">
          <span className="text-5xl">🤍</span>
          <h3 className="font-bold text-base text-ink dark:text-white mt-3">Your watchlist is empty</h3>
          <p className="text-xs text-ink/60 dark:text-stone-400 mt-1 max-w-sm mx-auto">
            Tap the heart icon on any product card or listing page to save books, lab gear, and dorm essentials for later.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-sm transition-all"
          >
            <span>🔍</span> Browse Campus Listings
          </Link>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}

