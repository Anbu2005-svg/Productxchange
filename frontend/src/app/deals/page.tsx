"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  Transaction,
  resolveImageUrl,
  User,
  getToken,
  API_BASE,
  returnRentalItem,
} from "@/lib/api";
import { useToast } from "@/components/Toast";
import { DealCardSkeleton } from "@/components/Skeleton";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge, { TypeTag } from "@/components/ui/Badge";
import UpiPaymentModal from "@/components/UpiPaymentModal";
import {
  Check,
  X,
  ArrowLeftRight,
  Lock,
  Unlock,
  Copy,
  Printer,
  Clock,
  Calendar,
  AlertCircle,
  Star,
  CheckCircle2,
  Package,
  Plus,
  ArrowRight,
  RotateCw,
  QrCode,
} from "lucide-react";

type DealTab = "active" | "rentals" | "completed" | "cancelled" | "all";

const STAGES = [
  { key: "PENDING", label: "Offer pending" },
  { key: "COUNTERED", label: "Countered" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "COMPLETED", label: "Completed" },
];

export default function DealsPage() {
  const { showToast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DealTab>("active");

  // State for countering
  const [counterTxId, setCounterTxId] = useState<number | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterMsg, setCounterMsg] = useState("");
  const [submittingAction, setSubmittingAction] = useState(false);

  // State for Handshake PIN verification
  const [verifyTxId, setVerifyTxId] = useState<number | null>(null);
  const [verifyPinInput, setVerifyPinInput] = useState("");
  const [verifyingHandshake, setVerifyingHandshake] = useState(false);

  // State for reviews
  const [reviewTxId, setReviewTxId] = useState<number | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewedTxIds, setReviewedTxIds] = useState<Set<number>>(new Set());

  // Copy feedback state
  const [copiedPinTxId, setCopiedPinTxId] = useState<number | null>(null);

  // Direct UPI Payment Modal state
  const [selectedUpiDeal, setSelectedUpiDeal] = useState<Transaction | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const userRes = await api("/auth/me").catch(() => null);
      setCurrentUser(userRes);

      const txList = await api("/transactions/mine");
      setTransactions(txList);
    } catch (e: any) {
      setError(e.message || "Failed to load transactions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();

    const token = getToken();
    if (!token) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;

    function connectWs() {
      try {
        const apiBase = API_BASE;
        const wsProto = apiBase.startsWith("https") ? "wss" : "ws";
        const wsHost = apiBase.replace(/^https?:\/\//, "");
        const wsUrl = `${wsProto}://${wsHost}/notifications/ws`;

        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.deal_update || (data.link && data.link.includes("/deals"))) {
              api("/transactions/mine")
                .then((txList) => setTransactions(txList))
                .catch(() => {});
            }
          } catch {}
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connectWs, 5000);
        };
      } catch {}
    }

    connectWs();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  async function handleAction(txId: number, action: string, extra: Record<string, any> = {}) {
    setActionError(null);
    setSubmittingAction(true);
    try {
      await api(`/transactions/${txId}/action`, {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      setCounterTxId(null);
      setCounterAmount("");
      setCounterMsg("");

      const msgs: Record<string, string> = {
        accept: "Offer accepted",
        reject: "Offer declined",
        counter: "Counter-offer sent",
        confirm: "Deal confirmed. Location details unlocked.",
        complete: "Handover signed off",
        cancel: "Deal cancelled",
      };
      showToast(
        msgs[action] || `Action '${action}' completed`,
        action === "reject" || action === "cancel" ? "info" : "success"
      );

      await loadData();
    } catch (e: any) {
      setActionError(e.message);
      showToast(e.message, "error");
    } finally {
      setSubmittingAction(false);
    }
  }

  async function handleSubmitReview(txId: number) {
    setSubmittingAction(true);
    try {
      await api("/reviews", {
        method: "POST",
        body: JSON.stringify({
          transaction_id: txId,
          rating: reviewRating,
          comment: reviewComment || null,
        }),
      });
      setReviewedTxIds((prev) => new Set(prev).add(txId));
      setReviewTxId(null);
      setReviewRating(5);
      setReviewComment("");
      showToast("Review submitted", "success");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSubmittingAction(false);
    }
  }

  async function handleVerifyHandshake(txId: number) {
    if (!verifyPinInput.trim()) {
      showToast("Please enter the 6-digit handshake PIN", "error");
      return;
    }
    setVerifyingHandshake(true);
    try {
      await api(`/transactions/${txId}/verify-handshake`, {
        method: "POST",
        body: JSON.stringify({ pin: verifyPinInput.trim() }),
      });
      showToast("Handshake verified. Deal completed.", "success");
      setVerifyTxId(null);
      setVerifyPinInput("");
      await loadData();
    } catch (e: any) {
      showToast(e.message || "Invalid or expired handshake PIN", "error");
    } finally {
      setVerifyingHandshake(false);
    }
  }

  async function rentalAction(id: number, action: string, body: BodyInit | undefined, success: string) {
    try {
      await api("/transactions/" + id + "/" + action, { method: "POST", body });
      showToast(success, "success");
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Rental update failed", "error");
    }
  }

  function handleCopyPin(pin: string, txId: number) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(pin);
      setCopiedPinTxId(txId);
      setTimeout(() => setCopiedPinTxId(null), 2000);
      showToast("PIN copied to clipboard", "info");
    }
  }

  function handlePrintReceipt() {
    window.print();
  }

  function getLastOffer(tx: Transaction) {
    if (!tx.offers || tx.offers.length === 0) return null;
    return tx.offers[tx.offers.length - 1];
  }

  function isUserTurn(tx: Transaction): boolean {
    if (!currentUser) return false;
    if (tx.state === "PENDING") {
      const lastOffer = getLastOffer(tx);
      if (lastOffer) {
        return lastOffer.proposed_by_id !== currentUser.id;
      }
      return currentUser.id === tx.seller_id;
    }
    if (tx.state === "COUNTERED") {
      const lastOffer = getLastOffer(tx);
      return lastOffer ? lastOffer.proposed_by_id !== currentUser.id : false;
    }
    if (tx.state === "ACCEPTED") {
      return true;
    }
    if (tx.state === "CONFIRMED") {
      const completedByMe = currentUser.id === tx.buyer_id ? tx.buyer_completed : tx.seller_completed;
      return !completedByMe;
    }
    return false;
  }

  function getNextActionText(tx: Transaction, otherPartyName: string): string {
    if (!currentUser) return "";
    if (tx.state === "PENDING" || tx.state === "COUNTERED") {
      return isUserTurn(tx)
        ? "Action required: Review offer and accept, counter, or decline"
        : `Awaiting response from ${otherPartyName}`;
    }
    if (tx.state === "ACCEPTED") {
      return "Action required: Confirm deal to reveal meetup spot and handshake PIN";
    }
    if (tx.state === "CONFIRMED") {
      const completedByMe = currentUser.id === tx.buyer_id ? tx.buyer_completed : tx.seller_completed;
      if (!completedByMe) {
        return currentUser.id === tx.buyer_id
          ? "Show your 6-digit handshake PIN to seller at physical meetup"
          : "Action required: Verify buyer's 6-digit PIN to sign off handover";
      }
      return `Waiting for ${otherPartyName} to sign off handover`;
    }
    if (tx.state === "COMPLETED") {
      return "Handover complete";
    }
    if (tx.state === "REJECTED") {
      return "Offer declined";
    }
    if (tx.state === "CANCELLED") {
      return "Deal cancelled";
    }
    return "";
  }

  const filtered = transactions.filter((tx) => {
    const isRental = tx.product?.transaction_type === "RENT" || Boolean(tx.rental_period_days);
    if (activeTab === "rentals") {
      return isRental;
    }
    if (activeTab === "active") {
      return ["PENDING", "COUNTERED", "ACCEPTED", "CONFIRMED"].includes(tx.state) && !isRental;
    }
    if (activeTab === "completed") {
      return tx.state === "COMPLETED" && !isRental;
    }
    if (activeTab === "cancelled") {
      return ["CANCELLED", "REJECTED"].includes(tx.state);
    }
    return true;
  });

  const activeCount = transactions.filter(
    (tx) => ["PENDING", "COUNTERED", "ACCEPTED", "CONFIRMED"].includes(tx.state) && tx.product?.transaction_type !== "RENT"
  ).length;
  const rentalsCount = transactions.filter(
    (tx) => tx.product?.transaction_type === "RENT" || Boolean(tx.rental_period_days)
  ).length;
  const completedCount = transactions.filter(
    (tx) => tx.state === "COMPLETED" && tx.product?.transaction_type !== "RENT"
  ).length;
  const cancelledCount = transactions.filter((tx) => ["CANCELLED", "REJECTED"].includes(tx.state)).length;

  return (
    <div className="mx-auto max-w-4xl py-4 sm:py-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Deals and negotiations</h1>
          <p className="text-xs text-text-secondary">
            Manage offers, unlock meetup spots, and complete physical handshakes
          </p>
        </div>
        <Link href="/listings/new">
          <Button variant="primary" size="sm">
            <Plus className="h-4 w-4" strokeWidth={2} />
            <span>List an item</span>
          </Button>
        </Link>
      </div>

      {actionError && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="font-semibold">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 4 Tabs: Active, Rentals, Completed, Cancelled */}
      <div className="mb-6 flex overflow-x-auto border-b border-border text-xs font-medium whitespace-nowrap">
        <button
          onClick={() => setActiveTab("active")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "active"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <span>Active</span>
          <span className="font-mono tabular-nums text-text-tertiary">({activeCount})</span>
        </button>

        <button
          onClick={() => setActiveTab("rentals")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "rentals"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <span>Rentals</span>
          <span className="font-mono tabular-nums text-text-tertiary">({rentalsCount})</span>
        </button>

        <button
          onClick={() => setActiveTab("completed")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "completed"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <span>Completed</span>
          <span className="font-mono tabular-nums text-text-tertiary">({completedCount})</span>
        </button>

        <button
          onClick={() => setActiveTab("cancelled")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "cancelled"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <span>Cancelled</span>
          <span className="font-mono tabular-nums text-text-tertiary">({cancelledCount})</span>
        </button>

        <button
          onClick={() => setActiveTab("all")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "all"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <span>All</span>
          <span className="font-mono tabular-nums text-text-tertiary">({transactions.length})</span>
        </button>
      </div>

      {loading && (
        <div className="space-y-4">
          <DealCardSkeleton />
          <DealCardSkeleton />
          <DealCardSkeleton />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md border border-danger/20 bg-danger-subtle p-4 text-xs text-danger">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-text-tertiary" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-text">No transactions found</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-text-secondary">
            {activeTab === "active"
              ? "You have no active negotiations right now."
              : activeTab === "rentals"
              ? "No rental transactions active or in history."
              : "Browse campus listings to find essentials, or list something to begin."}
          </p>
          <div className="mt-4">
            <Link href="/">
              <Button variant="secondary" size="sm">
                Browse nearby items
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Transaction Cards List */}
      <div className="space-y-4">
        {filtered.map((tx) => {
          const isBuyer = currentUser?.id === tx.buyer_id;
          const isSeller = currentUser?.id === tx.seller_id;
          const otherPartyName = isBuyer
            ? tx.seller?.full_name || tx.seller?.email || "Seller"
            : tx.buyer?.full_name || tx.buyer?.email || "Buyer";
          const lastOffer = getLastOffer(tx);
          const needsMyResponse = isUserTurn(tx);
          const hasImage = tx.product?.image_urls && tx.product.image_urls.length > 0;
          const agreedPrice = tx.agreed_price != null ? tx.agreed_price : lastOffer?.amount || tx.product?.price || 0;
          const nextActionText = getNextActionText(tx, otherPartyName);

          // Rental calculations
          const isRental = tx.product?.transaction_type === "RENT" || Boolean(tx.rental_period_days);
          const now = new Date();
          const dueDate = tx.rental_due_date ? new Date(tx.rental_due_date) : null;
          const daysRemaining = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

          // Negotiation Stage index
          const currentStageIndex =
            tx.state === "PENDING"
              ? 0
              : tx.state === "COUNTERED"
              ? 1
              : tx.state === "ACCEPTED"
              ? 2
              : tx.state === "CONFIRMED"
              ? 3
              : tx.state === "COMPLETED"
              ? 4
              : -1;

          return (
            <div
              key={tx.id}
              className={`rounded-lg border bg-surface p-5 transition-colors ${
                needsMyResponse
                  ? "border-primary ring-1 ring-primary/20"
                  : "border-border hover:border-border-strong"
              }`}
            >
              {/* Card Header: Role & Status */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text">
                    {isBuyer ? "Buying from" : "Selling to"} {otherPartyName}
                  </span>
                  <span className="text-text-tertiary">•</span>
                  <span className="text-text-secondary">
                    {isBuyer ? "Buyer" : "Seller"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Badge status={tx.state as any} />
                  <span className="font-mono text-xs tabular-nums text-text-tertiary">
                    {new Date(tx.updated_at || tx.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
              </div>

              {/* Product and Price Bar */}
              <div className="flex flex-col gap-4 py-4 sm:flex-row">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted sm:h-20 sm:w-20">
                  {hasImage ? (
                    <img
                      src={resolveImageUrl(tx.product?.image_urls[0])}
                      alt={tx.product?.title || "Item"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Package className="h-6 w-6 text-text-tertiary" strokeWidth={1.5} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/listings/${tx.product_id}`}
                      className="truncate text-sm font-semibold text-text hover:text-primary"
                    >
                      {tx.product?.title || `Item #${tx.product_id}`}
                    </Link>
                    <div className="font-mono text-sm font-semibold tabular-nums text-text">
                      ₹{new Intl.NumberFormat("en-IN").format(agreedPrice)}
                    </div>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <span>Listing: ₹{new Intl.NumberFormat("en-IN").format(tx.product?.price || 0)}</span>
                    {tx.product?.transaction_type && (
                      <TypeTag type={tx.product.transaction_type} />
                    )}
                  </div>

                  {/* Stage Stepper: 5 stages (Offer, Counter, Accept, Confirm, Complete) */}
                  {currentStageIndex >= 0 && (
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary mb-2">
                        Negotiation stage
                      </div>
                      <div className="flex items-center justify-between gap-1 text-xs">
                        {STAGES.map((st, idx) => {
                          const isDone = idx < currentStageIndex;
                          const isCurrent = idx === currentStageIndex;
                          return (
                            <div key={st.key} className="flex flex-1 items-center gap-1.5">
                              <div
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                                  isCurrent
                                    ? "bg-primary text-on-primary ring-2 ring-primary/20"
                                    : isDone
                                    ? "bg-primary-subtle text-primary"
                                    : "border border-border bg-surface-muted text-text-tertiary"
                                }`}
                              >
                                {isDone ? <Check className="h-3 w-3" strokeWidth={2.5} /> : idx + 1}
                              </div>
                              <span
                                className={`hidden text-xs truncate sm:inline ${
                                  isCurrent
                                    ? "font-medium text-text"
                                    : isDone
                                    ? "text-text-secondary"
                                    : "text-text-tertiary"
                                }`}
                              >
                                {st.label}
                              </span>
                              {idx < STAGES.length - 1 && (
                                <div
                                  className={`h-0.5 flex-1 transition-colors ${
                                    idx < currentStageIndex ? "bg-primary" : "bg-border"
                                  }`}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Next Action Plain Notice */}
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
                    <span className="font-medium text-text">{nextActionText}</span>
                    <span className="text-[11px] text-text-tertiary">
                      {needsMyResponse ? "Your turn" : "Waiting"}
                    </span>
                  </div>

                  {/* Rental Timeline & Relist Banner */}
                  {isRental && (
                    <div className="mt-3 rounded-md border border-rented/20 bg-rented-subtle p-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-rented shrink-0" strokeWidth={1.75} />
                          <span className="font-medium text-text">
                            {tx.rental_returned
                              ? "Item returned and relisted"
                              : `Rental period: ${tx.rental_period_days || 30} days`}
                          </span>
                        </div>

                        {dueDate && !tx.rental_returned && (
                          <div
                            className={`font-mono tabular-nums font-medium ${
                              daysRemaining != null && daysRemaining < 0
                                ? "text-danger"
                                : daysRemaining != null && daysRemaining <= 2
                                ? "text-warning"
                                : "text-text-secondary"
                            }`}
                          >
                            {daysRemaining != null && daysRemaining < 0
                              ? `Overdue by ${Math.abs(daysRemaining)} days`
                              : daysRemaining != null && daysRemaining <= 2
                              ? `Due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`
                              : `Due ${dueDate.toLocaleDateString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                })}`}
                          </div>
                        )}
                      </div>

                      <p className="mt-1 text-[11px] text-text-secondary">
                        {tx.rental_returned
                          ? "This item has been returned safely and restored to campus active listings."
                          : "Once returned and verified, this item will automatically be relisted for the campus community."}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {["renter", "owner"].map((party) => (
                          <a key={party} className="underline" href={API_BASE + "/transactions/" + tx.id + "/condition-photo/" + party}
                            target="_blank" rel="noopener noreferrer">View {party} photo</a>
                        ))}
                        {!tx.rental_returned && (
                          <label>
                            Upload condition photo (JPEG)
                            <input type="file" accept="image/jpeg" onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              if (!file) return;
                              const body = new FormData();
                              body.append("file", file);
                              void rentalAction(tx.id, "condition-photo", body, "Condition photo uploaded");
                              event.currentTarget.value = "";
                            }} />
                          </label>
                        )}
                        {!tx.rental_returned && !isSeller && !tx.rental_extension_days && (
                          <form className="flex gap-2" onSubmit={(event) => {
                            event.preventDefault();
                            const days = Number(new FormData(event.currentTarget).get("days"));
                            void rentalAction(tx.id, "rental-extension", JSON.stringify({ days }), "Extension requested");
                          }}>
                            <input name="days" required type="number" min="1" max="365" aria-label="Additional rental days" className="w-20 border rounded px-2 bg-surface" />
                            <Button type="submit" size="sm" variant="secondary">Request extension</Button>
                          </form>
                        )}
                        {!tx.rental_returned && !!tx.rental_extension_days && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span>Extension requested for {tx.rental_extension_days} days</span>
                            {isSeller && (["approve", "decline"] as const).map((decision) => (
                              <Button key={decision} size="sm" variant="secondary" onClick={() =>
                                void rentalAction(tx.id, "rental-extension/" + decision, undefined, "Extension request updated")
                              }>{decision === "approve" ? "Approve" : "Decline"}</Button>
                            ))}
                          </div>
                        )}
                        <form className="flex gap-2" onSubmit={(event) => {
                          event.preventDefault();
                          const details = String(new FormData(event.currentTarget).get("details"));
                          void rentalAction(tx.id, "rental-dispute", JSON.stringify({ details }), "Dispute submitted to moderation");
                        }}>
                          <input name="details" required minLength={2} maxLength={1700} aria-label="Rental dispute details" placeholder="What happened?" className="border rounded px-2 bg-surface" />
                          <Button type="submit" size="sm" variant="secondary">Report rental issue</Button>
                        </form>
                      </div>

                      {!tx.rental_returned && isSeller && tx.state === "COMPLETED" && (
                        <div className="mt-3">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={submittingAction}
                            onClick={async () => {
                              if (
                                confirm(
                                  "Confirm that the rented item has been returned safely? This will reactivate the listing for other students."
                                )
                              ) {
                                try {
                                  await returnRentalItem(tx.id);
                                  showToast("Rental item marked returned. Listing is active again.", "success");
                                  loadData();
                                } catch (err: any) {
                                  showToast(err.message, "error");
                                }
                              }
                            }}
                          >
                            <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                            <span>Confirm item return</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Negotiation Offer History Thread */}
                  {tx.offers && tx.offers.length > 0 && (
                    <div className="mt-3 space-y-1.5 rounded-md border border-border bg-surface-muted p-3 text-xs">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                        Offer history
                      </div>
                      {tx.offers.map((offer, oIdx) => {
                        const isByMe = currentUser?.id === offer.proposed_by_id;
                        return (
                          <div
                            key={offer.id || oIdx}
                            className="flex items-baseline justify-between gap-2 text-text-secondary"
                          >
                            <div>
                              <span className="font-medium text-text">
                                {isByMe ? "You" : otherPartyName}
                              </span>{" "}
                              offered{" "}
                              <span className="font-mono font-semibold tabular-nums text-warning">
                                ₹{new Intl.NumberFormat("en-IN").format(offer.amount)}
                              </span>
                              {offer.message && (
                                <span className="ml-1.5 italic text-text-tertiary">
                                  "{offer.message}"
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[11px] tabular-nums text-text-tertiary shrink-0">
                              {new Date(offer.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Confirmed Location Box (If Deal is Confirmed or Completed) */}
                  {["CONFIRMED", "COMPLETED"].includes(tx.state) && (
                    <div className="mt-3 rounded-md border border-primary/20 bg-primary-subtle p-3 text-xs space-y-1">
                      <div className="flex items-center gap-1.5 font-medium text-primary">
                        <Unlock className="h-3.5 w-3.5" strokeWidth={1.75} />
                        <span>Pickup location confirmed</span>
                      </div>
                      <p className="text-text">
                        {tx.product?.pickup_area || "Meetup spot agreed with counterparty."}
                      </p>
                    </div>
                  )}

                  {/* Double-Party Completion Tracker */}
                  {tx.state === "CONFIRMED" && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-muted p-3 text-xs">
                      <div className="flex items-center gap-4">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            tx.buyer_completed ? "text-success" : "text-text-tertiary"
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={2} />
                          <span>Buyer sign-off</span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            tx.seller_completed ? "text-success" : "text-text-tertiary"
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={2} />
                          <span>Seller sign-off</span>
                        </span>
                      </div>
                      <span className="text-text-tertiary">Both sign-offs required to complete</span>
                    </div>
                  )}

                  {/* Campus Meetup Handshake PIN Card (Printable Pass) */}
                  {tx.state === "CONFIRMED" && (
                    <div className="printable-area mt-4 rounded-md border border-border bg-surface p-4 text-xs">
                      <div className="flex items-center justify-between border-b border-border pb-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                            Handshake Pass
                          </div>
                          <div className="text-sm font-semibold text-text mt-0.5">
                            Physical meetup verification
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handlePrintReceipt}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:text-text"
                            title="Print receipt"
                          >
                            <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
                            <span>Print pass</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 py-3 sm:grid-cols-2">
                        <div>
                          <div className="text-text-tertiary">Agreed price</div>
                          <div className="font-mono text-base font-semibold tabular-nums text-text mt-0.5">
                            ₹{new Intl.NumberFormat("en-IN").format(agreedPrice)}
                          </div>
                        </div>
                        <div>
                          <div className="text-text-tertiary">Pickup landmark</div>
                          <div className="text-text mt-0.5">
                            {tx.product?.pickup_area || "Agreed campus landmark"}
                          </div>
                        </div>
                      </div>

                      {isBuyer ? (
                        <div className="border-t border-border pt-3">
                          <div className="text-text-tertiary mb-1">
                            Your 6-digit handshake PIN
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="font-mono text-2xl font-bold tracking-[0.25em] text-text bg-surface-muted border border-border px-4 py-2 rounded-md">
                              {tx.handshake_pin || "------"}
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleCopyPin(tx.handshake_pin || "", tx.id)}
                            >
                              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                              <span>{copiedPinTxId === tx.id ? "Copied" : "Copy"}</span>
                            </Button>
                          </div>
                          <p className="mt-2 text-xs text-text-tertiary">
                            Show this PIN to the seller only after physically inspecting the item at the meetup location.
                          </p>

                          {/* UPI Direct Pay Action */}
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2.5">
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              onClick={() => setSelectedUpiDeal(tx)}
                            >
                              <QrCode className="h-3.5 w-3.5" strokeWidth={1.75} />
                              <span>Pay via UPI / QR</span>
                            </Button>
                            <span className="text-xs text-text-tertiary">
                              Launch Google Pay, PhonePe, or scan QR
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="border-t border-border pt-3">
                          <div className="text-text-tertiary mb-1">
                            Verify buyer handshake PIN
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              maxLength={6}
                              placeholder="6-digit PIN"
                              value={verifyTxId === tx.id ? verifyPinInput : ""}
                              onChange={(e) => {
                                setVerifyTxId(tx.id);
                                setVerifyPinInput(e.target.value);
                              }}
                              className="h-10 w-36 rounded-md border border-border bg-surface px-3 font-mono text-sm tracking-widest text-text placeholder:text-text-tertiary focus:border-primary focus:outline-hidden"
                            />
                            <Button
                              variant="primary"
                              disabled={verifyingHandshake || verifyTxId !== tx.id || !verifyPinInput}
                              onClick={() => handleVerifyHandshake(tx.id)}
                            >
                              <span>{verifyingHandshake ? "Verifying..." : "Verify & complete"}</span>
                            </Button>
                          </div>
                          <p className="mt-2 text-xs text-text-tertiary">
                            Ask the buyer for their PIN upon handing over the item to verify the exchange.
                          </p>

                          {/* Seller QR Display Action */}
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2.5">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setSelectedUpiDeal(tx)}
                            >
                              <QrCode className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
                              <span>Show My UPI QR</span>
                            </Button>
                            <span className="text-xs text-text-tertiary">
                              Display payment QR for buyer to scan
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Review / Rating for Completed Deals */}
                  {tx.state === "COMPLETED" && !reviewedTxIds.has(tx.id) && (
                    <div className="mt-3">
                      {reviewTxId === tx.id ? (
                        <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
                          <div className="text-xs font-semibold text-text">
                            Rate your experience with {otherPartyName}
                          </div>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                onClick={() => setReviewRating(star)}
                                className={`text-xl transition-colors ${
                                  star <= reviewRating ? "text-warning" : "text-border-strong"
                                }`}
                              >
                                ★
                              </button>
                            ))}
                            <span className="ml-2 font-mono text-xs tabular-nums text-text-secondary">
                              {reviewRating}/5
                            </span>
                          </div>
                          <textarea
                            placeholder="Optional feedback..."
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            className="w-full rounded-md border border-border bg-surface p-2.5 text-xs text-text placeholder:text-text-tertiary focus:border-primary focus:outline-hidden"
                            rows={2}
                          />
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setReviewTxId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={submittingAction}
                              onClick={() => handleSubmitReview(tx.id)}
                            >
                              Submit review
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setReviewTxId(tx.id);
                            setReviewRating(5);
                            setReviewComment("");
                          }}
                        >
                          <Star className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>Leave a review</span>
                        </Button>
                      )}
                    </div>
                  )}

                  {tx.state === "COMPLETED" && reviewedTxIds.has(tx.id) && (
                    <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-success">
                      <Check className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>Review submitted</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Counter Offer Inline Form */}
              {counterTxId === tx.id && (
                <div className="my-3 rounded-md border border-border bg-surface-muted p-4 space-y-3">
                  <div className="text-xs font-semibold text-text">Propose counter-offer</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      label="Counter price (₹)"
                      type="number"
                      placeholder="e.g. 350"
                      value={counterAmount}
                      onChange={(e) => setCounterAmount(e.target.value)}
                    />
                    <Input
                      label="Note to other party"
                      placeholder="e.g. Can meet after 4 PM at library"
                      value={counterMsg}
                      onChange={(e) => setCounterMsg(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCounterTxId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!counterAmount || submittingAction}
                      onClick={() =>
                        handleAction(tx.id, "counter", {
                          counter_amount: Number(counterAmount),
                          message: counterMsg || null,
                        })
                      }
                    >
                      Submit counter-offer
                    </Button>
                  </div>
                </div>
              )}

              {/* Bottom Action Strip */}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                {needsMyResponse ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {(tx.state === "PENDING" || tx.state === "COUNTERED") && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={submittingAction}
                          onClick={() => handleAction(tx.id, "accept")}
                        >
                          <Check className="h-4 w-4" strokeWidth={2} />
                          <span>Accept offer</span>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={submittingAction}
                          onClick={() => {
                            setCounterTxId(tx.id);
                            setCounterAmount(String(lastOffer?.amount || tx.agreed_price || ""));
                          }}
                        >
                          <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
                          <span>Counter</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={submittingAction}
                          onClick={() => handleAction(tx.id, "reject")}
                        >
                          <span>Decline</span>
                        </Button>
                      </>
                    )}

                    {tx.state === "ACCEPTED" && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={submittingAction}
                        onClick={() => handleAction(tx.id, "confirm")}
                      >
                        <Unlock className="h-4 w-4" strokeWidth={1.75} />
                        <span>Confirm deal &amp; unlock location</span>
                      </Button>
                    )}

                    {tx.state === "CONFIRMED" && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={submittingAction}
                        onClick={() => handleAction(tx.id, "complete")}
                      >
                        <Check className="h-4 w-4" strokeWidth={2} />
                        <span>Sign off handover</span>
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-text-tertiary">
                    {["PENDING", "COUNTERED"].includes(tx.state)
                      ? "Awaiting counterparty response"
                      : tx.state === "CONFIRMED"
                      ? "Waiting for counterparty to sign off"
                      : ""}
                  </div>
                )}

                {/* Cancel deal option for unfinalized transactions */}
                {!["COMPLETED", "REJECTED", "CANCELLED"].includes(tx.state) && (
                  <button
                    type="button"
                    disabled={submittingAction}
                    onClick={() => {
                      if (confirm("Are you sure you want to cancel this deal?")) {
                        handleAction(tx.id, "cancel");
                      }
                    }}
                    className="ml-auto text-xs text-text-tertiary hover:text-danger transition-colors"
                  >
                    Cancel deal
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Direct UPI Payment / QR Modal */}
      {selectedUpiDeal && (
        <UpiPaymentModal
          isOpen={!!selectedUpiDeal}
          onClose={() => setSelectedUpiDeal(null)}
          sellerName={
            selectedUpiDeal.seller_id === currentUser?.id
              ? "You (Seller)"
              : selectedUpiDeal.seller?.full_name || "Campus Seller"
          }
          defaultUpiId={
            typeof window !== "undefined"
              ? localStorage.getItem(`px_upi_seller_${selectedUpiDeal.seller_id}`) || ""
              : ""
          }
          amount={selectedUpiDeal.agreed_price || selectedUpiDeal.product?.price || 0}
          dealId={selectedUpiDeal.id}
          productTitle={selectedUpiDeal.product?.title}
          isSeller={selectedUpiDeal.seller_id === currentUser?.id}
          onUpiIdSaved={(savedUpi) => {
            if (typeof window !== "undefined") {
              localStorage.setItem(`px_upi_seller_${selectedUpiDeal.seller_id}`, savedUpi);
            }
            showToast("UPI ID saved for this deal", "success");
          }}
        />
      )}
    </div>
  );
}
