"use client";

import { useState, MouseEvent } from "react";
import Link from "next/link";
import { Product, resolveImageUrl, saveProduct, unsaveProduct, getToken } from "@/lib/api";
import { Bookmark, Package, BookOpen, Laptop, Microscope, Bike, Armchair, HelpCircle } from "lucide-react";
import { TypeTag, Badge } from "@/components/ui/Badge";

function formatDistance(m?: number | null) {
  if (m == null) return null;
  if (m < 1000) return `~${Math.round(m)} m away`;
  return `~${(m / 1000).toFixed(1)} km away`;
}

function formatPrice(price?: number | null) {
  if (price == null || price === 0) return "Free";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(price);
}

function getCategoryIcon(cat?: string | null) {
  const c = (cat || "").toLowerCase();
  if (c.includes("book") || c.includes("textbook") || c.includes("study")) {
    return <BookOpen className="w-8 h-8 text-text-tertiary" strokeWidth={1.5} />;
  }
  if (c.includes("electronic") || c.includes("gadget") || c.includes("calc")) {
    return <Laptop className="w-8 h-8 text-text-tertiary" strokeWidth={1.5} />;
  }
  if (c.includes("lab") || c.includes("equipment")) {
    return <Microscope className="w-8 h-8 text-text-tertiary" strokeWidth={1.5} />;
  }
  if (c.includes("cycle") || c.includes("mobility")) {
    return <Bike className="w-8 h-8 text-text-tertiary" strokeWidth={1.5} />;
  }
  if (c.includes("hostel") || c.includes("room")) {
    return <Armchair className="w-8 h-8 text-text-tertiary" strokeWidth={1.5} />;
  }
  return <Package className="w-8 h-8 text-text-tertiary" strokeWidth={1.5} />;
}

export default function ProductCard({ product }: { product: Product }) {
  const images = product.image_urls || [];
  const firstImage = images.length > 0 ? resolveImageUrl(images[0]) : null;
  const [imgError, setImgError] = useState(!firstImage);
  const [isSaved, setIsSaved] = useState(!!product.is_saved);
  const [isPending, setIsPending] = useState(false);

  const distance = formatDistance(product.distance_m);

  async function handleToggleSave(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const token = getToken();
    if (!token) {
      window.location.href = `/login?redirect=/listings/${product.id}`;
      return;
    }
    if (isPending) return;

    const next = !isSaved;
    setIsSaved(next);
    setIsPending(true);

    try {
      if (next) {
        await saveProduct(product.id);
      } else {
        await unsaveProduct(product.id);
      }
    } catch {
      setIsSaved(!next);
    } finally {
      setIsPending(false);
    }
  }

  const isSold = product.status === "SOLD" || product.status === "COMPLETED";
  const isRented = product.status === "RENTED";

  return (
    <Link
      href={`/listings/${product.id}`}
      className="group block bg-surface border border-border rounded-md hover:border-border-strong transition-colors overflow-hidden"
    >
      {/* 4:3 Aspect Ratio Image with Bookmark Button */}
      <div className="relative aspect-[4/3] w-full bg-surface-muted overflow-hidden">
        {!imgError && firstImage ? (
          <img
            src={firstImage}
            alt={product.title}
            loading="lazy"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-opacity duration-150"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
            {getCategoryIcon(product.category)}
            <span className="text-[11px] text-text-tertiary mt-1.5 line-clamp-1">
              {product.category || "Campus item"}
            </span>
          </div>
        )}

        {/* Status Overlay if not active */}
        {isSold && (
          <div className="absolute inset-0 bg-surface/75 flex items-center justify-center">
            <Badge status="SOLD">Sold</Badge>
          </div>
        )}
        {isRented && (
          <div className="absolute top-2 left-2">
            <Badge status="RENTED">Rented</Badge>
          </div>
        )}

        {/* Bookmark Icon Button Top-Right (No Layout Shift) */}
        <button
          type="button"
          onClick={handleToggleSave}
          aria-label={isSaved ? "Remove from saved items" : "Save item"}
          className={`absolute top-2 right-2 w-8 h-8 rounded-sm bg-surface/90 border border-border flex items-center justify-center transition-colors ${
            isSaved
              ? "text-primary border-primary"
              : "text-text-tertiary hover:text-text hover:border-border-strong"
          }`}
        >
          <Bookmark
            className="w-4 h-4"
            fill={isSaved ? "currentColor" : "none"}
            strokeWidth={1.75}
          />
        </button>
      </div>

      {/* Product Content */}
      <div className="p-3 space-y-1.5">
        {/* Title: 2-line clamp */}
        <h3 className="text-sm font-medium text-text line-clamp-2 leading-snug">
          {product.title}
        </h3>

        {/* Price & Type Tag */}
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-sm font-semibold text-text tabular-nums">
            {formatPrice(product.price)}
          </span>
          <TypeTag type={product.transaction_type} />
        </div>

        {/* Distance & Campus in Secondary Text */}
        <div className="text-xs text-text-secondary truncate pt-0.5">
          {distance && <span>{distance}</span>}
          {distance && product.college && <span> • </span>}
          {product.college && <span className="text-text-tertiary">{product.college}</span>}
          {!distance && !product.college && (
            <span className="text-text-tertiary">{product.condition || "Available"}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
