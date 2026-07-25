"use client";

import { useEffect, useRef, useState } from "react";

// Phase 11 (extended, redesigned) — local mirror of the render pipeline's
// rotation-cover-scale formula. Same reasoning as ClipUploader's own FPS
// constant: this upload-time preview doesn't need to import the Remotion
// render pipeline (types/constants.ts) — duplicating this small formula
// keeps the upload UI decoupled from it. If the version in
// types/constants.ts ever changes, update this copy too.
const FRAME_ASPECT = 1080 / 1920; // 9:16

const getRotationCoverScale = (rotationDeg: number): number => {
  if (rotationDeg === 0) return 1;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const scaleForWidth = cos + sin / FRAME_ASPECT;
  const scaleForHeight = FRAME_ASPECT * sin + cos;
  return Math.max(scaleForWidth, scaleForHeight);
};

const MAX_INSET = 45;

type Edge = "top" | "bottom" | "left" | "right";

type DragState = {
  edge: Edge;
  startClientX: number;
  startClientY: number;
  startInset: number;
};

export type CropInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/**
 * Phase 11 (extended, redesigned) — a visual, drag-to-crop selector with
 * four independent edges: the video is shown at its "no crop" reference
 * framing (already straightened by rotationDeg, if set), and a dashed
 * rectangle represents what will actually be kept. Each of the 4 edges is
 * its own drag handle — dragging the top edge only ever changes
 * insetTop, dragging the left edge only ever changes insetLeft, and so
 * on — so the crop can be genuinely asymmetric (more off one side than
 * its opposite), unlike a single-corner "zoom into a centered box" tool.
 *
 * This sits alongside — not instead of — the numeric sliders in
 * ClipUploader.tsx: dragging is faster and more intuitive, but the
 * sliders remain as a precise, keyboard-accessible way to set the same
 * values, since the drag handles here don't have a keyboard equivalent.
 */
export const ClipCropBox: React.FC<{
  src: string;
  previewTimeSeconds: number;
  rotationDeg: number;
  insets: CropInsets;
  onChange: (insets: CropInsets) => void;
}> = ({ src, previewTimeSeconds, rotationDeg, insets, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // Seek the preview to a representative frame (the trim start) once its
  // metadata is ready, so the crop box isn't shown against a blank/black
  // first frame.
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const seek = () => {
      try {
        videoEl.currentTime = previewTimeSeconds;
      } catch {
        // Some browsers can throw if the media isn't ready yet — the
        // loadedmetadata listener below will retry.
      }
    };
    if (videoEl.readyState >= 1) {
      seek();
    } else {
      videoEl.addEventListener("loadedmetadata", seek, { once: true });
      return () => videoEl.removeEventListener("loadedmetadata", seek);
    }
  }, [previewTimeSeconds, src]);

  useEffect(() => {
    if (!drag) {
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      if (drag.edge === "top" || drag.edge === "bottom") {
        const dyPercent =
          ((e.clientY - drag.startClientY) / rect.height) * 100;
        // Dragging the top edge down (positive dy) increases insetTop;
        // dragging the bottom edge up (negative dy) increases insetBottom.
        const rawDelta = drag.edge === "top" ? dyPercent : -dyPercent;
        const oppositeInset =
          drag.edge === "top" ? insets.bottom : insets.top;
        const nextInset = Math.max(
          0,
          Math.min(
            MAX_INSET,
            Math.min(90 - oppositeInset, drag.startInset + rawDelta),
          ),
        );
        onChange({ ...insets, [drag.edge]: nextInset });
      } else {
        const dxPercent =
          ((e.clientX - drag.startClientX) / rect.width) * 100;
        const rawDelta = drag.edge === "left" ? dxPercent : -dxPercent;
        const oppositeInset =
          drag.edge === "left" ? insets.right : insets.left;
        const nextInset = Math.max(
          0,
          Math.min(
            MAX_INSET,
            Math.min(90 - oppositeInset, drag.startInset + rawDelta),
          ),
        );
        onChange({ ...insets, [drag.edge]: nextInset });
      }
    };
    const handlePointerUp = () => setDrag(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    // insets is intentionally in deps: each move handler closes over the
    // insets object from the render when the drag started, but onChange
    // calls need the freshest *other 3* values, which only change if the
    // person somehow edits a slider mid-drag — re-subscribing on insets
    // change keeps that edge case correct without adding real overhead.
  }, [drag, insets, onChange]);

  const rotationCoverScale = getRotationCoverScale(rotationDeg);
  const startDrag =
    (edge: Edge, startInset: number) =>
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDrag({
        edge,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startInset,
      });
    };

  return (
    <div ref={containerRef} className="clip-crop-box">
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="metadata"
        className="clip-crop-box-video"
        style={{
          transform:
            rotationDeg !== 0
              ? `rotate(${rotationDeg}deg) scale(${rotationCoverScale})`
              : undefined,
        }}
      />
      <div
        className="clip-crop-box-selection"
        style={{
          left: `${insets.left}%`,
          top: `${insets.top}%`,
          right: `${insets.right}%`,
          bottom: `${insets.bottom}%`,
        }}
      >
        <button
          type="button"
          className="clip-crop-box-edge clip-crop-box-edge-top"
          aria-label="Drag to crop from the top"
          onPointerDown={startDrag("top", insets.top)}
        />
        <button
          type="button"
          className="clip-crop-box-edge clip-crop-box-edge-bottom"
          aria-label="Drag to crop from the bottom"
          onPointerDown={startDrag("bottom", insets.bottom)}
        />
        <button
          type="button"
          className="clip-crop-box-edge clip-crop-box-edge-left"
          aria-label="Drag to crop from the left"
          onPointerDown={startDrag("left", insets.left)}
        />
        <button
          type="button"
          className="clip-crop-box-edge clip-crop-box-edge-right"
          aria-label="Drag to crop from the right"
          onPointerDown={startDrag("right", insets.right)}
        />
      </div>
    </div>
  );
};