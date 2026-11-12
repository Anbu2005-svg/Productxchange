"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, getToken, User } from "@/lib/api";

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
          .catch(() => {});
      })
      .catch(() => setUser(null));
  }, [pathname]);

  // Hide mobile bottom nav inside active one-on-one chat to maximize keyboard and message space
  const isChatDetail = pathname.startsWith("/chat/") && pathname !== "/chat";
  if (isChatDetail) {
    return null;
  }

  // Active check helper
  const isActive = (path: string) => {
    if (path === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(path);
  };

  return (
    <nav
      aria-label="Mobile navigation bar"
      className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#131a16]/95 backdrop-blur-xl border-t border-ink/8 dark:border-white/10 px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] transition-colors shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-center justify-around max-w-md mx-auto">
        {/* 1. Explore */}
        <Link
          href="/"
          className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] rounded-xl transition-all active:scale-90 ${
            isActive("/")
              ? "text-emerald-700 dark:text-emerald-400 font-bold"
              : "text-ink/60 dark:text-stone-400 hover:text-emerald-600 dark:hover:text-emerald-300"
          }`}
        >
          <div className="relative">
            <span className="text-xl">📍</span>
            {isActive("/") && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            )}
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">Explore</span>
        </Link>

        {/* 2. Deals */}
        <Link
          href={user ? "/deals" : "/login"}
          className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] rounded-xl transition-all active:scale-90 ${
            isActive("/deals")
              ? "text-emerald-700 dark:text-emerald-400 font-bold"
              : "text-ink/60 dark:text-stone-400 hover:text-emerald-600 dark:hover:text-emerald-300"
          }`}
        >
          <div className="relative">
            <span className="text-xl">🤝</span>
            {isActive("/deals") && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            )}
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">Deals</span>
        </Link>

        {/* 3. Sell (Floating Center Pill) */}
        <Link
          href={user ? "/listings/new" : "/login"}
          className="flex flex-col items-center justify-center -mt-4 group active:scale-95 transition-transform"
          aria-label="Post new campus listing"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-500 text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-emerald-600/30 ring-4 ring-white dark:ring-[#131a16] group-hover:scale-105 transition-all">
            +
          </div>
          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 mt-1">
            Sell
          </span>
        </Link>

        {/* 4. Chat */}
        <Link
          href={user ? "/chat" : "/login"}
          className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] rounded-xl transition-all active:scale-90 relative ${
            isActive("/chat")
              ? "text-emerald-700 dark:text-emerald-400 font-bold"
              : "text-ink/60 dark:text-stone-400 hover:text-emerald-600 dark:hover:text-emerald-300"
          }`}
        >
          <div className="relative">
            <span className="text-xl">💬</span>
            {Boolean(unreadChatCount && unreadChatCount > 0) && (
              <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-rose-500 text-white animate-pulse shadow-xs">
                {unreadChatCount}
              </span>
            )}
            {isActive("/chat") && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            )}
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">Chat</span>
        </Link>

        {/* 5. Profile / Saved */}
        <Link
          href={user ? "/profile" : "/login"}
          className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] rounded-xl transition-all active:scale-90 ${
            isActive("/profile") || isActive("/saved")
              ? "text-emerald-700 dark:text-emerald-400 font-bold"
              : "text-ink/60 dark:text-stone-400 hover:text-emerald-600 dark:hover:text-emerald-300"
          }`}
        >
          <div className="relative">
            <span className="text-xl">{user ? "👤" : "🔑"}</span>
            {(isActive("/profile") || isActive("/saved")) && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            )}
          </div>
          <span className="text-[10px] tracking-tight mt-0.5">
            {user ? "Profile" : "Log In"}
          </span>
        </Link>
      </div>
    </nav>
  );
}

