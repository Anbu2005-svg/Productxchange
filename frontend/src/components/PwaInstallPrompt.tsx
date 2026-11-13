"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { Download, Share, PlusSquare, X } from "lucide-react";

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
    const standaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (standaloneMode) {
      setIsStandalone(true);
      return;
    }

    const dismissedUntil = localStorage.getItem("px_pwa_dismissed_until");
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    const ua = window.navigator.userAgent;
    const isIosDevice =
      /iPad|iPhone|iPod/.test(ua) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/i.test(ua);

    if (isIosDevice && isSafari && !standaloneMode) {
      setIsIos(true);
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
      return () => clearTimeout(timer);
    }

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
    const sevenDays = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem("px_pwa_dismissed_until", sevenDays.toString());
  };

  if (isStandalone || !showPrompt) {
    return null;
  }

  return (
    <>
      <aside
        aria-label="App installation prompt"
        className="fixed bottom-20 left-3 right-3 z-40 rounded-lg border border-border bg-surface p-4 shadow-lg sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-sm"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
            <Download className="h-5 w-5" strokeWidth={1.75} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-xs font-semibold text-text">
                Install ProductXchange
              </h4>
              <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary border border-border">
                PWA
              </span>
            </div>
            <p className="mt-1 text-xs text-text-secondary leading-relaxed">
              Install for instant deal notifications and offline handshake PIN passes.
            </p>
          </div>

          <button
            onClick={handleDismiss}
            className="rounded p-1 text-text-tertiary hover:text-text"
            aria-label="Dismiss installation prompt"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            onClick={handleInstallClick}
          >
            <span>{isIos ? "Add to home screen" : "Install app"}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
          >
            Not now
          </Button>
        </div>
      </aside>

      {showIosInstructions && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setShowIosInstructions(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-lg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-text">
                  Install on iOS Safari
                </h3>
                <p className="text-xs text-text-secondary">Two-step home screen setup</p>
              </div>
              <button
                onClick={() => setShowIosInstructions(false)}
                className="rounded p-1 text-text-tertiary hover:text-text"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-text-secondary">
              <div className="flex items-start gap-2.5 rounded border border-border bg-surface-muted p-2.5">
                <Share className="h-4 w-4 shrink-0 text-primary mt-0.5" strokeWidth={1.75} />
                <div>
                  Tap the <strong className="font-semibold text-text">Share</strong> icon in Safari&apos;s bottom toolbar.
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded border border-border bg-surface-muted p-2.5">
                <PlusSquare className="h-4 w-4 shrink-0 text-primary mt-0.5" strokeWidth={1.75} />
                <div>
                  Scroll down and tap <strong className="font-semibold text-text">Add to Home Screen</strong>.
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => setShowIosInstructions(false)}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
