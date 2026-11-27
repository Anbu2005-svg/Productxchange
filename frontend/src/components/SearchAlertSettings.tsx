"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import PushNotificationBanner from "./PushNotificationBanner";

const categories = {
  offers: "Offers and deal updates",
  rentals: "Rentals and return reminders",
  listing_expiry: "Listing expiry reminders",
  saved_searches: "Saved-search matches",
  messages: "Chat messages",
};
type Category = keyof typeof categories;
type Preferences = Record<Category, boolean>;
type Search = {
  id: number; q?: string; category?: string; condition?: string; transaction_type?: string;
  college?: string; min_price?: number; max_price?: number; has_3d?: boolean;
  radius_km?: number; lat?: number; lng?: number;
};

function describe(search: Search) {
  return [search.q, search.category, search.transaction_type, search.condition, search.college,
    search.min_price != null && `From ₹${search.min_price}`,
    search.max_price != null && `Up to ₹${search.max_price}`,
    search.has_3d != null && (search.has_3d ? "3D listings" : "Listings without 3D"),
    search.radius_km && `Within ${search.radius_km} km of ${search.lat?.toFixed(2)}, ${search.lng?.toFixed(2)}`,
  ].filter(Boolean).join(" · ");
}

export default function SearchAlertSettings() {
  const [searches, setSearches] = useState<Search[]>([]);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { showToast } = useToast();

  useEffect(() => {
    let active = true;
    setLoadError(false);
    Promise.all([api("/saved-searches"), api("/notifications/preferences")])
      .then(([rows, preferences]) => {
        if (active) { setSearches(rows); setPrefs(preferences); }
      })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [attempt]);

  async function remove(id: number) {
    setBusy(true);
    try {
      await api(`/saved-searches/${id}`, { method: "DELETE" });
      setSearches(rows => rows.filter(row => row.id !== id));
      showToast("Search alert removed", "success");
    } catch { showToast("Could not remove the search alert", "error"); }
    finally { setBusy(false); }
  }

  async function toggle(category: Category, enabled: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [category]: enabled });
    setBusy(true);
    try {
      setPrefs(await api(`/notifications/preferences/${category}`, {
        method: "PUT", body: JSON.stringify({ enabled }),
      }));
      showToast("Notification preference saved", "success");
    } catch {
      setPrefs(previous);
      showToast("Could not save the notification preference", "error");
    }
    finally { setBusy(false); }
  }

  return (
    <div className="mb-6 grid gap-4 md:grid-cols-2">
      <section id="saved-searches" className="scroll-mt-24 rounded-md border border-border bg-surface p-4">
        <h2 className="font-semibold">Saved searches</h2>
        {loadError ? <button className="text-sm text-primary" onClick={() => setAttempt(n => n + 1)}>Retry loading alert settings</button>
          : !prefs ? <p role="status">Loading alerts…</p>
          : searches.length === 0 ? <p className="mt-2 text-sm text-text-secondary">Choose filters in the feed and select “Save search alert” to hear about new matches.</p>
          : <ul className="mt-2 divide-y divide-border">{searches.map(search => (
              <li key={search.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 break-words">{describe(search)}</span>
                <button className="text-primary" disabled={busy} aria-label={`Remove ${describe(search)}`}
                  onClick={() => remove(search.id)}>Remove</button>
              </li>
            ))}</ul>}
      </section>
      <section id="notification-preferences" className="scroll-mt-24 rounded-md border border-border bg-surface p-4">
        <h2 className="font-semibold">Notification preferences</h2>
        <p className="my-2 text-sm text-text-secondary">Choose which alerts appear in your bell and on devices where you enable push.</p>
        {prefs && (Object.keys(categories) as Category[]).map(key => (
          <label key={key} className="flex items-center gap-2 py-1 text-sm">
            <input type="checkbox" checked={prefs[key]} disabled={busy}
              onChange={e => toggle(key, e.target.checked)} />
            {categories[key]}
          </label>
        ))}
        <PushNotificationBanner embedded />
      </section>
    </div>
  );
}
