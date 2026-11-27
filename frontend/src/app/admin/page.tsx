"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, resolveImageUrl, API_BASE } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import {
  Shield,
  Users,
  CheckCircle,
  Package,
  ArrowLeftRight,
  AlertTriangle,
  Check,
  Download,
  GraduationCap,
  Search,
  ExternalLink,
  Ban,
  Trash2,
} from "lucide-react";

type Report = {
  id: number;
  reporter_id: number;
  reason: string;
  details: string | null;
  reported_user_id: number | null;
  reported_product_id: number | null;
  resolved: boolean;
  admin_notes: string | null;
  created_at: string;
};

type AdminUser = {
  id: number;
  email: string;
  full_name: string | null;
  avatar_url?: string | null;
  college: string | null;
  is_verified: boolean;
  is_admin: boolean;
  is_blocked_flag: boolean;
  avg_rating: number;
  rating_count: number;
  created_at: string | null;
};

type AnalyticsBreakdown = {
  categories: { category: string; count: number }[];
  transaction_states: { state: string; count: number }[];
  transaction_types: { type: string; count: number }[];
};

type Stats = Record<string, number>;

export default function AdminPage() {
  const { showToast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [resolvedReports, setResolvedReports] = useState<Report[]>([]);
  const [activeTab, setActiveTab] = useState<"reports" | "resolved" | "users" | "breakdown" | "exports">("reports");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Users tab state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Breakdown tab state
  const [breakdown, setBreakdown] = useState<AnalyticsBreakdown | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [statsRes, openReports, closedReports] = await Promise.all([
        api("/admin/stats"),
        api("/admin/reports?resolved=false"),
        api("/admin/reports?resolved=true"),
      ]);
      setStats(statsRes);
      setReports(openReports);
      setResolvedReports(closedReports);
    } catch (e: any) {
      setError(e.message || "Failed to load admin dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function loadUsers(q = "") {
    setLoadingUsers(true);
    try {
      const res = await api(`/admin/users?q=${encodeURIComponent(q)}&limit=50`);
      setUsers(res.users || []);
    } catch (e: any) {
      showToast(e.message || "Failed to load users", "error");
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadBreakdown() {
    try {
      const res = await api("/admin/analytics/breakdown");
      setBreakdown(res);
    } catch {}
  }

  useEffect(() => {
    if (activeTab === "users") {
      loadUsers(userQuery);
    } else if (activeTab === "breakdown") {
      loadBreakdown();
    }
  }, [activeTab]);

  async function resolveReport(id: number) {
    setActionLoading(id);
    try {
      await api(`/admin/reports/${id}/resolve`, { method: "POST" });
      showToast("Report marked resolved", "success");
      await load();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function suspendUser(userId: number) {
    if (!confirm(`Are you sure you want to suspend student user #${userId}?`)) return;
    try {
      await api(`/admin/users/${userId}/suspend`, { method: "POST" });
      showToast(`User #${userId} suspended`, "info");
      await load();
      if (activeTab === "users") loadUsers(userQuery);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  }

  async function unsuspendUser(userId: number) {
    try {
      await api(`/admin/users/${userId}/unsuspend`, { method: "POST" });
      showToast(`User #${userId} reinstated`, "success");
      await load();
      if (activeTab === "users") loadUsers(userQuery);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  }

  async function removeListing(productId: number) {
    if (!confirm(`Remove listing #${productId} permanently?`)) return;
    try {
      await api(`/admin/listings/${productId}/remove`, { method: "POST" });
      showToast(`Listing #${productId} removed`, "info");
      await load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  }

  async function downloadCsv(resource: string) {
    try {
      const res = await fetch(`${API_BASE}/admin/export/${resource}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Export download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `productxchange_${resource}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`${resource}.csv downloaded successfully`, "success");
    } catch (e: any) {
      showToast(e.message || "Failed to download CSV", "error");
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <Shield className="mx-auto mb-3 h-8 w-8 text-danger" strokeWidth={1.5} />
        <h1 className="text-base font-semibold text-text">Admin access required</h1>
        <p className="mt-1 text-xs text-danger">{error}</p>
        <Link href="/" className="mt-4 inline-block text-xs font-medium text-primary hover:underline">
          Return to campus feed
        </Link>
      </div>
    );
  }

  const statCards: { key: string; label: string; icon: typeof Users }[] = [
    { key: "total_users", label: "Total students", icon: Users },
    { key: "verified_users", label: "Campus verified", icon: CheckCircle },
    { key: "active_listings", label: "Active listings", icon: Package },
    { key: "total_transactions", label: "Deals completed", icon: ArrowLeftRight },
    { key: "open_reports", label: "Open reports", icon: AlertTriangle },
  ];

  const totalUsers = stats?.total_users || 1;
  const verifiedUsers = stats?.verified_users || 0;
  const verifiedPercent = Math.min(100, Math.round((verifiedUsers / totalUsers) * 100));
  const totalReportsCount = reports.length + resolvedReports.length || 1;
  const resolutionRate = Math.min(100, Math.round((resolvedReports.length / totalReportsCount) * 100));

  return (
    <div className="mx-auto max-w-5xl py-4 sm:py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Campus administration</h1>
          <p className="mt-0.5 text-xs text-text-secondary">
            User moderation, trust verification, analytics, and data exports
          </p>
        </div>
      </div>

      {/* Stat Tiles */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-md border border-border bg-surface-muted animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {statCards.map((card) => {
            const IconComponent = card.icon;
            return (
              <div
                key={card.key}
                className="rounded-md border border-border bg-surface p-4"
              >
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <span className="font-medium">{card.label}</span>
                  <IconComponent className="h-4 w-4 text-text-tertiary" strokeWidth={1.75} />
                </div>
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-text">
                  {stats[card.key] ?? 0}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Analytics Ratios */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-surface p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-text">Campus verification ratio</span>
              <span className="font-mono tabular-nums text-text-secondary">{verifiedPercent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted border border-border">
              <div
                style={{ width: `${verifiedPercent}%` }}
                className="h-full bg-primary transition-all duration-300"
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono tabular-nums text-text-tertiary">
              <span>Verified: {verifiedUsers}</span>
              <span>Unverified: {totalUsers - verifiedUsers}</span>
            </div>
          </div>

          <div className="rounded-md border border-border bg-surface p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-text">Moderation resolution rate</span>
              <span className="font-mono tabular-nums text-text-secondary">{resolutionRate}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted border border-border">
              <div
                style={{ width: `${resolutionRate}%` }}
                className="h-full bg-success transition-all duration-300"
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono tabular-nums text-text-tertiary">
              <span>Resolved: {resolvedReports.length}</span>
              <span>Open: {reports.length}</span>
            </div>
          </div>
        </div>
      )}

      {/* Admin Tabs */}
      <div className="flex overflow-x-auto border-b border-border text-xs font-medium whitespace-nowrap">
        <button
          onClick={() => setActiveTab("reports")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "reports"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <span>Open reports</span>
          <span className="font-mono tabular-nums text-text-tertiary">({reports.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("resolved")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "resolved"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <span>Resolved</span>
          <span className="font-mono tabular-nums text-text-tertiary">({resolvedReports.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("users")}
          className={`border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "users"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          User moderation
        </button>

        <button
          onClick={() => setActiveTab("breakdown")}
          className={`border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "breakdown"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          Category breakdown
        </button>

        <button
          onClick={() => setActiveTab("exports")}
          className={`border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "exports"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          Data exports
        </button>
      </div>

      {/* Tab: Open Reports */}
      {activeTab === "reports" && (
        <div className="space-y-3">
          {reports.length === 0 ? (
            <div className="rounded-md border border-border bg-surface p-8 text-center text-xs text-text-secondary">
              No open reports pending moderation.
            </div>
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className="rounded-md border border-border bg-surface p-4 text-xs"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-danger-subtle px-2 py-0.5 font-medium text-danger">
                        {r.reason}
                      </span>
                      <span className="font-mono text-text-tertiary">
                        #{r.id} • {new Date(r.created_at).toLocaleDateString("en-IN")}
                      </span>
                    </div>

                    {r.details && (
                      <p className="rounded border border-border bg-surface-muted p-2.5 text-text">
                        {r.details}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3 text-text-secondary">
                      {r.reported_user_id && (
                        <span>
                          Reported user: <strong className="text-text">#{r.reported_user_id}</strong>
                        </span>
                      )}
                      {r.reported_product_id && (
                        <span>
                          Reported listing:{" "}
                          <Link
                            href={`/listings/${r.reported_product_id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            #{r.reported_product_id}
                          </Link>
                        </span>
                      )}
                      <span className="text-text-tertiary">Reporter: #{r.reporter_id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={actionLoading === r.id}
                      onClick={() => resolveReport(r.id)}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>{actionLoading === r.id ? "Resolving..." : "Resolve"}</span>
                    </Button>

                    {r.reported_user_id && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => suspendUser(r.reported_user_id!)}
                      >
                        <Ban className="h-3.5 w-3.5" strokeWidth={1.75} />
                        <span>Suspend</span>
                      </Button>
                    )}

                    {r.reported_product_id && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => removeListing(r.reported_product_id!)}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        <span>Remove item</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Resolved Reports */}
      {activeTab === "resolved" && (
        <div className="space-y-2">
          {resolvedReports.length === 0 ? (
            <div className="rounded-md border border-border bg-surface p-8 text-center text-xs text-text-secondary">
              No resolved reports in history.
            </div>
          ) : (
            resolvedReports.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border border-border bg-surface p-3 text-xs"
              >
                <div>
                  <span className="font-medium text-text">
                    #{r.id} • {r.reason}
                  </span>
                  {r.details && (
                    <p className="mt-0.5 text-text-secondary truncate max-w-md">{r.details}</p>
                  )}
                </div>
                <span className="font-medium text-success">Resolved</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: User Management */}
      {activeTab === "users" && (
        <div className="space-y-4">
          <div>
            <Input
              placeholder="Search by student name, email, or college..."
              value={userQuery}
              onChange={(e) => {
                setUserQuery(e.target.value);
                loadUsers(e.target.value);
              }}
            />
          </div>

          {loadingUsers ? (
            <div className="py-8 text-center text-xs text-text-secondary">
              Searching student directory...
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-surface-muted text-text-secondary font-medium">
                  <tr>
                    <th className="p-3">Student</th>
                    <th className="p-3">College</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Rating</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-surface-muted/50">
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-muted text-xs font-medium text-text">
                            {u.avatar_url ? (
                              <img src={resolveImageUrl(u.avatar_url)} alt="Avatar" className="h-full w-full object-cover" />
                            ) : (
                              u.full_name?.charAt(0) || u.email.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-text">{u.full_name || "Student"}</div>
                            <div className="font-mono text-[11px] text-text-tertiary">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-text-secondary">{u.college || "—"}</td>
                      <td className="p-3">
                        {u.is_blocked_flag ? (
                          <span className="rounded bg-danger-subtle px-1.5 py-0.5 text-[10px] font-medium text-danger">
                            Suspended
                          </span>
                        ) : u.is_verified ? (
                          <span className="rounded bg-success-subtle px-1.5 py-0.5 text-[10px] font-medium text-success">
                            Verified
                          </span>
                        ) : (
                          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-text-tertiary">
                            Standard
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-mono tabular-nums">
                        ★ {u.avg_rating.toFixed(1)} ({u.rating_count})
                      </td>
                      <td className="p-3 text-right">
                        {u.is_blocked_flag ? (
                          <button
                            type="button"
                            onClick={() => unsuspendUser(u.id)}
                            className="font-medium text-primary hover:underline"
                          >
                            Reinstate
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => suspendUser(u.id)}
                            className="font-medium text-danger hover:underline"
                          >
                            Suspend
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Analytics Breakdown */}
      {activeTab === "breakdown" && (
        <div className="space-y-4">
          {breakdown ? (
            <>
              <div className="rounded-md border border-border bg-surface p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text mb-3">
                  Listings by category
                </h3>
                <div className="space-y-2.5">
                  {breakdown.categories.map((c) => (
                    <div key={c.category} className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-text">{c.category}</span>
                        <span className="font-mono tabular-nums text-text-secondary">
                          {c.count} items
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted border border-border">
                        <div
                          style={{
                            width: `${Math.min(100, (c.count / (stats?.active_listings || 1)) * 100)}%`,
                          }}
                          className="h-full bg-primary"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-border bg-surface p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text mb-3">
                  Transactions by stage
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {breakdown.transaction_states.map((s) => (
                    <div
                      key={s.state}
                      className="rounded border border-border bg-surface-muted p-3 text-xs"
                    >
                      <div className="text-[11px] text-text-tertiary uppercase">{s.state}</div>
                      <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-text">
                        {s.count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-xs text-text-secondary">
              Loading category breakdown...
            </div>
          )}
        </div>
      )}

      {/* Tab: Data Exports */}
      {activeTab === "exports" && (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold text-text">Database CSV exports</h3>
            <p className="mt-0.5 text-xs text-text-secondary">
              Download comma-separated audit files for institutional compliance or analysis
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded border border-border bg-surface-muted p-3 text-xs">
                <div>
                  <div className="font-semibold text-text">Students directory</div>
                  <div className="text-text-tertiary">users.csv</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => downloadCsv("users")}>
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Export</span>
                </Button>
              </div>

              <div className="flex items-center justify-between rounded border border-border bg-surface-muted p-3 text-xs">
                <div>
                  <div className="font-semibold text-text">Marketplace listings</div>
                  <div className="text-text-tertiary">products.csv</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => downloadCsv("products")}>
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Export</span>
                </Button>
              </div>

              <div className="flex items-center justify-between rounded border border-border bg-surface-muted p-3 text-xs">
                <div>
                  <div className="font-semibold text-text">Handshakes & deals</div>
                  <div className="text-text-tertiary">transactions.csv</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => downloadCsv("transactions")}>
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Export</span>
                </Button>
              </div>

              <div className="flex items-center justify-between rounded border border-border bg-surface-muted p-3 text-xs">
                <div>
                  <div className="font-semibold text-text">Moderation reports</div>
                  <div className="text-text-tertiary">reports.csv</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => downloadCsv("reports")}>
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Export</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
