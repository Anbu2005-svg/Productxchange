"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, X, Check, RotateCcw, AlertCircle } from "lucide-react";
import Button from "@/components/ui/Button";

interface CameraCaptureModalProps {
  isOpen: boolean;
  title?: string;
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function CameraCaptureModal({
  isOpen,
  title = "Take a photo",
  onCapture,
  onClose,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode: "environment" | "user") => {
      stopStream();
      setError(null);
      setStarting(true);

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("Live camera preview is not supported in this browser. Use device camera below.");
        setStarting(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
          setError("Camera permission denied. Allow camera access or use device camera below.");
        } else if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
          setError("No camera detected on this device.");
        } else {
          setError("Could not open camera. You can still use the device camera button below.");
        }
      } finally {
        setStarting(false);
      }
    },
    [stopStream]
  );

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      setCapturedUrl(null);
      setCapturedFile(null);
      setError(null);
      return;
    }

    if (!capturedUrl) {
      startCamera(facingMode);
    }

    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, capturedUrl, startCamera, stopStream]);

  if (!isOpen) return null;

  function handleSnap() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-photo-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const preview = URL.createObjectURL(blob);
        stopStream();
        setCapturedFile(file);
        setCapturedUrl(preview);
      },
      "image/jpeg",
      0.9
    );
  }

  function handleRetake() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(null);
    setCapturedFile(null);
  }

  function handleConfirm() {
    if (!capturedFile) return;
    onCapture(capturedFile);
    onClose();
  }

  function handleFallbackFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" strokeWidth={1.75} />
            <h3 className="text-sm font-semibold text-text">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-tertiary hover:bg-surface-muted hover:text-text"
            aria-label="Close camera"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-black flex items-center justify-center">
            {capturedUrl ? (
              <img
                src={capturedUrl}
                alt="Captured preview"
                className="h-full w-full object-contain"
              />
            ) : error ? (
              <div className="flex flex-col items-center gap-3 p-6 text-center text-white">
                <AlertCircle className="h-8 w-8 text-danger" strokeWidth={1.75} />
                <p className="text-xs text-white/80 max-w-xs">{error}</p>
                <button
                  type="button"
                  onClick={() => fallbackInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-on-primary hover:bg-primary-hover"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Open device camera
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="h-full w-full object-cover"
                />
                {starting && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">
                    Starting camera...
                  </div>
                )}
              </>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />
          <input
            ref={fallbackInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFallbackFile}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            {capturedUrl ? (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={handleRetake}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Retake</span>
                </Button>
                <Button type="button" variant="primary" size="sm" onClick={handleConfirm}>
                  <Check className="h-3.5 w-3.5" />
                  <span>Use photo</span>
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))
                  }
                  disabled={starting || Boolean(error)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Flip camera</span>
                </Button>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleSnap}
                    disabled={starting || Boolean(error)}
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>Capture</span>
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

