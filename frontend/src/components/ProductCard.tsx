"use client";

import { useState, useRef, MouseEvent } from "react";
import Link from "next/link";
import { Product, resolveImageUrl, getCategoryEmoji, getCategoryFallbackImage } from "@/lib/api";

function formatDistance(m?: number | null) {
  if (m == null) return null;
  if (m < 1000) return `${Math.round(m)} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

const typeMeta: Record<string, { label: string; icon: string; bg: string }> = {
  BUY: { label: "Buy", icon: "🛒", bg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-300" },
  EXCHANGE: { label: "Exchange", icon: "🔄", bg: "bg-blue-500/15 border-blue-500/30 text-blue-800 dark:text-blue-300" },
  RENT: { label: "Rent", icon: "⏱️", bg: "bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300" },
  DONATE: { label: "Free Gift", icon: "🎁", bg: "bg-purple-500/15 border-purple-500/30 text-purple-800 dark:text-purple-300" },
};

const conditionColors: Record<string, string> = {
  "Brand New": "bg-emerald-500",
  "Like New": "bg-sky-500",
  "Good": "bg-amber-500",
  "Fair": "bg-stone-400",
};

export default function ProductCard({ product }: { product: Product }) {
  const [is3DMode, setIs3DMode] = useState(false);
  const [rotationY, setRotationY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);

  // 3D Card Hover Perspective Tilt state
  const [tilt, setTilt] = useState({ x: 0, y: 0, shineX: 50, shineY: 50 });
  const cardRef = useRef<HTMLDivElement>(null);

  const distance = formatDistance(product.distance_m);
  const currentType = typeMeta[product.transaction_type] || {
    label: product.transaction_type,
    icon: "📦",
    bg: "bg-stone-500/15 border-stone-500/30 text-stone-800 dark:text-stone-300",
  };
  const images = product.image_urls || [];
  const firstImage = images.length > 0 ? images[0] : null;
  const isCompleted = product.status === "COMPLETED";

  const [imgIndex, setImgIndex] = useState(0);
  const [useHtmlFallback, setUseHtmlFallback] = useState(images.length === 0);

  const currentImageSrc = images.length > imgIndex ? resolveImageUrl(images[imgIndex]) : null;

  function handleImageError() {
    if (imgIndex + 1 < images.length) {
      setImgIndex((prev) => prev + 1);
    } else {
      setUseHtmlFallback(true);
    }
  }

  let angleMap: Record<string, string> = {};
  if (product.image_angles) {
    try {
      angleMap =
        typeof product.image_angles === "string"
          ? JSON.parse(product.image_angles)
          : product.image_angles;
    } catch {}
  }

  // Multi-angle turntable array for 3D spin preview
  const turntableSides: string[] = [
    angleMap.front || images[0] || "",
    angleMap.right || images[1] || images[0] || "",
    angleMap.back || images[2] || images[0] || "",
    angleMap.left || images[3] || images[1] || images[0] || "",
  ].filter(Boolean);

  const activeFrameIndex =
    turntableSides.length > 0
      ? Math.floor((((rotationY % 360) + 360) % 360) / (360 / turntableSides.length)) %
        turntableSides.length
      : 0;
  const current3DImage = turntableSides[activeFrameIndex] || firstImage;

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!cardRef.current || is3DMode) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -6;
    const rotateY = ((x - centerX) / centerX) * 6;

    setTilt({
      x: rotateX,
      y: rotateY,
      shineX: (x / rect.width) * 100,
      shineY: (y / rect.height) * 100,
    });
  }

  function handleMouseLeave() {
    setTilt({ x: 0, y: 0, shineX: 50, shineY: 50 });
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        perspective: "1000px",
      }}
      className="group relative"
    >
      <div
        style={{
          transform: !is3DMode ? `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` : undefined,
          transition: isDragging ? "none" : "transform 0.25s ease-out, box-shadow 0.25s ease-out, border-color 0.25s ease",
        }}
        className={`rounded-2xl overflow-hidden border border-ink/8 dark:border-white/10 bg-white/95 dark:bg-[#18201b]/95 backdrop-blur-xl shadow-xs hover:shadow-2xl hover:border-emerald-500/40 dark:hover:border-emerald-500/40 transition-all duration-300 flex flex-col justify-between ${
          isCompleted ? "opacity-75" : ""
        }`}
      >
        {/* Shine highlight overlay on tilt */}
        {!is3DMode && (
          <div
            style={{
              background: `radial-gradient(circle at ${tilt.shineX}% ${tilt.shineY}%, rgba(255,255,255,0.22) 0%, transparent 60%)`,
            }}
            className="absolute inset-0 pointer-events-none z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          />
        )}

        {/* Media Preview Box */}
        <div className="relative aspect-[4/3] w-full bg-gradient-to-b from-sand/70 to-sand/30 dark:from-stone-800/60 dark:to-stone-900/60 overflow-hidden flex items-center justify-center select-none">
          {/* 3D Spin Mode Active */}
          {is3DMode ? (
            <div
              className="relative w-full h-full cursor-grab active:cursor-grabbing flex items-center justify-center bg-stone-950/20"
              onMouseDown={(e) => {
                setIsDragging(true);
                setDragStartX(e.clientX);
              }}
              onMouseMove={(e) => {
                if (!isDragging) return;
                const delta = e.clientX - dragStartX;
                setRotationY((prev) => prev + delta * 1.5);
                setDragStartX(e.clientX);
              }}
              onMouseUp={() => setIsDragging(false)}
              onMouseLeave={() => setIsDragging(false)}
              onTouchStart={(e) => {
                setIsDragging(true);
                setDragStartX(e.touches[0].clientX);
              }}
              onTouchMove={(e) => {
                if (!isDragging) return;
                const delta = e.touches[0].clientX - dragStartX;
                setRotationY((prev) => prev + delta * 1.5);
                setDragStartX(e.touches[0].clientX);
              }}
              onTouchEnd={() => setIsDragging(false)}
            >
              {current3DImage ? (
                <img
                  src={resolveImageUrl(current3DImage)}
                  alt={`${product.title} 3D View`}
                  className="w-full h-full object-contain pointer-events-none p-2 animate-fade-in"
                />
              ) : (
                <span className="text-xs text-ink/50">No preview</span>
              )}

              {/* 3D Drag Rotation HUD overlay */}
              <div className="absolute bottom-2.5 inset-x-2 flex items-center justify-between px-3 py-1 rounded-xl bg-black/70 backdrop-blur-md text-[10px] text-white font-mono pointer-events-none border border-white/10 shadow-lg">
                <span className="flex items-center gap-1 font-semibold">🔄 Drag to inspect 360°</span>
                <span className="text-emerald-400 font-bold">
                  {Math.round(((rotationY % 360) + 360) % 360)}°
                </span>
              </div>
            </div>
          ) : useHtmlFallback || !currentImageSrc ? (
            <Link
              href={`/listings/${product.id}`}
              className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-moss/10 via-sand/40 to-emerald-50/20 dark:from-emerald-950/25 dark:via-stone-900 dark:to-stone-950 select-none group-hover:scale-105 transition-transform duration-500 ease-out"
            >
              <span className="text-5xl mb-2 filter drop-shadow-sm transition-transform duration-300 group-hover:scale-110">
                {getCategoryEmoji(product.category)}
              </span>
              <span className="text-xs font-bold text-ink/80 dark:text-sand tracking-wide line-clamp-1 px-2">
                {product.title}
              </span>
              <span className="text-[10px] text-emerald-800 dark:text-emerald-300 font-semibold uppercase tracking-wider mt-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 dark:bg-emerald-950/60 border border-emerald-500/20">
                {product.category || "Campus Item"}
              </span>
            </Link>
          ) : (
            <Link href={`/listings/${product.id}`} className="w-full h-full block relative bg-sand/30 dark:bg-stone-800">
              <img
                key={currentImageSrc || imgIndex}
                src={currentImageSrc}
                alt={product.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                onError={handleImageError}
              />
            </Link>
          )}

          {/* Transaction Type Pill */}
          <span
            className={`absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase border backdrop-blur-md shadow-sm flex items-center gap-1 ${currentType.bg}`}
          >
            <span>{currentType.icon}</span>
            <span>{currentType.label}</span>
          </span>

          {/* Interactive 3D Mode Toggle Button */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIs3DMode(!is3DMode);
            }}
            className={`absolute bottom-2.5 left-2.5 z-20 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide backdrop-blur-md flex items-center gap-1.5 transition-all shadow-md touch-manipulation ${
              is3DMode
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white ring-2 ring-white/40"
                : "bg-black/60 hover:bg-black/80 text-white border border-white/20 active:scale-95"
            }`}
            title="Toggle 3D View mode to inspect this item from all angles"
          >
            <span>🧊</span> {is3DMode ? "Exit 3D" : "3D View"}
          </button>

          {/* Distance Pill Top Right */}
          {distance && !isCompleted && (
            <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wide bg-black/60 backdrop-blur-md text-amber-300 border border-amber-300/20 shadow-sm flex items-center gap-1">
              <span>📍</span> {distance}
            </span>
          )}

          {/* Status Badges */}
          {isCompleted && (
            <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-stone-900/90 text-white border border-white/20 shadow-sm">
              ✓ Handed Over
            </span>
          )}
          {!isCompleted && product.is_expired && !distance && (
            <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-600/90 text-white shadow-sm">
              Expired
            </span>
          )}
        </div>

        {/* Content Body */}
        <div className="p-4 flex-1 flex flex-col justify-between">
          <div>
            <Link href={`/listings/${product.id}`} className="block">
              <h3 className="font-bold text-sm text-ink dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors line-clamp-1">
                {product.title}
              </h3>
            </Link>

            {product.college && (
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 mt-1 truncate">
                <span>🏫</span>
                <span className="truncate">{product.college}</span>
              </div>
            )}

            <p className="text-xs text-ink/70 dark:text-stone-400 mt-1.5 line-clamp-2 leading-relaxed">
              {product.description || "Campus student exchange item available for direct pickup."}
            </p>
          </div>

          <div className="mt-3.5 pt-3 border-t border-ink/5 dark:border-stone-800 flex items-center justify-between">
            <span className="font-extrabold text-base text-ink dark:text-white bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              {product.price != null && product.price > 0
                ? `₹${product.price.toLocaleString("en-IN")}`
                : product.transaction_type === "DONATE"
                ? "Free (Gift)"
                : "Open Offer"}
            </span>

            <div className="flex items-center gap-1.5">
              {product.condition && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ink/75 dark:text-stone-300 bg-sand/80 dark:bg-stone-800/80 px-2 py-0.5 rounded-md border border-ink/5 dark:border-stone-700">
                  <span className={`w-1.5 h-1.5 rounded-full ${conditionColors[product.condition] || "bg-emerald-500"}`} />
                  {product.condition}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
