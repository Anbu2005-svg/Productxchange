"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSavedProducts, Product, getToken } from "@/lib/api";
import ProductCard from "@/components/ProductCard";
import SearchAlertSettings from "@/components/SearchAlertSettings";
import { ProductCardSkeleton } from "@/components/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { Bookmark, ArrowLeft } from "lucide-react";

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
    <div className="mx-auto max-w-6xl py-4 sm:py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Saved listings</h1>
          <p className="text-xs text-text-secondary">
            Bookmarked campus items you are watching for price drops or updates
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Browse nearby feed</span>
        </Link>
      </div>

      <SearchAlertSettings />

      {error && (
        <div className="mb-4 rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
          {error}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && products.length === 0 && (
        <EmptyState
          icon={Bookmark}
          title="Your watchlist is empty"
          description="Bookmark items from the campus feed to keep track of them."
          actionLabel="Explore nearby items"
          actionHref="/"
        />
      )}

      {!loading && products.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
