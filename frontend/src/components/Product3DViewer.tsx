"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { resolveImageUrl } from "@/lib/api";
import { Play, Pause, ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, Box, RotateCw } from "lucide-react";

interface Product3DViewerProps {
  angles?: Record<string, string> | null;
  imageUrls?: string[];
  title?: string;
  className?: string;
}

type ViewMode = "turntable" | "box3d";

export default function Product3DViewer({
  angles,
  imageUrls = [],
  title = "Product",
  className = "",
}: Product3DViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("turntable");
  const [rotationY, setRotationY] = useState(0);
  const [rotationX, setRotationX] = useState(15);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [autoRotate, setAutoRotate] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const sidePhotos = {
    front: angles?.front || imageUrls[0] || "",
    right: angles?.right || imageUrls[1] || angles?.front || imageUrls[0] || "",
    back: angles?.back || imageUrls[2] || angles?.front || imageUrls[0] || "",
    left: angles?.left || imageUrls[3] || angles?.right || imageUrls[0] || "",
    top: angles?.top || imageUrls[4] || angles?.front || imageUrls[0] || "",
    bottom: angles?.bottom || imageUrls[5] || angles?.back || imageUrls[0] || "",
  };

  const normalizedY = ((rotationY % 360) + 360) % 360;

  let activeTurntableSide: "front" | "right" | "back" | "left" | "top" | "bottom" = "front";
  let activeAngleLabel = "Front";

  if (rotationX < -25 && sidePhotos.top) {
    activeTurntableSide = "top";
    activeAngleLabel = "Top";
  } else if (rotationX > 25 && sidePhotos.bottom) {
    activeTurntableSide = "bottom";
    activeAngleLabel = "Bottom";
  } else if (normalizedY >= 45 && normalizedY < 135) {
    activeTurntableSide = "right";
    activeAngleLabel = "Right";
  } else if (normalizedY >= 135 && normalizedY < 225) {
    activeTurntableSide = "back";
    activeAngleLabel = "Back";
  } else if (normalizedY >= 225 && normalizedY < 315) {
    activeTurntableSide = "left";
    activeAngleLabel = "Left";
  } else {
    activeTurntableSide = "front";
    activeAngleLabel = "Front";
  }

  const currentTurntableImage = sidePhotos[activeTurntableSide] || sidePhotos.front;

  useEffect(() => {
    if (!autoRotate || isDragging) return;
    const interval = setInterval(() => {
      setRotationY((prev) => (prev + 1.2) % 360);
    }, 30);
    return () => clearInterval(interval);
  }, [autoRotate, isDragging]);

  const handlePointerDown = (clientX: number, clientY: number) => {
    setIsDragging(true);
    setAutoRotate(false);
    setDragStart({ x: clientX, y: clientY });
  };

  const handlePointerMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging) return;
      const deltaX = clientX - dragStart.x;
      const deltaY = clientY - dragStart.y;
      const sensitivity = 0.8;

      setRotationY((prev) => prev + deltaX * sensitivity);
      setRotationX((prev) => Math.min(45, Math.max(-45, prev - deltaY * 0.4)));
      setDragStart({ x: clientX, y: clientY });
    },
    [isDragging, dragStart]
  );

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.min(2.0, Math.max(0.6, prev + delta)));
  };

  const resetView = () => {
    setRotationY(0);
    setRotationX(15);
    setZoom(1);
    setAutoRotate(true);
  };

  return (
    <div
      ref={containerRef}
      className={`relative select-none rounded-md overflow-hidden bg-surface-muted border border-border ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none bg-surface" : ""
      } ${className}`}
      onMouseDown={(e) => handlePointerDown(e.clientX, e.clientY)}
      onMouseMove={(e) => handlePointerMove(e.clientX, e.clientY)}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerUp}
      onTouchStart={(e) => {
        if (e.touches.length === 1) {
          handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 1) {
          handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchEnd={handlePointerUp}
    >
      {/* Top Toolbar */}
      <div className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-1 bg-surface border border-border rounded-sm p-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewMode("turntable");
            }}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-xs transition-colors ${
              viewMode === "turntable"
                ? "bg-surface-muted text-text font-semibold"
                : "text-text-secondary hover:text-text"
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Turntable</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewMode("box3d");
            }}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-xs transition-colors ${
              viewMode === "box3d"
                ? "bg-surface-muted text-text font-semibold"
                : "text-text-secondary hover:text-text"
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>Box view</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-0.5 bg-surface border border-border rounded-sm p-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAutoRotate(!autoRotate);
            }}
            aria-label={autoRotate ? "Pause rotation" : "Start rotation"}
            className="p-1 rounded-xs text-text-secondary hover:text-text"
          >
            {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleZoom(0.2);
            }}
            aria-label="Zoom in"
            className="p-1 rounded-xs text-text-secondary hover:text-text"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleZoom(-0.2);
            }}
            aria-label="Zoom out"
            className="p-1 rounded-xs text-text-secondary hover:text-text"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
            aria-label="Reset view"
            className="p-1 rounded-xs text-text-secondary hover:text-text"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsFullscreen(!isFullscreen);
            }}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="p-1 rounded-xs text-text-secondary hover:text-text"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 3D Scene Viewport */}
      <div
        className={`w-full ${
          isFullscreen ? "h-screen" : "aspect-[4/3] sm:aspect-[16/10] max-h-[460px]"
        } flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing relative`}
        style={{ perspective: "1000px" }}
      >
        {viewMode === "turntable" && (
          <div
            className="relative flex items-center justify-center transition-transform duration-75 ease-out"
            style={{
              transform: `scale(${zoom}) rotateX(${-rotationX * 0.3}deg)`,
            }}
          >
            {currentTurntableImage ? (
              <img
                src={resolveImageUrl(currentTurntableImage)}
                alt={`${title} - ${activeAngleLabel}`}
                className="max-h-[320px] max-w-[85%] object-contain pointer-events-none"
              />
            ) : (
              <div className="text-xs text-text-tertiary">No angle photos</div>
            )}
          </div>
        )}

        {viewMode === "box3d" && (
          <div
            className="relative w-48 h-48 sm:w-56 sm:h-56 transition-transform duration-75 ease-out"
            style={{
              transformStyle: "preserve-3d",
              transform: `scale(${zoom}) rotateX(${-rotationX}deg) rotateY(${rotationY}deg)`,
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 border border-border bg-surface overflow-hidden flex items-center justify-center"
              style={{ transform: "translateZ(96px)" }}
            >
              {sidePhotos.front ? (
                <img src={resolveImageUrl(sidePhotos.front)} alt="Front" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-text-tertiary">Front</span>
              )}
            </div>
            {/* Back */}
            <div
              className="absolute inset-0 border border-border bg-surface overflow-hidden flex items-center justify-center"
              style={{ transform: "rotateY(180deg) translateZ(96px)" }}
            >
              {sidePhotos.back ? (
                <img src={resolveImageUrl(sidePhotos.back)} alt="Back" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-text-tertiary">Back</span>
              )}
            </div>
            {/* Right */}
            <div
              className="absolute inset-0 border border-border bg-surface overflow-hidden flex items-center justify-center"
              style={{ transform: "rotateY(90deg) translateZ(96px)" }}
            >
              {sidePhotos.right ? (
                <img src={resolveImageUrl(sidePhotos.right)} alt="Right" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-text-tertiary">Right</span>
              )}
            </div>
            {/* Left */}
            <div
              className="absolute inset-0 border border-border bg-surface overflow-hidden flex items-center justify-center"
              style={{ transform: "rotateY(-90deg) translateZ(96px)" }}
            >
              {sidePhotos.left ? (
                <img src={resolveImageUrl(sidePhotos.left)} alt="Left" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-text-tertiary">Left</span>
              )}
            </div>
            {/* Top */}
            <div
              className="absolute inset-0 border border-border bg-surface overflow-hidden flex items-center justify-center"
              style={{ transform: "rotateX(90deg) translateZ(96px)" }}
            >
              {sidePhotos.top ? (
                <img src={resolveImageUrl(sidePhotos.top)} alt="Top" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-text-tertiary">Top</span>
              )}
            </div>
            {/* Bottom */}
            <div
              className="absolute inset-0 border border-border bg-surface overflow-hidden flex items-center justify-center"
              style={{ transform: "rotateX(-90deg) translateZ(96px)" }}
            >
              {sidePhotos.bottom ? (
                <img src={resolveImageUrl(sidePhotos.bottom)} alt="Bottom" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-text-tertiary">Bottom</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Angle Indicator */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-xs text-text-tertiary px-2 pointer-events-none">
        <span>Drag to rotate</span>
        <span className="font-medium text-text-secondary">{activeAngleLabel}</span>
      </div>
    </div>
  );
}
