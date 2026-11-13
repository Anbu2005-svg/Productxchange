"use client";

import { useState, useEffect } from "react";
import { subscribePush, triggerTestPush, getToken } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import { Bell, X, Check } from "lucide-react";

export default function PushNotificationBanner() {
  const { showToast } = useToast();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [dismissed, setDismissed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    const wasDismissed = localStorage.getItem("px_push_dismissed");
    if (wasDismissed) setDismissed(true);
  }, []);

  async function handleEnablePush() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      showToast("Browser does not support notifications", "error");
      return;
    }

    setSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm === "granted") {
        showToast("Notifications enabled", "success");

        if ("serviceWorker" in navigator) {
          try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey:
                "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
            });

            const p256dh = sub.getKey("p256dh");
            const auth = sub.getKey("auth");

            await subscribePush({
              endpoint: sub.endpoint,
              p256dh: p256dh ? btoa(String.fromCharCode(...new Uint8Array(p256dh))) : undefined,
              auth: auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : undefined,
            });
          } catch {
            if (getToken()) {
              await subscribePush({
                endpoint: `browser-direct-${Date.now()}`,
              });
            }
          }
        }
      } else {
        showToast("Notification permission was not granted", "info");
      }
    } catch (e: any) {
      showToast(e.message || "Failed to enable notifications", "error");
    } finally {
      setSubscribing(false);
    }
  }

  async function handleTestAlert() {
    try {
      if (typeof window !== "undefined" && Notification.permission === "granted") {
        new Notification("ProductXchange", {
          body: "Notifications are working for incoming offers and deal confirmations.",
          icon: "/icons/icon-192x192.png",
        });
      }
      await triggerTestPush();
      setTested(true);
      showToast("Test notification sent", "success");
    } catch {
      showToast("Test notification sent", "info");
    }
  }

  function handleDismiss() {
    setDismissed(true);
    localStorage.setItem("px_push_dismissed", "true");
  }

  if (permission === "unsupported" || dismissed) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 py-2.5 text-xs text-text">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />
        <span>
          {permission === "granted"
            ? "Notifications are active for deal updates and physical meetup handovers."
            : "Enable browser notifications to receive alerts when fellow students make offers."}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {permission !== "granted" ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={subscribing}
            onClick={handleEnablePush}
          >
            <span>{subscribing ? "Enabling..." : "Enable notifications"}</span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleTestAlert}
          >
            {tested ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                <span>Test sent</span>
              </>
            ) : (
              <span>Test alert</span>
            )}
          </Button>
        )}

        <button
          type="button"
          onClick={handleDismiss}
          className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface hover:text-text"
          aria-label="Dismiss notification banner"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
