"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { api, logout, getToken, User, getCampuses, resolveImageUrl } from "@/lib/api";
import NotificationBell from "@/components/NotificationBell";
import { Sun, Moon, Plus, ChevronDown, Shield, LogOut, Menu, X, MessageSquare, Search } from "lucide-react";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [campuses, setCampuses] = useState<{ college: string; count: number }[]>([]);
  const [selectedCampus, setSelectedCampus] = useState("ALL");
  const [campusDropdownOpen, setCampusDropdownOpen] = useState(false);
  const campusMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCampuses()
      .then(setCampuses)
      .catch(() => {});

    if (typeof window !== "undefined") {
      const savedCampus = localStorage.getItem("px_campus") || "ALL";
      setSelectedCampus(savedCampus);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (campusMenuRef.current && !campusMenuRef.current.contains(e.target as Node)) {
        setCampusDropdownOpen(false);
      }
    }
    if (campusDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [campusDropdownOpen]);

  function handleSelectCampus(campus: string) {
    setSelectedCampus(campus);
    if (typeof window !== "undefined") {
      localStorage.setItem("px_campus", campus);
      window.dispatchEvent(new CustomEvent("campusChanged", { detail: campus }));
    }
    setCampusDropdownOpen(false);
    if (pathname !== "/") {
      router.push(`/?college=${encodeURIComponent(campus)}`);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem("px_theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved === "dark" || (!saved && prefersDark)) {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    } else {
      setIsDark(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("px_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("px_theme", "light");
    }
  }

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    api("/auth/me")
      .then((u) => {
        setUser(u);
        api("/chat/unread-count")
          .then((res) => setUnreadChatCount(res.unread_count || 0))
          .catch(() => {});
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await logout();
    setUser(null);
    setMenuOpen(false);
    router.push("/login");
  }

  const navLinks = [
    { href: "/", label: "Nearby" },
    { href: "/deals", label: "Deals" },
    { href: "/impact", label: "Eco-Impact" },
    { href: "/saved", label: "Saved" },
  ];

  return (
    <header className="h-14 bg-surface border-b border-border sticky top-0 z-40 transition-colors">
      <nav className="max-w-[1200px] h-full mx-auto flex items-center justify-between px-4 md:px-6">
        {/* Left: Wordmark & Main Nav */}
        <div className="flex items-center gap-6 h-full">
          <Link
            href="/"
            className="text-base font-bold tracking-tight text-text flex items-center gap-1.5 focus-visible:outline-primary"
          >
            <span>ProductXchange</span>
          </Link>

          {/* Desktop Nav Links: 2px underline when active */}
          {user && (
            <div className="hidden md:flex items-center gap-1 h-full">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`h-full flex items-center px-3 text-sm transition-colors border-b-2 -mb-px ${
                      isActive
                        ? "border-primary text-text font-semibold"
                        : "border-transparent text-text-secondary hover:text-text hover:border-border"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}

              {/* Campus Selector Dropdown */}
              <div className="relative ml-2" ref={campusMenuRef}>
                <button
                  type="button"
                  onClick={() => setCampusDropdownOpen(!campusDropdownOpen)}
                  className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text px-2 py-1 rounded-sm border border-border bg-surface-muted transition-colors"
                >
                  <span className="max-w-[120px] truncate">
                    {selectedCampus === "ALL" ? "All campuses" : selectedCampus}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
                </button>

                {campusDropdownOpen && (
                  <div className="absolute top-full mt-1.5 left-0 w-64 bg-surface border border-border rounded-md shadow-overlay py-1 z-50 text-xs">
                    <div className="px-3 py-1.5 border-b border-border text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                      Campus filter
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectCampus("ALL")}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-surface-muted transition-colors ${
                        selectedCampus === "ALL" ? "font-semibold text-primary" : "text-text"
                      }`}
                    >
                      <span>All campuses</span>
                      {selectedCampus === "ALL" && <span>✓</span>}
                    </button>

                    {user?.college && (
                      <button
                        type="button"
                        onClick={() => handleSelectCampus(user.college!)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between border-t border-b border-border hover:bg-surface-muted transition-colors ${
                          selectedCampus === user.college ? "font-semibold text-primary" : "text-text"
                        }`}
                      >
                        <span className="truncate">My campus: {user.college}</span>
                        {selectedCampus === user.college && <span>✓</span>}
                      </button>
                    )}

                    <div className="max-h-48 overflow-y-auto">
                      {campuses.map((c) => (
                        <button
                          key={c.college}
                          type="button"
                          onClick={() => handleSelectCampus(c.college)}
                          className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-surface-muted transition-colors ${
                            selectedCampus === c.college ? "font-semibold text-primary" : "text-text"
                          }`}
                        >
                          <span className="truncate pr-2">{c.college}</span>
                          <span className="text-[11px] text-text-tertiary tabular-nums font-mono">
                            {c.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Actions & User Controls */}
        <div className="flex items-center gap-2 text-sm">
          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-sm text-text-secondary hover:text-text hover:bg-surface-muted transition-colors"
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            title={isDark ? "Light theme" : "Dark theme"}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Desktop Search Link */}
          {user && (
            <Link
              href="/"
              className="hidden sm:flex p-2 rounded-sm text-text-secondary hover:text-text hover:bg-surface-muted transition-colors"
              aria-label="Search"
              title="Search"
            >
              <Search className="w-4 h-4" />
            </Link>
          )}

          {/* Desktop Sell Button (Solid Primary) */}
          {user && (
            <Link
              href="/listings/new"
              className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-sm bg-primary text-primary-fg text-xs font-medium hover:bg-primary-hover transition-colors"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Sell</span>
            </Link>
          )}

          {!loading && user ? (
            <div className="flex items-center gap-1">
              <NotificationBell />

              <Link
                href="/chat"
                className="relative hidden sm:flex p-2 rounded-sm text-text-secondary hover:text-text hover:bg-surface-muted transition-colors"
                aria-label="Chat conversations"
                title="Chat"
              >
                <MessageSquare className="w-4 h-4" />
                {unreadChatCount > 0 && (
                  <span className="absolute top-1 right-1 bg-primary text-primary-fg text-[10px] font-semibold h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full leading-none tabular-nums">
                    {unreadChatCount > 99 ? "99+" : unreadChatCount}
                  </span>
                )}
              </Link>

              {user.is_admin && (
                <Link
                  href="/admin"
                  className="hidden sm:flex p-2 rounded-sm text-text-secondary hover:text-text hover:bg-surface-muted transition-colors"
                  title="Admin"
                >
                  <Shield className="w-4 h-4" />
                </Link>
              )}

              {/* User Avatar */}
              <Link
                href="/profile"
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-sm text-xs text-text hover:bg-surface-muted transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-surface-muted border border-border flex items-center justify-center font-medium text-xs text-text overflow-hidden">
                  {user.avatar_url ? (
                    <img
                      src={resolveImageUrl(user.avatar_url)}
                      alt="Avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase()
                  )}
                </div>
                <span className="hidden lg:inline text-xs font-medium max-w-[100px] truncate">
                  {user.full_name || user.email.split("@")[0]}
                </span>
              </Link>

              <button
                type="button"
                onClick={handleLogout}
                className="hidden sm:flex p-2 rounded-sm text-text-tertiary hover:text-danger hover:bg-surface-muted transition-colors"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : !loading ? (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="h-8 px-3 rounded-sm text-xs font-medium text-text hover:bg-surface-muted transition-colors flex items-center"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="h-8 px-3 rounded-sm bg-primary text-primary-fg text-xs font-medium hover:bg-primary-hover transition-colors flex items-center"
              >
                Sign up
              </Link>
            </div>
          ) : null}

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 rounded-sm text-text-secondary hover:text-text hover:bg-surface-muted transition-colors"
            aria-label="Toggle navigation menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Dropdown */}
      {menuOpen && (
        <div className="md:hidden bg-surface border-b border-border px-4 py-3 space-y-2">
          {user ? (
            <>
              <div className="pb-2 border-b border-border flex items-center justify-between">
                <span className="text-xs text-text-secondary">Signed in as</span>
                <span className="text-xs font-semibold text-text">
                  {user.full_name || user.email}
                </span>
              </div>
              <div className="space-y-1">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-text hover:bg-surface-muted rounded-sm"
                  >
                    {link.label}
                  </Link>
                ))}
                {user.is_admin && (
                  <Link
                    href="/admin"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-text hover:bg-surface-muted rounded-sm"
                  >
                    Admin dashboard
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-surface-muted rounded-sm"
                >
                  Log out
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2 pt-1">
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="block text-center py-2 text-sm font-medium border border-border rounded-sm"
              >
                Log in
              </Link>
              <Link
                href="/register"
                onClick={() => setMenuOpen(false)}
                className="block text-center py-2 text-sm font-medium bg-primary text-primary-fg rounded-sm"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
