"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { buildUpiUri, isValidUpiId, formatInr } from "@/lib/upi";
import { Copy, Check, ExternalLink, ShieldCheck } from "lucide-react";

interface UpiPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerName: string;
  defaultUpiId?: string;
  amount: number;
  dealId: number | string;
  productTitle?: string;
  isSeller?: boolean;
  onUpiIdSaved?: (upiId: string) => void;
}

export default function UpiPaymentModal({
  isOpen,
  onClose,
  sellerName,
  defaultUpiId = "",
  amount,
  dealId,
  productTitle,
  isSeller = false,
  onUpiIdSaved,
}: UpiPaymentModalProps) {
  const [upiId, setUpiId] = useState(defaultUpiId || "");
  const [copied, setCopied] = useState(false);
  const [editMode, setEditMode] = useState(!defaultUpiId);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isVpaValid = useMemo(() => isValidUpiId(upiId), [upiId]);

  const upiUri = useMemo(() => {
    if (!isVpaValid) return "";
    return buildUpiUri({
      upiId,
      payeeName: sellerName,
      amount,
      transactionRefId: dealId,
      transactionNote: `PX${dealId} ${productTitle || "Campus item"}`.slice(0, 50),
    });
  }, [isVpaValid, upiId, sellerName, amount, dealId, productTitle]);

  // Generate QR using the battle-tested `qrcode` npm package
  useEffect(() => {
    if (!upiUri) {
      setQrDataUrl(null);
      setQrError(false);
      return;
    }
    let cancelled = false;
    setQrError(false);

    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(upiUri, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
        color: { dark: "#161A18", light: "#FFFFFF" },
      }).then((url) => {
        if (!cancelled) setQrDataUrl(url);
      }).catch(() => {
        if (!cancelled) setQrError(true);
      });
    }).catch(() => {
      if (!cancelled) setQrError(true);
    });

    return () => { cancelled = true; };
  }, [upiUri]);

  const handleCopyUpi = () => {
    if (!upiId) return;
    navigator.clipboard.writeText(upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveUpi = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isVpaValid) {
      if (onUpiIdSaved) onUpiIdSaved(upiId.trim());
      setEditMode(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isSeller ? "Manage Your UPI Payment ID" : "Direct Student UPI Payment"}
      className="max-w-md"
    >
      <div className="space-y-4">
        {/* Deal Summary Strip */}
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-muted p-3 text-xs">
          <div>
            <div className="text-text-tertiary">Agreed Deal Price</div>
            <div className="font-mono text-base font-semibold tabular-nums text-text mt-0.5">
              {formatInr(amount)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-text-tertiary">{isSeller ? "Buyer" : "Payee"}</div>
            <div className="font-medium text-text mt-0.5">{sellerName}</div>
          </div>
        </div>

        {/* UPI ID Configuration / Display */}
        {editMode ? (
          <form onSubmit={handleSaveUpi} className="space-y-2 rounded-md border border-border bg-surface p-3 text-xs">
            <Input
              label={isSeller ? "Your UPI ID / VPA" : "Seller's UPI ID / VPA"}
              placeholder="e.g. name@okhdfcbank or 9876543210@paytm"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value.trim())}
              helperText="Supported: @okhdfcbank, @okicici, @paytm, @ybl, @upi, @ibl, etc."
              required
            />
            {!isVpaValid && upiId.length > 2 && (
              <p className="text-[11px] text-danger">Please enter a valid format: user@bank</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              {defaultUpiId && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditMode(false)}>
                  Cancel
                </Button>
              )}
              <Button type="submit" variant="primary" size="sm" disabled={!isVpaValid}>
                {isSeller ? "Save My UPI ID" : "Confirm UPI ID"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-border bg-surface p-3 text-xs">
            <div>
              <div className="text-text-tertiary">Payee UPI ID</div>
              <div className="font-mono text-sm font-semibold text-text mt-0.5">{upiId}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="secondary" size="sm" onClick={handleCopyUpi}>
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditMode(true)}>
                Change
              </Button>
            </div>
          </div>
        )}

        {/* QR Code */}
        {isVpaValid && !editMode && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-white p-5 text-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="UPI Payment QR Code"
                className="mx-auto block"
                style={{ width: 200, height: 200, imageRendering: "pixelated" }}
              />
            ) : qrError ? (
              <div className="text-xs text-danger py-6">Could not generate QR. Use the UPI link below.</div>
            ) : (
              <div className="w-[200px] h-[200px] flex items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
              </div>
            )}
            <p className="mt-3 text-xs text-text-secondary">
              Scan with <strong>Google Pay</strong>, <strong>PhonePe</strong>, <strong>Paytm</strong>, or any UPI app
            </p>
            <p className="mt-1 text-[11px] text-text-tertiary font-mono break-all px-2">{upiId}</p>
          </div>
        )}

        {/* Direct Mobile Intent Button */}
        {isVpaValid && upiUri && !editMode && (
          <div className="space-y-2">
            <a href={upiUri} className="block w-full">
              <Button variant="primary" className="w-full">
                <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
                <span>Open UPI App directly (Mobile)</span>
              </Button>
            </a>
            <p className="text-center text-[11px] text-text-tertiary">
              Tap to launch Google Pay, PhonePe, or Paytm with the amount pre-filled
            </p>
          </div>
        )}

        {/* Trust Disclaimer */}
        <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary-subtle p-3 text-xs text-primary">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="flex-1 leading-relaxed">
            <strong>Campus Handshake Rule:</strong> Pay the seller only after meeting at the campus landmark and verifying the item in person. Exchange the 6-digit Handshake PIN to complete the transaction.
          </div>
        </div>
      </div>
    </Modal>
  );
}
