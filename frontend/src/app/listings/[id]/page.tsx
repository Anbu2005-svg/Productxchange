"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  api,
  Product,
  resolveImageUrl,
  User,
  reportListing,
  saveProduct,
  unsaveProduct,
  getToken,
} from "@/lib/api";
import ProductCard from "@/components/ProductCard";
import Product3DViewer from "@/components/Product3DViewer";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { Badge, TypeTag } from "@/components/ui/Badge";
import {
  Bookmark,
  Share2,
  Flag,
  MessageSquare,
  ShieldCheck,
  MapPin,
  Clock,
  ArrowLeft,
  MoreVertical,
  RotateCw,
  Image as ImageIcon,
  Check,
  Calendar,
  AlertCircle,
  HelpCircle,
} from "lucide-react";

function formatPrice(price?: number | null) {
  if (price == null || price === 0) return "Free";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(price);
}

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [offerAmount, setOfferAmount] = useState("");
  const [rentalDays, setRentalDays] = useState("30");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [createdTxId, setCreatedTxId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [bumping, setBumping] = useState(false);

  // Modals & Menu
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [reportReason, setReportReason] = useState("Counterfeit or misleading");
  const [reportDetails, setReportDetails] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);
  const [activeMediaTab, setActiveMediaTab] = useState<"2d" | "3d">("2d");
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (product) {
      setIsSaved(!!product.is_saved);
    }
  }, [product]);

  async function handleToggleSave() {
    if (!currentUser) {
      router.push(`/login?redirect=/listings/${id}`);
      return;
    }
    const next = !isSaved;
    setIsSaved(next);
    try {
      if (next) {
        await saveProduct(Number(id));
        showToast("Saved to your list", "success");
      } else {
        await unsaveProduct(Number(id));
        showToast("Removed from your list", "info");
      }
    } catch {
      setIsSaved(!next);
    }
  }

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace(`/login?redirect=/listings/${id}`);
      return;
    }

    api("/auth/me").then(setCurrentUser).catch(() => setCurrentUser(null));

    api(`/products/${id}`)
      .then((data) => {
        setProduct(data);
        if (data.price) {
          setOfferAmount(String(data.price));
        }
        if (data.has_3d || (data.image_urls && data.image_urls.length > 1)) {
          setActiveMediaTab("3d");
        }
      })
      .catch((e) => setError(e.message));
  }, [id, router]);

  useEffect(() => {
    if (!product) return;
    const cat = encodeURIComponent(product.category);
    api(`/products?category=${cat}&limit=5`)
      .then((res) => {
        const items: Product[] = Array.isArray(res) ? res : res.items || [];
        setSimilarProducts(items.filter((p) => p.id !== product.id).slice(0, 4));
      })
      .catch(() => {});
  }, [product]);

  const images = product?.image_urls || [];
  const currentImage = images[selectedImageIndex] || images[0] || null;
  const isSeller = currentUser && product && currentUser.id === product.seller_id;

  async function handleStartChat() {
    if (!currentUser) {
      router.push(`/login?redirect=/listings/${id}`);
      return;
    }
    if (!product) return;

    setStartingChat(true);
    try {
      const convo = await api("/chat/conversations/start", {
        method: "POST",
        body: JSON.stringify({
          recipient_id: product.seller_id,
          product_id: product.id,
        }),
      });
      router.push(`/chat/${convo.id}`);
    } catch (e: any) {
      showToast(e.message || "Failed to start conversation", "error");
    } finally {
      setStartingChat(false);
    }
  }

  async function handleCreateOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser) {
      router.push(`/login?redirect=/listings/${id}`);
      return;
    }
    if (!product) return;

    setSubmittingOffer(true);
    setStatus(null);
    try {
      const isRent = product.transaction_type === "RENT";
      const payload: any = {
        product_id: product.id,
        offer_amount: offerAmount ? parseFloat(offerAmount) : product.price,
        notes: notes.trim() || undefined,
      };
      if (isRent && rentalDays) {
        payload.rental_period_days = parseInt(rentalDays, 10);
      }

      const tx = await api("/transactions", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setCreatedTxId(tx.id);
      setStatus("Offer submitted. The seller has been notified.");
      showToast("Offer sent to seller", "success");
      setOfferModalOpen(false);
      router.push("/deals");
    } catch (err: any) {
      showToast(err.message || "Failed to submit offer", "error");
    } finally {
      setSubmittingOffer(false);
    }
  }

  async function handleBumpListing() {
    if (!product) return;
    const renewing = product.is_expired || (product.days_remaining ?? 30) <= 7;
    setBumping(true);
    try {
      const updated = await api(`/products/${product.id}/${renewing ? "renew" : "bump"}`, { method: "POST" });
      setProduct(updated);
      showToast(renewing ? "Listing renewed for 30 days" : "Listing bumped to top of search", "success");
    } catch (err: any) {
      showToast(err.message || "Could not refresh listing", "error");
    } finally {
      setBumping(false);
    }
  }

  async function handleDeleteListing() {
    if (!product) return;
    if (!confirm("Are you sure you want to remove this listing?")) return;
    try {
      await api(`/products/${product.id}`, { method: "DELETE" });
      showToast("Listing removed", "info");
      router.push("/");
    } catch (err: any) {
      showToast(err.message || "Failed to delete listing", "error");
    }
  }

  async function handleReportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    setSubmittingReport(true);
    try {
      await reportListing(
        product.id,
        reportReason,
        reportDetails.trim() || undefined
      );
      showToast("Report submitted to campus moderators", "info");
      setReportModalOpen(false);
    } catch (err: any) {
      showToast(err.message || "Failed to submit report", "error");
    } finally {
      setSubmittingReport(false);
    }
  }

  function handleCopyLink() {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard", "success");
      setOverflowMenuOpen(false);
    }
  }

  if (error) {
    return (
      <div className="py-8 space-y-4 max-w-lg mx-auto text-center">
        <div className="p-4 bg-surface border border-danger/30 rounded-md text-xs text-danger">
          {error}
        </div>
        <Button variant="secondary" size="sm" onClick={() => router.push("/")}>
          Return to listings
        </Button>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-xs text-text-tertiary">
        Loading listing details…
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Top Breadcrumb & Actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to listings</span>
        </Link>

        {/* Overflow Menu: Share & Report */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOverflowMenuOpen(!overflowMenuOpen)}
            aria-label="More options"
            className="p-1.5 rounded-sm text-text-secondary hover:text-text hover:bg-surface-muted transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {overflowMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-surface border border-border rounded-md shadow-overlay py-1 z-30 text-xs">
              <button
                type="button"
                onClick={handleCopyLink}
                className="w-full text-left px-3 py-2 text-text hover:bg-surface-muted flex items-center gap-2"
              >
                <Share2 className="w-3.5 h-3.5 text-text-tertiary" />
                <span>Copy link</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOverflowMenuOpen(false);
                  setReportModalOpen(true);
                }}
                className="w-full text-left px-3 py-2 text-danger hover:bg-surface-muted flex items-center gap-2"
              >
                <Flag className="w-3.5 h-3.5 text-danger" />
                <span>Report listing</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 bg-surface border border-border rounded-md p-4 sm:p-6">
        {/* Gallery Column */}
        <div className="space-y-3">
          {images.length > 0 && (
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveMediaTab("2d")}
                  className={`px-2.5 py-1 text-xs font-medium rounded-xs transition-colors ${
                    activeMediaTab === "2d"
                      ? "bg-surface-muted text-text font-semibold"
                      : "text-text-secondary hover:text-text"
                  }`}
                >
                  Photos ({images.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMediaTab("3d")}
                  className={`px-2.5 py-1 text-xs font-medium rounded-xs transition-colors ${
                    activeMediaTab === "3d"
                      ? "bg-surface-muted text-text font-semibold"
                      : "text-text-secondary hover:text-text"
                  }`}
                >
                  3D View
                </button>
              </div>
            </div>
          )}

          {activeMediaTab === "3d" ? (
            <Product3DViewer
              angles={product.image_angles}
              imageUrls={images}
              title={product.title}
            />
          ) : (
            <div className="space-y-2">
              <div className="relative aspect-[4/3] w-full rounded-sm overflow-hidden bg-surface-muted border border-border flex items-center justify-center">
                {currentImage ? (
                  <img
                    src={resolveImageUrl(currentImage)}
                    alt={product.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-xs text-text-tertiary">No photo available</div>
                )}
              </div>

              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`relative w-14 h-14 rounded-xs overflow-hidden border shrink-0 ${
                        selectedImageIndex === idx ? "border-primary" : "border-border opacity-70"
                      }`}
                    >
                      <img
                        src={resolveImageUrl(img)}
                        alt={`Thumbnail ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Approximate Location Notice */}
          <div className="p-3 bg-surface-muted rounded-sm border border-border text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-text">
              <MapPin className="w-3.5 h-3.5 text-text-tertiary" />
              <span>
                {product.pickup_area ? "Pickup location" : "Campus vicinity (~1.1 km)"}
              </span>
            </div>
            {product.pickup_area ? (
              <p className="text-text-secondary font-mono">{product.pickup_area}</p>
            ) : (
              <p className="text-text-tertiary leading-relaxed">
                Location is approximate to protect privacy. Exact meetup notes unlock when a deal is confirmed.
              </p>
            )}
          </div>
        </div>

        {/* Details Column */}
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TypeTag type={product.transaction_type} />
              <Badge status={product.status as any}>{product.status}</Badge>
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold text-text tracking-tight">
              {product.title}
            </h1>
            <p className="text-2xl font-semibold text-text tabular-nums pt-1">
              {formatPrice(product.price)}
            </p>
          </div>

          {/* Meta Specifications Table */}
          <div className="grid grid-cols-2 gap-2 py-3 border-y border-border text-xs">
            <div>
              <span className="text-text-tertiary block">Category</span>
              <span className="text-text font-medium">{product.category}</span>
            </div>
            <div>
              <span className="text-text-tertiary block">Condition</span>
              <span className="text-text font-medium">{product.condition || "Not specified"}</span>
            </div>
            {product.college && (
              <div>
                <span className="text-text-tertiary block">College</span>
                <span className="text-text font-medium">{product.college}</span>
              </div>
            )}
            <div>
              <span className="text-text-tertiary block">Listing status</span>
              <span className="text-text font-medium">
                {product.is_expired ? "Expired" : `${product.days_remaining ?? 30} days remaining`}
              </span>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <div className="space-y-1">
              <h2 className="text-xs font-semibold text-text uppercase tracking-wider">
                Description
              </h2>
              <p className="text-sm text-text-secondary whitespace-pre-line leading-relaxed">
                {product.description}
              </p>
            </div>
          )}

          {/* Seller Profile Block */}
          {product.seller && (
            <div className="p-3.5 bg-surface-muted rounded-sm border border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center font-medium text-xs text-text overflow-hidden">
                  {product.seller.avatar_url ? (
                    <img
                      src={resolveImageUrl(product.seller.avatar_url)}
                      alt={product.seller.full_name || "Seller"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    product.seller.full_name?.charAt(0) || "S"
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-text">
                      {product.seller.full_name || "Campus peer"}
                    </span>
                    {product.seller.is_verified && (
                      <span title="Campus verified" className="inline-flex">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-text-tertiary">
                    {product.seller.college || "Verified student"} • ★ {product.seller.avg_rating || "5.0"}
                  </p>
                </div>
              </div>

              {!isSeller && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleStartChat}
                  loading={startingChat}
                >
                  <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                  <span>Message</span>
                </Button>
              )}
            </div>
          )}

          {/* Action Buttons for Desktop */}
          <div className="pt-2 flex items-center gap-2">
            {isSeller ? (
              <div className="flex items-center gap-2 w-full">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleBumpListing}
                  loading={bumping}
                  className="flex-1"
                >
                  <RotateCw className="w-3.5 h-3.5 mr-1.5" />
                  <span>{product.is_expired || (product.days_remaining ?? 30) <= 7 ? "Renew listing" : "Bump to top"}</span>
                </Button>
                <Link href={`/listings/edit/${product.id}`} className="flex-1">
                  <Button variant="secondary" size="md" className="w-full">
                    Edit listing
                  </Button>
                </Link>
                <Button
                  variant="destructive"
                  size="md"
                  onClick={handleDeleteListing}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 w-full">
                <Button
                  variant="primary"
                  size="lg"
                  disabled={product.is_expired}
                  onClick={() => setOfferModalOpen(true)}
                  className="flex-1"
                >
                  {product.transaction_type === "RENT"
                    ? "Rent this item"
                    : product.transaction_type === "DONATE"
                    ? "Claim free item"
                    : "Make an offer"}
                </Button>

                <Button
                  variant="secondary"
                  size="lg"
                  onClick={handleToggleSave}
                  aria-label={isSaved ? "Saved" : "Save item"}
                >
                  <Bookmark
                    className="w-4 h-4"
                    fill={isSaved ? "currentColor" : "none"}
                  />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Bar on Mobile */}
      {!isSeller && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border p-3 safe-area-bottom flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={handleStartChat}
            loading={startingChat}
            className="flex-1"
          >
            <MessageSquare className="w-4 h-4 mr-1.5" />
            <span>Message</span>
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={product.is_expired}
                  onClick={() => setOfferModalOpen(true)}
            className="flex-1"
          >
            {product.transaction_type === "RENT"
              ? "Rent"
              : product.transaction_type === "DONATE"
              ? "Claim"
              : "Make offer"}
          </Button>
        </div>
      )}

      {/* Similar Campus Items */}
      {similarProducts.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-border">
          <h2 className="text-xs font-semibold text-text uppercase tracking-wider">
            Similar campus listings
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {similarProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}

      {/* Offer Negotiation Modal */}
      <Modal
        isOpen={offerModalOpen}
        onClose={() => setOfferModalOpen(false)}
        title={
          product.transaction_type === "RENT"
            ? "Rent campus item"
            : product.transaction_type === "DONATE"
            ? "Request donation"
            : "Make transaction offer"
        }
        description="Submit your proposed amount and meetup notes to the seller."
      >
        <form onSubmit={handleCreateOffer} className="space-y-4">
          {product.transaction_type !== "DONATE" && (
            <Input
              label="Offered price (₹)"
              type="number"
              min="0"
              step="1"
              required
              value={offerAmount}
              onChange={(e) => setOfferAmount(e.target.value)}
              helperText={`Listing price: ${formatPrice(product.price)}`}
            />
          )}

          {product.transaction_type === "RENT" && (
            <Input
              label="Rental period (days)"
              type="number"
              min="1"
              max="180"
              required
              value={rentalDays}
              onChange={(e) => setRentalDays(e.target.value)}
              helperText="Days you wish to rent the item for"
            />
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-text-secondary">
              Note to seller (optional)
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Can meet near college library at 4 PM"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2.5 text-sm bg-surface text-text rounded-sm border border-border focus:border-primary focus:outline-none placeholder:text-text-tertiary"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setOfferModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" loading={submittingOffer}>
              Submit offer
            </Button>
          </div>
        </form>
      </Modal>

      {/* Report Modal */}
      <Modal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        title="Report listing"
        description="Campus moderators review all reports within 24 hours."
      >
        <form onSubmit={handleReportSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-text-secondary">Reason</label>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full h-11 px-3 text-sm bg-surface border border-border rounded-sm focus:border-primary focus:outline-none"
            >
              <option value="Counterfeit or Misleading">Counterfeit or misleading item</option>
              <option value="Prohibited or Hazardous Item">Prohibited or hazardous item</option>
              <option value="Scam or Fraudulent Offer">Suspected scam</option>
              <option value="Inappropriate Content">Inappropriate content or photo</option>
              <option value="Commercial Reseller">Commercial reseller / non-student</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-text-secondary">
              Details (optional)
            </label>
            <textarea
              rows={3}
              placeholder="Provide context for moderation review"
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              className="w-full p-2.5 text-sm bg-surface text-text rounded-sm border border-border focus:border-primary focus:outline-none placeholder:text-text-tertiary"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setReportModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="md" loading={submittingReport}>
              Submit report
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
