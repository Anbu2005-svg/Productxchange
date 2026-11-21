"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { lookupIsbn, BookMetadata, normalizeIsbn, isValidIsbn } from "@/lib/isbn";
import { Camera, Search, Sparkles, AlertCircle, BookOpen, Upload, RefreshCw } from "lucide-react";

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookFound: (book: BookMetadata) => void;
}

export default function BarcodeScannerModal({
  isOpen,
  onClose,
  onBookFound,
}: BarcodeScannerModalProps) {
  const [activeTab, setActiveTab] = useState<"camera" | "manual" | "photo">("camera");
  const [manualIsbn, setManualIsbn] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stop camera stream safely
  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Handle successful detection
  const handleDetectSuccess = useCallback(
    async (rawCode: string) => {
      const isbn = normalizeIsbn(rawCode);
      if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
        return;
      }
      stopCamera();
      setLoading(true);
      setError(null);
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate(100);
        }
        const book = await lookupIsbn(isbn);
        onBookFound(book);
        onClose();
      } catch (err: any) {
        setError(err.message || "Failed to find book details for this barcode");
      } finally {
        setLoading(false);
      }
    },
    [onBookFound, onClose, stopCamera]
  );

  // Start camera and continuous barcode detection
  const startCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraSupported(false);
      setActiveTab("manual");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);

        // Check for native BarcodeDetector API
        if ("BarcodeDetector" in window) {
          const detector = new (window as any).BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
          });

          const scanLoop = async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) {
              animFrameRef.current = requestAnimationFrame(scanLoop);
              return;
            }
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes && barcodes.length > 0) {
                const detectedVal = barcodes[0].rawValue;
                if (detectedVal) {
                  await handleDetectSuccess(detectedVal);
                  return;
                }
              }
            } catch {
              // Ignore single frame detection errors
            }
            animFrameRef.current = requestAnimationFrame(scanLoop);
          };

          animFrameRef.current = requestAnimationFrame(scanLoop);
        }
      }
    } catch (err: any) {
      console.warn("Camera start error:", err);
      setCameraActive(false);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Camera permission was denied. Please enter the ISBN manually below.");
      } else {
        setError("Could not access camera. Please enter the ISBN manually below.");
      }
      setActiveTab("manual");
    }
  }, [handleDetectSuccess]);

  // Lifecycle when modal opens/closes or tab changes
  useEffect(() => {
    if (isOpen && activeTab === "camera") {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab, startCamera, stopCamera]);

  // Handle manual ISBN submission
  async function handleManualLookup(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const cleaned = normalizeIsbn(manualIsbn);
    if (!cleaned) {
      setError("Please enter a valid 10 or 13-digit ISBN");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const book = await lookupIsbn(cleaned);
      onBookFound(book);
      onClose();
    } catch (err: any) {
      setError(err.message || "Book not found. You can still enter details manually.");
    } finally {
      setLoading(false);
    }
  }

  // Handle barcode photo upload
  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const imageBitmap = await createImageBitmap(file);

      if ("BarcodeDetector" in window) {
        const detector = new (window as any).BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
        });
        const barcodes = await detector.detect(imageBitmap);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          await handleDetectSuccess(barcodes[0].rawValue);
          return;
        }
      }
      setError("Could not detect a clear barcode from that image. Try entering the ISBN numbers printed below the barcode.");
      setActiveTab("manual");
    } catch (err: any) {
      setError(err.message || "Failed to process image. Please enter the ISBN manually.");
      setActiveTab("manual");
    } finally {
      setLoading(false);
    }
  }

  // Sample ISBNs for fast demo
  const DEMO_ISBNS = [
    { label: "Engineering Mathematics", isbn: "9780470458365" },
    { label: "Clean Code", isbn: "9780132350884" },
    { label: "Concepts of Physics", isbn: "9788177091878" },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Scan Book Barcode / ISBN" className="max-w-lg">
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex border-b border-border text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("camera")}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
              activeTab === "camera"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text"
            }`}
          >
            <Camera className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Live Camera</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("manual")}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
              activeTab === "manual"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text"
            }`}
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Enter ISBN</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("photo")}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
              activeTab === "photo"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text"
            }`}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Upload Photo</span>
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger/5 p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* Tab 1: Live Camera Scanner */}
        {activeTab === "camera" && (
          <div className="space-y-3">
            <div className="relative aspect-4/3 w-full overflow-hidden rounded-md border border-border bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
              />

              {/* Viewfinder Overlay Guide */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-44 w-64 rounded-lg border-2 border-primary/80 bg-primary/5">
                  <div className="absolute -top-1 -left-1 h-4 w-4 border-t-2 border-l-2 border-primary" />
                  <div className="absolute -top-1 -right-1 h-4 w-4 border-t-2 border-r-2 border-primary" />
                  <div className="absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-primary" />
                  <div className="absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-primary" />
                  {/* Subtle scan guide line */}
                  <div className="absolute inset-x-2 top-1/2 h-0.5 bg-primary/40 -translate-y-1/2" />
                </div>
              </div>

              {!cameraActive && !loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-muted/90 p-4 text-center">
                  <Camera className="h-8 w-8 text-text-tertiary mb-2" strokeWidth={1.5} />
                  <p className="text-xs text-text-secondary">Requesting camera access...</p>
                </div>
              )}

              {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/90 p-4 text-center">
                  <RefreshCw className="h-6 w-6 animate-spin text-primary mb-2" />
                  <p className="text-xs font-medium text-text">Looking up book details...</p>
                </div>
              )}
            </div>

            <p className="text-center text-xs text-text-secondary">
              Point camera at the barcode on the back of your textbook
            </p>
          </div>
        )}

        {/* Tab 2: Manual ISBN Input */}
        {activeTab === "manual" && (
          <form onSubmit={handleManualLookup} className="space-y-3">
            <Input
              label="10 or 13-digit ISBN"
              placeholder="e.g. 9780132350884"
              value={manualIsbn}
              onChange={(e) => setManualIsbn(e.target.value)}
              helperText="Find the ISBN number on the back cover or inside the copyright page"
              autoFocus
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={loading || !manualIsbn.trim()}
              >
                <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{loading ? "Searching..." : "Lookup Book"}</span>
              </Button>
            </div>

            {/* Quick Demo Pre-sets */}
            <div className="border-t border-border pt-3">
              <div className="text-[11px] font-medium text-text-tertiary mb-1.5">
                Quick test samples:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_ISBNS.map((item) => (
                  <button
                    key={item.isbn}
                    type="button"
                    onClick={() => {
                      setManualIsbn(item.isbn);
                      setError(null);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-border bg-surface-muted px-2 py-1 text-[11px] text-text-secondary hover:text-text hover:border-primary"
                  >
                    <BookOpen className="h-3 w-3 text-primary" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </form>
        )}

        {/* Tab 3: Upload Barcode Photo */}
        {activeTab === "photo" && (
          <div className="space-y-3 text-center">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border p-8 hover:border-primary hover:bg-surface-muted"
            >
              <Upload className="h-8 w-8 text-text-tertiary mb-2" strokeWidth={1.5} />
              <p className="text-xs font-medium text-text">Click to upload barcode photo</p>
              <p className="text-[11px] text-text-tertiary mt-0.5">
                Take a close-up photo of the barcode on the back cover
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>

            {loading && (
              <div className="flex items-center justify-center gap-2 text-xs text-text-secondary">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                <span>Detecting barcode and fetching book metadata...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
