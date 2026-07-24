"use client";

import { useEffect, useRef, useState } from "react";

// Phase 11 (extended) — a local mirror of the target frame's aspect ratio
// and the rotation-cover-scale formula. Same reasoning as ClipUploader's
// own FPS constant: this upload-time preview doesn't need to import the
// Remotion render pipeline (types/constants.ts's getRotationCoverScale) —
// duplicating one small formula keeps the upload UI decoupled from it. If
// VIDEO_WIDTH/VIDEO_HEIGHT or the formula in types/constants.ts ever
// change, update this copy too.
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

type DragState = {
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startZoom: number;
  startOffsetX: number;
  startOffsetY: number;
};

/**
 * Phase 11 (extended) — a visual, drag-to-crop selector, the same basic
 * interaction as cropping a still image: the video is shown at its
 * "zoom 1" reference framing (already straightened by rotationDeg, if
 * set), and a bordered selection box represents what will actually be
 * kept. Dragging the box pans (cropOffsetX/Y); dragging its corner handle
 * resizes it, which is the same thing as changing cropZoom — a bigger box
 * means less zoom, a smaller box means more.
 *
 * The box is always locked to the output's own 9:16 aspect ratio (there's
 * no free-form crop shape here, since every clip renders into the same
 * fixed vertical canvas) — so one corner handle is enough; there's only
 * one real degree of freedom to resize.
 *
 * This sits alongside — not instead of — the numeric zoom/pan sliders in
 * ClipUploader.tsx: dragging is faster and more intuitive, but the
 * sliders remain as a precise, keyboard-accessible way to set the same
 * values, since the drag handles here don't have a keyboard equivalent.
 */
export const ClipCropBox: React.FC<{
  src: string;
  previewTimeSeconds: number;
  rotationDeg: number;
  cropZoom: number;
  cropOffsetX: number;
  cropOffsetY: number;
  onChange: (
    cropZoom: number,
    cropOffsetX: number,
    cropOffsetY: number,
  ) => void;
}> = ({
  src,
  previewTimeSeconds,
  rotationDeg,
  cropZoom,
  cropOffsetX,
  cropOffsetY,
  onChange,
}) => {
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
      const dxPercent = ((e.clientX - drag.startClientX) / rect.width) * 100;
      const dyPercent = ((e.clientY - drag.startClientY) / rect.height) * 100;

      if (drag.mode === "move") {
        const availableSlackPercent = (100 - 100 / drag.startZoom) / 2;
        if (availableSlackPercent <= 0) return;
        const nextOffsetX =
          drag.startOffsetX + (dxPercent / availableSlackPercent) * 100;
        const nextOffsetY =
          drag.startOffsetY + (dyPercent / availableSlackPercent) * 100;
        onChange(
          drag.startZoom,
          Math.max(-100, Math.min(100, nextOffsetX)),
          Math.max(-100, Math.min(100, nextOffsetY)),
        );
      } else {
        // Dragging the corner outward should enlarge the box (zoom out);
        // dragging inward shrinks it (zoom in) — hence the minus sign.
        const delta = (dxPercent + dyPercent) / 2;
        const nextZoom = Math.max(1, Math.min(3, drag.startZoom - delta / 25));
        onChange(nextZoom, drag.startOffsetX, drag.startOffsetY);
      }
    };
    const handlePointerUp = () => setDrag(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [drag, onChange]);

  const boxSizePercent = 100 / cropZoom;
  const availableSlackPercent = (100 - boxSizePercent) / 2;
  const boxLeftPercent =
    availableSlackPercent + (cropOffsetX / 100) * availableSlackPercent;
  const boxTopPercent =
    availableSlackPercent + (cropOffsetY / 100) * availableSlackPercent;
  const rotationCoverScale = getRotationCoverScale(rotationDeg);

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
          left: `${boxLeftPercent}%`,
          top: `${boxTopPercent}%`,
          width: `${boxSizePercent}%`,
          height: `${boxSizePercent}%`,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          setDrag({
            mode: "move",
            startClientX: e.clientX,
            startClientY: e.clientY,
            startZoom: cropZoom,
            startOffsetX: cropOffsetX,
            startOffsetY: cropOffsetY,
          });
        }}
      >
        <button
          type="button"
          className="clip-crop-box-handle"
          aria-label="Drag to resize crop (zoom)"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDrag({
              mode: "resize",
              startClientX: e.clientX,
              startClientY: e.clientY,
              startZoom: cropZoom,
              startOffsetX: cropOffsetX,
              startOffsetY: cropOffsetY,
            });
          }}
        />
      </div>
    </div>
  );
};