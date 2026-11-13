"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";
import { Search, Home, Plus } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-tertiary border border-border">
        <Search className="h-6 w-6" strokeWidth={1.5} />
      </div>

      <h1 className="text-xl font-semibold text-text">Page not found</h1>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">
        The page you are looking for does not exist, was moved, or the link may be outdated.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <Link href="/">
          <Button variant="primary" size="sm">
            <Home className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Campus feed</span>
          </Button>
        </Link>
        <Link href="/listings/new">
          <Button variant="secondary" size="sm">
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            <span>List an item</span>
          </Button>
        </Link>
      </div>

      <p className="mt-8 font-mono text-[11px] text-text-tertiary">
        Error 404 • ProductXchange PWA
      </p>
    </div>
  );
}
