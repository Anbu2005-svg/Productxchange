import React from "react";

export function SkeletonBox({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-sm bg-surface-muted ${className}`}
    />
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col rounded-md border border-border bg-surface p-3">
      <SkeletonBox className="aspect-[4/3] w-full rounded-sm" />
      <div className="mt-3 space-y-2">
        <SkeletonBox className="h-4 w-3/4" />
        <SkeletonBox className="h-3 w-1/2" />
        <div className="flex items-center justify-between pt-2">
          <SkeletonBox className="h-5 w-1/3" />
          <SkeletonBox className="h-5 w-14 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function DealCardSkeleton() {
  return (
    <div className="rounded-md border border-border bg-surface p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <SkeletonBox className="h-4 w-40" />
          <SkeletonBox className="h-3 w-28" />
        </div>
        <SkeletonBox className="h-5 w-20 rounded-full" />
      </div>
      <div className="flex gap-3">
        <SkeletonBox className="h-16 w-16 rounded-sm" />
        <div className="flex-1 space-y-2">
          <SkeletonBox className="h-3.5 w-full" />
          <SkeletonBox className="h-3.5 w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-md bg-surface p-4 border border-border space-y-2">
          <SkeletonBox className="h-3.5 w-20" />
          <SkeletonBox className="h-7 w-28" />
          <SkeletonBox className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
