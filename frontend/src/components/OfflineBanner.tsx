"use client";

import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsOffline(!window.navigator.onLine);
    }

    const handleOffline = () => {
      setIsOffline(true);
      setShowReconnected(false);
    };

    const handleOnline = () => {
      setIsOffline(false);
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
      }, 3500);
      return () => clearTimeout(timer);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline && !showReconnected) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] sm:w-auto"
    >
      {isOffline ? (
        <div className="flex items-center gap-2 rounded-full border border-warning/30 bg-surface px-4 py-2 text-xs font-medium text-warning shadow-md">
          <WifiOff className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
          <span>Offline mode — browsing cached campus listings</span>
        </div>
      ) : showReconnected ? (
        <div className="flex items-center gap-2 rounded-full border border-success/30 bg-surface px-4 py-2 text-xs font-medium text-success shadow-md">
          <Wifi className="h-4 w-4 shrink-0 text-success" strokeWidth={1.75} />
          <span>Connection restored</span>
        </div>
      ) : null}
    </div>
  );
}
