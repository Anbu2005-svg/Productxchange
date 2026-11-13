"use client";

import { useEffect } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { AlertCircle, RotateCw, Home } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ProductXchange Error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle text-danger">
        <AlertCircle className="h-6 w-6" strokeWidth={1.75} />
      </div>

      <h1 className="text-xl font-semibold text-text">Something went wrong</h1>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">
        An unexpected error occurred while rendering this page. You can try refreshing or return to the campus feed.
      </p>

      {error.message && (
        <div className="my-4 w-full text-left">
          <details className="rounded-md border border-border bg-surface-muted p-3 text-xs">
            <summary className="cursor-pointer font-medium text-text-secondary">
              Technical details
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[11px] text-text-tertiary">
              {error.message}
              {error.digest && `\nDigest: ${error.digest}`}
            </pre>
          </details>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={reset}>
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Try again</span>
        </Button>
        <Link href="/">
          <Button variant="secondary" size="sm">
            <Home className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Campus feed</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
