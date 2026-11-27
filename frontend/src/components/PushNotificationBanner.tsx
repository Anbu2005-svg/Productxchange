"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { subscribePush, triggerTestPush, getPushConfig } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import { Bell, X, Check } from "lucide-react";

export default function PushNotificationBanner({ embedded = false }: { embedded?: boolean }) {
  const pathname = usePathname();
  const { showToast } = useToast();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [dismissed, setDismissed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [tested, setTested] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

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
        const config = await getPushConfig();
        if (!config.enabled || !("serviceWorker" in navigator)) {
          throw new Error("Browser push is unavailable on this server.");
        }
        const reg = await navigator.serviceWorker.ready;
        let existing = await reg.pushManager.getSubscription();
        const existingKey = existing?.options.applicationServerKey;
        if (existing && existingKey) {
          const encoded = btoa(String.fromCharCode(...new Uint8Array(existingKey)))
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          if (encoded !== config.publicKey) {
            await existing.unsubscribe();
            existing = null;
          }
        }
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: config.publicKey,
        });
        const { keys } = sub.toJSON();
        if (!keys?.p256dh || !keys.auth) throw new Error("Missing browser subscription keys.");
        await subscribePush({ endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth });
        setSubscribed(true);
        showToast("Notifications enabled", "success");
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
      await triggerTestPush();
      setTested(true);
      showToast("Test notification sent", "success");
    } catch {
      showToast("Could not send the test notification", "error");
    }
  }

  function handleDismiss() {
    setDismissed(true);
    localStorage.setItem("px_push_dismissed", "true");
  }

  if (!embedded && (pathname === "/saved" || dismissed)) return null;
  if (embedded && (permission === "denied" || permission === "unsupported")) {
    return <p className="mt-2 text-xs text-text-secondary">{permission === "denied"
      ? "To receive device alerts, allow notifications in this browser’s site settings."
      : "Device push is unavailable here. Your alerts appear in the notification bell."}</p>;
  }
  if (permission === "unsupported") {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 py-2.5 text-xs text-text">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />
        <span>
          {subscribed
            ? "Device alerts are enabled."
            : "Enable device notifications for your selected alerts."}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {!subscribed ? (
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

        {!embedded && <button
          type="button"
          onClick={handleDismiss}
          className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface hover:text-text"
          aria-label="Dismiss notification banner"
        >
          <X className="h-3.5 w-3.5" />
        </button>}
      </div>
    </div>
  );
}
