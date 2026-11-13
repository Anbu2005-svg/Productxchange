"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  api,
  resolveImageUrl,
  uploadAvatar,
  updateProfile,
  removeToken,
  User,
  getToken,
} from "@/lib/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Badge, { TypeTag } from "@/components/ui/Badge";
import {
  ArrowLeft,
  Camera,
  Edit2,
  Download,
  Trash2,
  Star,
  CheckCircle2,
  Package,
  Sun,
  Moon,
  Laptop,
  GraduationCap,
  Calendar,
  ShieldCheck,
} from "lucide-react";

type ProfileListing = {
  id: number;
  title: string;
  price: number | null;
  transaction_type: string;
  category: string;
  condition: string | null;
  image_urls: string[];
  status: string;
  created_at: string | null;
};

type ProfileReview = {
  id: number;
  rating: number;
  comment: string | null;
  reviewer_name: string;
  created_at: string | null;
};

type ProfileUser = {
  id: number;
  full_name: string | null;
  avatar_url?: string | null;
  email: string;
  college: string | null;
  is_verified: boolean;
  avg_rating: number;
  rating_count: number;
  created_at: string | null;
};

type ProfileData = {
  user: ProfileUser;
  listings: ProfileListing[];
  reviews: ProfileReview[];
};

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<ProfileData | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"listings" | "reviews">("listings");

  // Edit Profile Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCollege, setEditCollege] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Avatar upload
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // GDPR Delete modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Dark Mode State
  const [themeMode, setThemeMode] = useState<"light" | "dark" | "system">("system");

  useEffect(() => {
    const savedTheme = localStorage.getItem("px_theme") as "light" | "dark" | "system" | null;
    if (savedTheme) setThemeMode(savedTheme);
  }, []);

  function handleThemeChange(mode: "light" | "dark" | "system") {
    setThemeMode(mode);
    localStorage.setItem("px_theme", mode);
    if (mode === "dark") {
      document.documentElement.classList.add("dark");
    } else if (mode === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace(`/login?redirect=/profile/${id}`);
      return;
    }
    api("/auth/me").then(setCurrentUser).catch(() => setCurrentUser(null));

    loadProfile();
  }, [id, router]);

  function loadProfile() {
    api(`/auth/users/${id}/public-profile`)
      .then((res) => {
        setData(res);
        if (res.user) {
          setEditName(res.user.full_name || "");
          setEditCollege(res.user.college || "");
        }
      })
      .catch((e) => setError(e.message));
  }

  const isOwner = currentUser?.id === Number(id);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      showToast("Avatar image must be under 3MB", "error");
      return;
    }

    setUploadingAvatar(true);
    try {
      const res = await uploadAvatar(file);
      showToast("Profile avatar updated", "success");
      if (data) {
        setData({
          ...data,
          user: { ...data.user, avatar_url: res.avatar_url },
        });
      }
    } catch (e: any) {
      showToast(e.message || "Failed to upload avatar", "error");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfile({ full_name: editName, college: editCollege });
      showToast("Profile updated successfully", "success");
      setEditModalOpen(false);
      loadProfile();
    } catch (e: any) {
      showToast(e.message || "Failed to update profile", "error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleExportData() {
    try {
      const exportJson = await api("/auth/me/export");
      const blob = new Blob([JSON.stringify(exportJson, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `productxchange_data_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Personal data export downloaded", "info");
    } catch (e: any) {
      showToast(e.message || "Export failed", "error");
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await api("/auth/me", { method: "DELETE" });
      removeToken();
      showToast("Account deleted successfully", "info");
      router.push("/");
    } catch (e: any) {
      showToast(e.message || "Failed to delete account", "error");
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <p className="text-sm font-medium text-danger">{error}</p>
        <Link href="/" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
          Return to campus feed
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-xs text-text-secondary">
        Loading profile...
      </div>
    );
  }

  const { user, listings, reviews } = data;
  const joinDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "Unknown";

  return (
    <div className="mx-auto max-w-3xl py-4 sm:py-6 space-y-6">
      {/* Top back & actions bar */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Back to feed</span>
        </Link>

        {isOwner && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditModalOpen(true)}
            >
              <Edit2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Edit profile</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExportData}
              title="Download personal data export"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Export data</span>
            </Button>
          </div>
        )}
      </div>

      {/* Profile Overview Card */}
      <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative group flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-muted text-lg font-semibold text-text">
              {user.avatar_url ? (
                <img
                  src={resolveImageUrl(user.avatar_url)}
                  alt={user.full_name || "Avatar"}
                  className="h-full w-full object-cover"
                />
              ) : (
                user.full_name?.charAt(0)?.toUpperCase() || user.email.charAt(0).toUpperCase()
              )}

              {isOwner && (
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Change avatar photo"
                >
                  <Camera className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>{uploadingAvatar ? "..." : "Change"}</span>
                </button>
              )}
            </div>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarUpload}
              className="hidden"
            />

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-text">
                  {user.full_name || user.email.split("@")[0]}
                </h1>
                {user.is_verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success">
                    <ShieldCheck className="h-3 w-3" strokeWidth={2} /> Verified
                  </span>
                )}
              </div>

              {user.college && (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-secondary">
                  <GraduationCap className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={1.75} />
                  <span>{user.college}</span>
                </p>
              )}

              <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-text-tertiary">
                <Calendar className="h-3 w-3 text-text-tertiary" strokeWidth={1.75} />
                <span>Joined {joinDate}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 border-t border-border pt-3 sm:border-t-0 sm:pt-0">
            <div className="rounded-md border border-border bg-surface-muted px-3.5 py-2 text-center">
              <div className="flex items-center justify-center gap-1 font-mono text-sm font-semibold tabular-nums text-text">
                <Star className="h-3.5 w-3.5 fill-current text-warning" strokeWidth={1.75} />
                <span>{user.avg_rating.toFixed(1)}</span>
              </div>
              <div className="text-[11px] text-text-tertiary">
                {user.rating_count} review{user.rating_count !== 1 ? "s" : ""}
              </div>
            </div>

            <div className="rounded-md border border-border bg-surface-muted px-3.5 py-2 text-center">
              <div className="font-mono text-sm font-semibold tabular-nums text-text">
                {listings.length}
              </div>
              <div className="text-[11px] text-text-tertiary">Listings</div>
            </div>
          </div>
        </div>

        {/* Theme Settings row for Owner */}
        {isOwner && (
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
            <span className="text-xs font-medium text-text">Theme appearance</span>
            <div className="flex items-center rounded-md border border-border bg-surface-muted p-0.5 text-xs">
              <button
                type="button"
                onClick={() => handleThemeChange("light")}
                className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 font-medium transition-colors ${
                  themeMode === "light"
                    ? "bg-surface text-text shadow-xs"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange("dark")}
                className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 font-medium transition-colors ${
                  themeMode === "dark"
                    ? "bg-surface text-text shadow-xs"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange("system")}
                className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 font-medium transition-colors ${
                  themeMode === "system"
                    ? "bg-surface text-text shadow-xs"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                <Laptop className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>System</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border text-xs font-medium">
        <button
          onClick={() => setActiveTab("listings")}
          className={`border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "listings"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          Listings ({listings.length})
        </button>
        <button
          onClick={() => setActiveTab("reviews")}
          className={`border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "reviews"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          Reviews ({reviews.length})
        </button>
      </div>

      {/* Listings Tab */}
      {activeTab === "listings" && (
        <div>
          {listings.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-8 text-center text-xs text-text-secondary">
              No active listings published yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {listings.map((p) => {
                const hasImage = p.image_urls && p.image_urls.length > 0;
                return (
                  <Link
                    key={p.id}
                    href={`/listings/${p.id}`}
                    className="group overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border-strong"
                  >
                    <div className="aspect-4/3 w-full overflow-hidden bg-surface-muted">
                      {hasImage ? (
                        <img
                          src={resolveImageUrl(p.image_urls[0])}
                          alt={p.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-text-tertiary">
                          <Package className="h-6 w-6" strokeWidth={1.5} />
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="truncate text-xs font-semibold text-text">
                        {p.title}
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold tabular-nums text-text">
                          {p.price != null && p.price > 0
                            ? `₹${new Intl.NumberFormat("en-IN").format(p.price)}`
                            : "Free"}
                        </span>
                        <TypeTag type={p.transaction_type} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Reviews Tab */}
      {activeTab === "reviews" && (
        <div className="space-y-3">
          {reviews.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-8 text-center text-xs text-text-secondary">
              No reviews received yet.
            </div>
          ) : (
            reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-md border border-border bg-surface p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-muted text-xs font-medium text-text">
                      {r.reviewer_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-text">
                        {r.reviewer_name}
                      </div>
                      <div className="flex items-center gap-0.5 text-warning text-xs">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <span key={s}>{s <= Math.round(r.rating) ? "★" : "☆"}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {r.created_at && (
                    <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
                      {new Date(r.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  )}
                </div>
                {r.comment && (
                  <p className="mt-1 text-xs text-text leading-relaxed">
                    "{r.comment}"
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Owner Account Danger Zone */}
      {isOwner && (
        <div className="border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-danger">Delete account</div>
              <div className="text-[11px] text-text-tertiary">
                Permanently anonymize your profile and remove all active listings
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteModalOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Delete account</span>
            </Button>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit profile"
      >
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <Input
            label="Full name"
            required
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />

          <Input
            label="Campus / college"
            placeholder="e.g. National Institute of Technology"
            value={editCollege}
            onChange={(e) => setEditCollege(e.target.value)}
          />

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={savingProfile}
            >
              <span>{savingProfile ? "Saving..." : "Save changes"}</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete account confirmation"
      >
        <div className="space-y-4 text-xs">
          <p className="leading-relaxed text-text-secondary">
            Are you sure you want to delete your account? All your active listings will be removed, and your profile data will be permanently anonymized. This action cannot be undone.
          </p>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDeleteModalOpen(false)}
            >
              Keep account
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={handleDeleteAccount}
            >
              <span>{deleting ? "Deleting..." : "Confirm deletion"}</span>
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
