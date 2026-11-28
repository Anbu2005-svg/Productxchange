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
  const cleanUpi = upiId.trim().toLowerCase();
  const cleanName = (payeeName.trim() || "Campus Student")
    .replace(/[&=?#]/g, "")  // Strip UPI-unsafe chars from name
    .slice(0, 50);            // Keep payee name short
  const formattedAmount = amount > 0 ? amount.toFixed(2) : "0.00";
  const note = (transactionNote || `ProductXchange Deal ${transactionRefId ? `#${transactionRefId}` : ""}`)
    .replace(/[&=?#]/g, "")
    .slice(0, 50);

  // Build the URI manually with encodeURIComponent (NOT URLSearchParams which uses + for spaces)
  const parts: string[] = [
    `pa=${encodeURIComponent(cleanUpi)}`,
    `pn=${encodeURIComponent(cleanName)}`,
    `am=${encodeURIComponent(formattedAmount)}`,
    `cu=INR`,
    `tn=${encodeURIComponent(note)}`,
  ];

  if (transactionRefId) {
    parts.push(`tr=${encodeURIComponent(`PX${transactionRefId}`)}`);
  }

  return `upi://pay?${parts.join("&")}`;
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
