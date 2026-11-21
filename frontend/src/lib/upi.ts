/**
 * NPCI UPI Intent & URI Helper for ProductXchange
 *
 * Implements standard Indian UPI deep linking:
 * upi://pay?pa={upi_id}&pn={payee_name}&am={amount}&cu=INR&tn={transaction_note}
 */

export interface UpiPaymentDetails {
  upiId: string;
  payeeName: string;
  amount: number;
  transactionNote?: string;
  transactionRefId?: string | number;
}

/**
 * Validates a standard Indian UPI Virtual Payment Address (VPA) / UPI ID.
 * Examples: student@okhdfcbank, 9876543210@paytm, user@ybl
 */
export function isValidUpiId(upiId: string): boolean {
  if (!upiId || typeof upiId !== "string") return false;
  const trimmed = upiId.trim();
  const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9.\-_]{2,64}$/;
  return upiRegex.test(trimmed);
}

/**
 * Builds a standard NPCI UPI URI string.
 */
export function buildUpiUri(details: UpiPaymentDetails): string {
  const { upiId, payeeName, amount, transactionNote, transactionRefId } = details;
  const cleanUpi = upiId.trim();
  const cleanName = payeeName.trim() || "Campus Student";
  const formattedAmount = amount > 0 ? amount.toFixed(2) : "0.00";
  const note = transactionNote || `ProductXchange Deal ${transactionRefId ? `#${transactionRefId}` : ""}`;

  const params = new URLSearchParams();
  params.set("pa", cleanUpi);
  params.set("pn", cleanName);
  params.set("am", formattedAmount);
  params.set("cu", "INR");
  params.set("tn", note);

  if (transactionRefId) {
    params.set("tr", `PX${transactionRefId}`);
  }

  return `upi://pay?${params.toString()}`;
}

/**
 * Formats a currency string using Indian Numbering System (e.g. ₹1,24,000).
 */
export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
