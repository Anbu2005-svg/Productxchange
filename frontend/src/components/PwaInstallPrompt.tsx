"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // 1. Check if already installed & running in standalone display mode
    const standaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (standaloneMode) {
      setIsStandalone(true);
      return;
    }

    // 2. Check dismissal cooldown (7 days)
    const dismissedUntil = localStorage.getItem("px_pwa_dismissed_until");
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
      return;
    }

    // 3. Android / Chrome / Desktop beforeinstallprompt handler
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // 4. iOS Safari detection
    const ua = window.navigator.userAgent;
    const isIosDevice =
      /iPad|iPhone|iPod/.test(ua) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    const isSafari =
      /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/i.test(ua);

    if (isIosDevice && isSafari && !standaloneMode) {
      setIsIos(true);
      // Delay showing iOS banner slightly for smoother initial load
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
      return () => clearTimeout(timer);
    }

    // 5. Track if installed
    const handleAppInstalled = () => {
      setShowPrompt(false);
      setDeferredPrompt(null);
      localStorage.removeItem("px_pwa_dismissed_until");
    };

    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    } else if (isIos) {
      setShowIosInstructions(true);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setShowIosInstructions(false);
    // Dismiss for 7 days
    const sevenDays = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem("px_pwa_dismissed_until", sevenDays.toString());
  };

  if (isStandalone || !showPrompt) {
    return null;
  }

  return (
    <>
      {/* Floating PWA Install Card */}
      <aside
        aria-label="App installation prompt"
        className="fixed bottom-20 sm:bottom-6 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-sm z-40 bg-white/95 dark:bg-[#1a231e]/95 backdrop-blur-xl border border-emerald-600/20 dark:border-emerald-500/30 rounded-2xl p-4 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex-shrink-0 flex items-center justify-center text-white text-xl shadow-md border border-emerald-400/20">
            🔄
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="font-extrabold text-sm text-ink dark:text-white truncate">
                Install ProductXchange
              </h4>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                PWA
              </span>
            </div>
            <p className="text-xs text-ink/70 dark:text-stone-300 mt-1 leading-relaxed">
              Install our campus app for instant deals, offline Handshake PINs, and real-time chat.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-ink/40 dark:text-stone-400 hover:text-ink dark:hover:text-white p-1 text-xs"
            aria-label="Dismiss app install banner"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-ink/8 dark:border-white/10 flex items-center gap-2">
          <button
            onClick={handleInstallClick}
            className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-bold text-xs py-2.5 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
          >
            <span>📱</span>
            <span>{isIos ? "Add to Home Screen" : "Install App"}</span>
          </button>
          <button
            onClick={handleDismiss}
            className="text-xs font-semibold px-3 py-2.5 rounded-xl text-ink/60 dark:text-stone-400 hover:bg-sand/60 dark:hover:bg-stone-800 transition-colors"
          >
            Not now
          </button>
        </div>
      </aside>

      {/* iOS Safari Instruction Modal */}
      {showIosInstructions && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowIosInstructions(false)}
        >
          <div
            className="bg-white dark:bg-stone-900 border border-ink/10 dark:border-white/10 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 animate-in slide-in-from-bottom-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                  🔄
                </div>
                <div>
                  <h3 className="font-bold text-sm text-ink dark:text-white">Install on iPhone / iPad</h3>
                  <p className="text-[11px] text-ink/60 dark:text-stone-400">Fast 2-step home screen setup</p>
                </div>
              </div>
              <button
                onClick={() => setShowIosInstructions(false)}
                className="w-7 h-7 rounded-full bg-sand dark:bg-stone-800 text-ink/60 dark:text-stone-300 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 py-2 text-xs text-ink/80 dark:text-stone-200">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-sand/60 dark:bg-stone-800/60 border border-ink/5 dark:border-white/5">
                <div className="w-6 h-6 rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  Tap the <strong className="font-bold">Share</strong> button in Safari's bottom toolbar (<span className="text-base">⎋</span> or square with arrow pointing up).
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-sand/60 dark:bg-stone-800/60 border border-ink/5 dark:border-white/5">
                <div className="w-6 h-6 rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  Scroll down the share sheet and select <strong className="font-bold">Add to Home Screen</strong> (<span className="text-base">➕</span>).
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIosInstructions(false)}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-xs py-2.5 rounded-xl shadow-md"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </>
  );
}

