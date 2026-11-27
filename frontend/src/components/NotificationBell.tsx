"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { api, getToken, API_BASE } from "@/lib/api";
import { Bell, CheckCheck, MessageSquare, Handshake, CheckCircle2, Star } from "lucide-react";

type NotificationItem = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "OFFER_RECEIVED":
    case "COUNTER_OFFER":
    case "DEAL_CONFIRMED":
    case "DEAL_COMPLETED":
      return <Handshake className="w-4 h-4 text-primary" />;
    case "OFFER_ACCEPTED":
      return <CheckCircle2 className="w-4 h-4 text-success" />;
    case "NEW_MESSAGE":
      return <MessageSquare className="w-4 h-4 text-info" />;
    case "REVIEW_RECEIVED":
      return <Star className="w-4 h-4 text-warning" />;
    default:
      return <Bell className="w-4 h-4 text-text-tertiary" />;
  }
}

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!getToken()) return;
    try {
      const res = await api("/notifications/unread-count");
      setUnreadCount(res.count);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnreadCount();

    const token = getToken();
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;

    function connectWs() {
      if (!token) return;
      try {
        const apiBase = API_BASE;
        const wsProto = apiBase.startsWith("https") ? "wss" : "ws";
        const wsHost = apiBase.replace(/^https?:\/\//, "");
        const wsUrl = `${wsProto}://${wsHost}/notifications/ws`;

        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setUnreadCount((c) => c + 1);
            if (data.title) {
              setNotifications((prev) => [
                {
                  id: Date.now(),
                  type: data.type || "ALERT",
                  title: data.title,
                  message: data.message || null,
                  link: data.link || null,
                  is_read: false,
                  created_at: new Date().toISOString(),
                },
                ...prev,
              ]);
            }
          } catch {}
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connectWs, 5000);
        };
      } catch {}
    }

    connectWs();

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchUnreadCount();
      }
    }, 30000);

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchUnreadCount();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [fetchUnreadCount]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  async function toggleDropdown() {
    if (!isOpen) {
      try {
        const list = await api("/notifications");
        setNotifications(list);
        setLoaded(true);
      } catch {}
    }
    setIsOpen(!isOpen);
  }

  async function markAsRead(notifId: number) {
    try {
      await api(`/notifications/${notifId}/read`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }

  async function markAllRead() {
    try {
      await api("/notifications/read-all", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {}
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="relative p-2 rounded-sm text-text-secondary hover:text-text hover:bg-surface-muted transition-colors focus-visible:outline-2 focus-visible:outline-primary"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="w-5 h-5" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 bg-primary text-primary-fg text-[10px] font-semibold h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full leading-none tabular-nums">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 bg-surface border border-border rounded-md shadow-overlay z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-text uppercase tracking-wider">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          <div className="overflow-y-auto max-h-72">
            {!loaded ? (
              <div className="py-8 text-center text-xs text-text-tertiary">
                Loading notifications…
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-text-tertiary">
                No notifications
              </div>
            ) : (
              notifications.map((n) => {
                const content = (
                  <div
                    className={`flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0 transition-colors cursor-pointer ${
                      n.is_read
                        ? "bg-surface hover:bg-surface-muted"
                        : "bg-primary-subtle/50 hover:bg-primary-subtle"
                    }`}
                    onClick={() => {
                      if (!n.is_read) markAsRead(n.id);
                      setIsOpen(false);
                    }}
                  >
                    <span className="mt-0.5 shrink-0">{getNotificationIcon(n.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-snug ${n.is_read ? "text-text-secondary" : "text-text font-semibold"}`}>
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
                          {n.message}
                        </p>
                      )}
                      <p className="text-[11px] text-text-tertiary mt-1">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {!n.is_read && (
                      <span className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5 shrink-0" />
                    )}
                  </div>
                );

                return n.link ? (
                  <Link key={n.id} href={n.link}>
                    {content}
                  </Link>
                ) : (
                  <div key={n.id}>{content}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
