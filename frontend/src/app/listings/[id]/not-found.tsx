import Link from "next/link";
import Button from "@/components/ui/Button";
import { Package, ArrowLeft } from "lucide-react";

export default function ListingNotFound() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-tertiary border border-border">
        <Package className="h-6 w-6" strokeWidth={1.5} />
      </div>
      <h1 className="text-xl font-semibold text-text">Listing not found</h1>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">
        This listing may have been sold, removed by the owner, or is no longer available.
      </p>
      <div className="mt-6">
        <Link href="/">
          <Button variant="primary" size="sm">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Browse campus feed</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
