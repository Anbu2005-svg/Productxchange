"use client";

import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    // Initial check
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
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] sm:w-auto transition-all duration-300 animate-in fade-in slide-in-from-top-2"
    >
      {isOffline ? (
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-amber-500/95 dark:bg-amber-600/95 backdrop-blur-md text-white text-xs font-semibold shadow-lg border border-amber-400/40 justify-center">
          <span className="w-2 h-2 rounded-full bg-white animate-ping" />
          <span>⚡ Offline Mode — Browsing cached campus items</span>
        </div>
      ) : showReconnected ? (
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-emerald-600/95 dark:bg-emerald-500/95 backdrop-blur-md text-white text-xs font-semibold shadow-lg border border-emerald-400/40 justify-center">
          <span>✓</span>
          <span>Internet connection restored!</span>
        </div>
      ) : null}
    </div>
  );
}
