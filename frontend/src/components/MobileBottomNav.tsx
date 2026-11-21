"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, getToken, User } from "@/lib/api";
import { MapPin, Handshake, Plus, MessageSquare, User as UserIcon } from "lucide-react";

export default function MobileBottomNav() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setUser(null);
      return;
    }

    api("/auth/me")
      .then((u) => {
        setUser(u);
        api("/chat/unread-count")
          .then((res) => setUnreadChatCount(res.unread_count || 0))
          .catch(() => { });
      })
      .catch(() => setUser(null));
  }, [pathname]);

  // Hide mobile bottom nav inside active one-on-one chat to maximize keyboard space
  const isChatDetail = pathname.startsWith("/chat/") && pathname !== "/chat";
  if (isChatDetail) {
    return null;
  }

  const isActive = (path: string) => {
    if (path === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(path);
  };

  return (
    <nav
      aria-label="Mobile navigation bar"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 8px))" }}
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border px-2 pt-2 safe-area-bottom"
    >
      <div className="flex items-center justify-around max-w-md mx-auto">
        {/* 1. Explore */}
        <Link
          href="/"
          className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] transition-colors ${isActive("/")
            ? "text-primary font-semibold"
            : "text-text-secondary hover:text-text"
            }`}
        >
          <MapPin className="w-5 h-5" strokeWidth={1.75} />
          <span className="text-[12px] mt-1">Explore</span>
        </Link>

        {/* 2. Deals */}
        <Link
          href={user ? "/deals" : "/login"}
          className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] transition-colors ${isActive("/deals")
            ? "text-primary font-semibold"
            : "text-text-secondary hover:text-text"
            }`}
        >
          <Handshake className="w-5 h-5" strokeWidth={1.75} />
          <span className="text-[12px] mt-1">Deals</span>
        </Link>

        {/* 3. Sell (Small primary-filled rounded square, no glow, no floating) */}
        <Link
          href={user ? "/listings/new" : "/login"}
          className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] transition-colors ${isActive("/listings/new")
            ? "text-primary font-semibold"
            : "text-text-secondary hover:text-text"
            }`}
          aria-label="Create listing"
        >
          <div className="w-7 h-7 rounded-sm bg-primary text-primary-fg flex items-center justify-center">
            <Plus className="w-4 h-4" strokeWidth={2} />
          </div>
          <span className="text-[12px] mt-1">Sell</span>
        </Link>

        {/* 4. Chat */}
        <Link
          href={user ? "/chat" : "/login"}
          className={`relative flex flex-col items-center justify-center py-1 px-3 min-w-[56px] transition-colors ${isActive("/chat")
            ? "text-primary font-semibold"
            : "text-text-secondary hover:text-text"
            }`}
        >
          <div className="relative">
            <MessageSquare className="w-5 h-5" strokeWidth={1.75} />
            {unreadChatCount > 0 && (
              <span className="absolute -top-1.5 -right-2 px-1.5 min-w-[16px] h-4 rounded-full bg-primary text-primary-fg text-[10px] font-semibold flex items-center justify-center leading-none">
                {unreadChatCount > 99 ? "99+" : unreadChatCount}
              </span>
            )}
          </div>
          <span className="text-[12px] mt-1">Chat</span>
        </Link>

        {/* 5. Profile */}
        <Link
          href={user ? "/profile" : "/login"}
          className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] transition-colors ${isActive("/profile")
            ? "text-primary font-semibold"
            : "text-text-secondary hover:text-text"
            }`}
        >
          <UserIcon className="w-5 h-5" strokeWidth={1.75} />
          <span className="text-[12px] mt-1">Profile</span>
        </Link>
      </div>
    </nav>
  );
}
