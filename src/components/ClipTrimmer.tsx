"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Matches VIDEO_FPS in types/constants.ts. Duplicated here on purpose —
// same reasoning as the FPS constant in ClipUploader.tsx, which this
// component is a sibling of.
const FPS = 30;

// A trimmed clip can never be shorter than this — protects against a
// pointer slip collapsing a clip to a zero (or negative) duration, which
// would break computeClipRanges' sequencing.
const MIN_TRIM_FRAMES = Math.round(FPS * 0.5);

const formatSeconds = (frames: number): string => (frames / FPS).toFixed(1);

/**
 * Phase 11 — an in/out scrubber for trimming dead air off a clip. The
 * track represents the clip's full, untrimmed source length; dragging
 * either handle sets trimStartFrame/trimEndFrame, which the caller feeds
 * straight into that clip's `durationInFrames` (and, at render time, into
 * the Remotion `<Video>`'s trimBefore/trimAfter — see Main.tsx's
 * ClipVideo). There's no thumbnail filmstrip here — just the range and a
 * numeric readout — which keeps this scrubber a pure client-side
 * component with no per-clip server work needed on upload.
 */
export const ClipTrimmer: React.FC<{
  sourceDurationInFrames: number;
  trimStartFrame: number;
  trimEndFrame: number;
  onChange: (trimStartFrame: number, trimEndFrame: number) => void;
}> = ({ sourceDurationInFrames, trimStartFrame, trimEndFrame, onChange }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  const frameFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const fraction = rect.width
        ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
        : 0;
      return Math.round(fraction * sourceDurationInFrames);
    },
    [sourceDurationInFrames],
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      const frame = frameFromClientX(e.clientX);
      if (dragging === "start") {
        const clamped = Math.min(frame, trimEndFrame - MIN_TRIM_FRAMES);
        onChange(Math.max(0, clamped), trimEndFrame);
      } else {
        const clamped = Math.max(frame, trimStartFrame + MIN_TRIM_FRAMES);
        onChange(trimStartFrame, Math.min(sourceDurationInFrames, clamped));
      }
    };
    const handlePointerUp = () => setDragging(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [
    dragging,
    frameFromClientX,
    trimStartFrame,
    trimEndFrame,
    sourceDurationInFrames,
    onChange,
  ]);

  const startPercent = sourceDurationInFrames
    ? (trimStartFrame / sourceDurationInFrames) * 100
    : 0;
  const endPercent = sourceDurationInFrames
    ? (trimEndFrame / sourceDurationInFrames) * 100
    : 100;
  const isTrimmed = trimStartFrame > 0 || trimEndFrame < sourceDurationInFrames;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] text-subtitle">
        <span>Trim</span>
        <span className="font-mono-tabular">
          {formatSeconds(trimEndFrame - trimStartFrame)}s of{" "}
          {formatSeconds(sourceDurationInFrames)}s
        </span>
      </div>
      <div ref={trackRef} className="clip-trim-track">
        <div
          className="clip-trim-fill"
          style={{
            left: `${startPercent}%`,
            right: `${100 - endPercent}%`,
          }}
        />
        <button
          type="button"
          className="clip-trim-handle"
          style={{ left: `${startPercent}%` }}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging("start");
          }}
          aria-label="Trim start"
        />
        <button
          type="button"
          className="clip-trim-handle"
          style={{ left: `${endPercent}%` }}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging("end");
          }}
          aria-label="Trim end"
        />
      </div>
      {isTrimmed ? (
        <button
          type="button"
          onClick={() => onChange(0, sourceDurationInFrames)}
          className="self-start text-[11px] text-accent hover:underline"
        >
          Reset trim
        </button>
      ) : null}
    </div>
  );
};