export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

const TOKEN_KEY = "px_token";
const TOKEN_EXPIRY_DAYS = 7;

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict${isSecure ? "; Secure" : ""}`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function deleteCookie(name: string) {
  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Strict${isSecure ? "; Secure" : ""}`;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return getCookie(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  setCookie(TOKEN_KEY, token, TOKEN_EXPIRY_DAYS);
  // Clear any legacy localStorage token to prevent XSS exfiltration
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function removeToken() {
  if (typeof window === "undefined") return;
  deleteCookie(TOKEN_KEY);
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    removeToken();
  }
}

export function resolveImageUrl(url?: string | null): string {
  if (!url) return "";
  if (url.startsWith("blob:")) return url;
  // Only allow relative URLs (same-origin) and the API base
  if (url.startsWith("/uploads/") || url.startsWith("/")) {
    return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    // Only allow URLs from the API base domain or known CDN domains
    try {
      const parsed = new URL(url);
      const apiHost = new URL(API_BASE).hostname;
      const allowedHosts = [
        apiHost,
        "s3.amazonaws.com",
        "s3.ap-south-1.amazonaws.com",
        "supabase.co",
        "images.unsplash.com",
        "unsplash.com",
      ];
      if (allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
        return url;
      }
    } catch {}
    return ""; // Block unknown external URLs
  }
  return ""; // Block data:, javascript:, and other schemes
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getCategoryEmoji(category?: string | null): string {
  const cat = (category || "").toLowerCase();
  if (cat.includes("textbook") || cat.includes("book") || cat.includes("study")) return "📚";
  if (cat.includes("electronic") || cat.includes("gadget") || cat.includes("calc")) return "💻";
  if (cat.includes("lab") || cat.includes("equipment")) return "🔬";
  if (cat.includes("hostel") || cat.includes("room")) return "🛏️";
  if (cat.includes("cycle") || cat.includes("mobility")) return "🚲";
  return "📦";
}

export function getCategoryFallbackImage(category?: string | null): string {
  const cat = (category || "").toLowerCase();
  let emoji = "📦";
  let bgGradient1 = "#1b4332";
  let bgGradient2 = "#081c15";
  let accentColor = "#52b788";

  if (cat.includes("textbook") || cat.includes("book") || cat.includes("study")) {
    emoji = "📚"; bgGradient1 = "#1e3a8a"; bgGradient2 = "#172554"; accentColor = "#60a5fa";
  } else if (cat.includes("electronic") || cat.includes("gadget") || cat.includes("calc")) {
    emoji = "💻"; bgGradient1 = "#0f766e"; bgGradient2 = "#134e4a"; accentColor = "#2dd4bf";
  } else if (cat.includes("lab") || cat.includes("equipment")) {
    emoji = "🔬"; bgGradient1 = "#6d28d9"; bgGradient2 = "#4c1d95"; accentColor = "#c084fc";
  } else if (cat.includes("hostel") || cat.includes("room")) {
    emoji = "🛏️"; bgGradient1 = "#b45309"; bgGradient2 = "#78350f"; accentColor = "#fcd34d";
  } else if (cat.includes("cycle") || cat.includes("mobility")) {
    emoji = "🚲"; bgGradient1 = "#047857"; bgGradient2 = "#064e3b"; accentColor = "#6ee7b7";
  }

  const label = escapeXml(category || "Campus Item");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgGradient1}"/>
        <stop offset="100%" stop-color="${bgGradient2}"/>
      </linearGradient>
    </defs>
    <rect width="600" height="450" fill="url(#g)"/>
    <circle cx="300" cy="190" r="85" fill="#ffffff" fill-opacity="0.12"/>
    <text x="300" y="218" font-size="76" text-anchor="middle">${emoji}</text>
    <text x="300" y="325" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="700" font-size="22" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${label}</text>
    <text x="300" y="360" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="600" font-size="14" fill="${accentColor}" text-anchor="middle">ProductXchange Campus Verified</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function api(path: string, options: RequestInit = {}) {
  const token = getToken();
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include", // Ensures httpOnly cookies are sent automatically
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function uploadProductImage(productId: number, file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return api(`/products/${productId}/images`, {
    method: "POST",
    body: formData,
  });
}

export async function uploadProductImageWithAngle(
  productId: number,
  file: File,
  angle?: string
): Promise<{ url: string; angle?: string; has_3d?: boolean }> {
  const formData = new FormData();
  formData.append("file", file);
  const query = angle ? `?angle=${encodeURIComponent(angle)}` : "";
  return api(`/products/${productId}/images${query}`, {
    method: "POST",
    body: formData,
  });
}

export async function convertProductTo3D(
  productId: number,
  angles?: Record<string, string>
): Promise<{
  success: boolean;
  has_3d: boolean;
  angles: Record<string, string>;
  turntable_frames: string[];
  message: string;
}> {
  return api(`/products/${productId}/3d-convert`, {
    method: "POST",
    body: JSON.stringify({ angles: angles || null }),
  });
}

export async function getCampuses(): Promise<{ college: string; count: number }[]> {
  return api("/products/campuses");
}

export async function getPushConfig(): Promise<{ enabled: boolean; publicKey: string }> {
  return api("/notifications/push-config");
}

export async function subscribePush(subscription: {
  endpoint: string;
  p256dh?: string;
  auth?: string;
}): Promise<{ status: string }> {
  return api("/notifications/push-subscription", {
    method: "POST",
    body: JSON.stringify(subscription),
  });
}

export async function triggerTestPush(): Promise<{ success: boolean; title: string; message: string }> {
  return api("/notifications/test-push", {
    method: "POST",
  });
}

export async function suggestListingAI(file: File): Promise<{
  attributes?: Record<string, any>;
  title?: string;
  description?: string;
  suggested_price?: number;
}> {
  const formData = new FormData();
  formData.append("file", file);
  return api("/ai/suggest-listing", {
    method: "POST",
    body: formData,
  });
}

export type Product = {
  id: number;
  seller_id: number;
  title: string;
  description: string | null;
  category: string;
  condition: string | null;
  price: number | null;
  transaction_type: "BUY" | "EXCHANGE" | "RENT" | "DONATE";
  pickup_area: string | null;
  latitude?: number | null;
  longitude?: number | null;
  image_urls: string[];
  has_3d?: boolean;
  image_angles?: Record<string, string> | null;
  college?: string | null;
  status: string;
  created_at: string;
  distance_m?: number | null;
  days_remaining?: number;
  is_expired?: boolean;
  can_bump?: boolean;
  is_saved?: boolean;
};

export type Offer = {
  id: number;
  proposed_by_id: number;
  amount: number;
  message?: string | null;
  created_at: string;
};

export type Transaction = {
  id: number;
  product_id: number;
  buyer_id: number;
  seller_id: number;
  state: "PENDING" | "ACCEPTED" | "REJECTED" | "COUNTERED" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  agreed_price?: number | null;
  rental_period_days?: number | null;
  buyer_completed: boolean;
  seller_completed: boolean;
  rental_returned?: boolean;
  rental_return_date?: string | null;
  rental_due_date?: string | null;
  handshake_pin?: string | null;
  created_at: string;
  updated_at: string;
  product?: Product | null;
  buyer?: { id: number; full_name?: string | null; email: string } | null;
  seller?: { id: number; full_name?: string | null; email: string } | null;
  offers?: Offer[];
};

export type User = {
  id: number;
  email: string;
  full_name?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  college?: string | null;
  is_verified: boolean;
  is_admin: boolean;
  avg_rating: number;
  rating_count: number;
};

export async function uploadAvatar(file: File): Promise<{ avatar_url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return api("/auth/me/avatar", {
    method: "POST",
    body: formData,
  });
}

export async function updateProfile(data: { full_name?: string; college?: string }): Promise<User> {
  return api("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function reportListing(productId: number, reason: string, details?: string): Promise<{ message: string }> {
  return api("/reports", {
    method: "POST",
    body: JSON.stringify({
      reported_product_id: productId,
      reason,
      details: details || null,
    }),
  });
}

export async function getUnreadChatCount(): Promise<{ unread_count: number }> {
  return api("/chat/unread-count");
}

/**
 * Client-side image compression using HTML5 Canvas.
 * Automatically downsizes images larger than maxWidth/maxHeight and encodes as JPEG with quality factor.
 * Non-image files or failed compressions return the original file as fallback.
 */
export async function compressImage(
  file: File,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.82
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || file.type === "image/gif") {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            maxHeight;
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file); // Keep original if compression didn't reduce size
              return;
            }
            const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

export async function saveProduct(productId: number): Promise<{ saved: boolean; message: string }> {
  return api(`/products/${productId}/save`, { method: "POST" });
}

export async function unsaveProduct(productId: number): Promise<{ saved: boolean; message: string }> {
  return api(`/products/${productId}/save`, { method: "DELETE" });
}

export async function getSavedProducts(): Promise<Product[]> {
  return api("/products/saved");
}

export async function returnRentalItem(transactionId: number): Promise<Transaction> {
  return api(`/transactions/${transactionId}/return`, { method: "POST" });
}
