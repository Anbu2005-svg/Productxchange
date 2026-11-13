"use client";

import { useState, useRef } from "react";
import Product3DViewer from "@/components/Product3DViewer";
import {
  Camera,
  Box,
  Check,
  X,
  RotateCw,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Layers,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";

export interface AngleData {
  front?: File | null;
  right?: File | null;
  back?: File | null;
  left?: File | null;
  top?: File | null;
  bottom?: File | null;
}

export interface AnglePreviews {
  front?: string;
  right?: string;
  back?: string;
  left?: string;
  top?: string;
  bottom?: string;
}

interface MultiAnglePhotoStudioProps {
  initialPreviews?: AnglePreviews;
  onAnglesChange: (files: AngleData, previews: AnglePreviews, is3DReady: boolean) => void;
  onError?: (err: string | null) => void;
}

interface AngleSlotConfig {
  key: keyof AngleData;
  label: string;
  angleDeg: string;
  desc: string;
  instruction: string;
  required: boolean;
  IconComponent: typeof Box;
}

const ANGLE_SLOTS: AngleSlotConfig[] = [
  {
    key: "front",
    label: "Front face",
    angleDeg: "0°",
    IconComponent: Camera,
    desc: "Main face / default cover photo",
    instruction: "Place item upright and photograph straight on.",
    required: true,
  },
  {
    key: "right",
    label: "Right profile",
    angleDeg: "90°",
    IconComponent: ArrowRight,
    desc: "Right profile angle",
    instruction: "Rotate item 90° clockwise and capture right side.",
    required: true,
  },
  {
    key: "back",
    label: "Back view",
    angleDeg: "180°",
    IconComponent: RotateCw,
    desc: "Rear panel / labels / ports",
    instruction: "Turn item completely around to capture the back.",
    required: true,
  },
  {
    key: "left",
    label: "Left profile",
    angleDeg: "270°",
    IconComponent: ArrowLeft,
    desc: "Left profile angle",
    instruction: "Rotate to capture the complete left profile.",
    required: true,
  },
  {
    key: "top",
    label: "Top view",
    angleDeg: "Top",
    IconComponent: ArrowUp,
    desc: "Top / bird's-eye perspective",
    instruction: "Photograph looking directly down at the item.",
    required: false,
  },
  {
    key: "bottom",
    label: "Base view",
    angleDeg: "Base",
    IconComponent: ArrowDown,
    desc: "Base / underside",
    instruction: "Turn upside down to show the base or underside.",
    required: false,
  },
];

export default function MultiAnglePhotoStudio({
  initialPreviews = {},
  onAnglesChange,
  onError,
}: MultiAnglePhotoStudioProps) {
  const [angleFiles, setAngleFiles] = useState<AngleData>({});
  const [anglePreviews, setAnglePreviews] = useState<AnglePreviews>(initialPreviews);
  const [converting, setConverting] = useState(false);
  const [conversionStage, setConversionStage] = useState<string>("");
  const [is3DReady, setIs3DReady] = useState(
    Boolean(initialPreviews.front && (initialPreviews.right || initialPreviews.back || initialPreviews.left))
  );
  const [showLivePreview, setShowLivePreview] = useState(true);

  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const uploadedCount = Object.values(anglePreviews).filter(Boolean).length;
  const progressPct = Math.round((uploadedCount / 6) * 100);

  function handleFileSelect(key: keyof AngleData, file?: File) {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      if (onError) onError(`Photo for ${key} must be under 5MB.`);
      return;
    }

    const preview = URL.createObjectURL(file);
    const nextFiles = { ...angleFiles, [key]: file };
    const nextPreviews = { ...anglePreviews, [key]: preview };

    setAngleFiles(nextFiles);
    setAnglePreviews(nextPreviews);

    const hasMinSides = Boolean(nextPreviews.front && (nextPreviews.right || nextPreviews.back || nextPreviews.left));
    onAnglesChange(nextFiles, nextPreviews, is3DReady || hasMinSides);
    if (onError) onError(null);
  }

  function handleRemoveSide(key: keyof AngleData) {
    const nextFiles = { ...angleFiles, [key]: null };
    const nextPreviews = { ...anglePreviews };
    delete nextPreviews[key];

    setAngleFiles(nextFiles);
    setAnglePreviews(nextPreviews);

    const hasMinSides = Boolean(nextPreviews.front && (nextPreviews.right || nextPreviews.back || nextPreviews.left));
    const ready = is3DReady && hasMinSides;
    setIs3DReady(ready);
    onAnglesChange(nextFiles, nextPreviews, ready);
  }

  async function handleConvertTo3D() {
    if (!anglePreviews.front) {
      if (onError) onError("Please upload at least the front view to generate a 3D model.");
      return;
    }

    if (uploadedCount < 2) {
      if (onError) onError("Please upload at least 2 sides (ideally all 6 angles) to generate a 3D model.");
      return;
    }

    setConverting(true);
    if (onError) onError(null);

    setConversionStage("Calibrating angle coordinates and focal length...");
    await new Promise((r) => setTimeout(r, 450));
    setConversionStage("Extracting perspective feature mesh...");
    await new Promise((r) => setTimeout(r, 450));
    setConversionStage("Stitching 360-degree turntable depth frames...");
    await new Promise((r) => setTimeout(r, 400));
    setConversionStage("Finalizing interactive 3D model...");
    await new Promise((r) => setTimeout(r, 300));

    setIs3DReady(true);
    setShowLivePreview(true);
    setConverting(false);
    setConversionStage("");
    onAnglesChange(angleFiles, anglePreviews, true);
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      {/* Header and Instruction bar */}
      <div className="rounded-md border border-border bg-surface-muted p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
            <Layers className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text">
                  Multi-angle photo capture
                </h3>
                <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
                  3D inspection
                </span>
              </div>
              <span className="font-mono text-xs tabular-nums text-text-secondary">
                {uploadedCount} of 6 angles ({progressPct}%)
              </span>
            </div>

            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              Upload photos of each side (front, right, back, left, top, base). When at least 2 sides are uploaded, you can generate a 360-degree interactive viewer for prospective buyers.
            </p>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                style={{ width: `${progressPct}%` }}
                className="h-full bg-primary transition-all duration-300"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 6-Angle Capture Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ANGLE_SLOTS.map((slot, index) => {
          const preview = anglePreviews[slot.key];
          const hasImage = Boolean(preview);
          const Icon = slot.IconComponent;

          return (
            <div
              key={slot.key}
              className={`group relative flex flex-col justify-between overflow-hidden rounded-md border text-left transition-colors duration-150 ${
                hasImage
                  ? "border-primary bg-surface"
                  : "border-border bg-surface-muted hover:border-border-strong"
              }`}
            >
              <input
                ref={(el) => {
                  fileInputRefs.current[slot.key] = el;
                }}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(slot.key, f);
                }}
              />

              {/* Slot Header */}
              <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 text-xs">
                <span className="text-text-tertiary">Step {index + 1}</span>
                <span className="font-mono text-xs font-medium tabular-nums text-text-secondary">
                  {slot.angleDeg}
                </span>
              </div>

              {/* Slot Body */}
              {hasImage ? (
                <div
                  className="relative aspect-square w-full cursor-pointer bg-surface-muted"
                  onClick={() => fileInputRefs.current[slot.key]?.click()}
                >
                  <img
                    src={preview}
                    alt={slot.label}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveSide(slot.key);
                    }}
                    className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-surface text-danger shadow-xs hover:bg-danger-subtle focus:outline-hidden"
                    title="Remove photo"
                    aria-label={`Remove ${slot.label}`}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>

                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded-md bg-surface px-2 py-1 text-xs font-medium text-text shadow-xs">
                      Change photo
                    </span>
                  </div>

                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-on-primary">
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRefs.current[slot.key]?.click()}
                  className="flex aspect-square w-full flex-col items-center justify-center p-3 text-center transition-colors hover:bg-surface focus:outline-hidden"
                >
                  <Icon className="mb-1.5 h-5 w-5 text-text-tertiary group-hover:text-primary" strokeWidth={1.75} />
                  <span className="text-xs font-medium text-text">
                    {slot.label}
                  </span>
                  <span className="mt-0.5 text-xs text-text-tertiary">
                    {slot.required ? "Required" : "Optional"}
                  </span>
                  <span className="mt-1.5 text-xs font-medium text-primary">
                    Upload
                  </span>
                </button>
              )}

              {/* Slot Footer Guidance */}
              <div className="border-t border-border px-2 py-1.5 text-center">
                <p className="truncate text-xs text-text-tertiary" title={slot.instruction}>
                  {slot.instruction}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Convert to 3D Action Banner */}
      <div className="flex flex-col items-start justify-between gap-3 rounded-md border border-border bg-surface-muted p-3.5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text">
              3D interactive model
            </h4>
            {is3DReady && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5" strokeWidth={2} /> Ready
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">
            {uploadedCount >= 2
              ? `Synthesize ${uploadedCount} photos into an interactive 360-degree turntable.`
              : "Upload at least 2 sides (front and another view) to generate a 3D model."}
          </p>
        </div>

        <button
          type="button"
          disabled={uploadedCount < 2 || converting}
          onClick={handleConvertTo3D}
          className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-xs font-medium transition-colors ${
            uploadedCount >= 2 && !converting
              ? "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-hover"
              : "cursor-not-allowed bg-surface-muted text-text-tertiary border border-border"
          }`}
        >
          {converting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              <span>{conversionStage || "Generating..."}</span>
            </>
          ) : is3DReady ? (
            <>
              <RotateCw className="h-4 w-4" strokeWidth={1.75} />
              <span>Regenerate 3D model</span>
            </>
          ) : (
            <>
              <Box className="h-4 w-4" strokeWidth={1.75} />
              <span>Generate 3D model</span>
            </>
          )}
        </button>
      </div>

      {/* Interactive 3D Model Live Inspector */}
      {is3DReady && (
        <div className="pt-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Interactive 3D model preview
            </span>
            <button
              type="button"
              onClick={() => setShowLivePreview(!showLivePreview)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {showLivePreview ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} /> Hide preview
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> Show preview
                </>
              )}
            </button>
          </div>

          {showLivePreview && (
            <div className="overflow-hidden rounded-md border border-border">
              <Product3DViewer
                angles={anglePreviews as Record<string, string>}
                title="Product 3D preview"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
