"use client";

// Phase 11 — a local mirror of the target vertical ratio, rather than
// importing it from types/constants.ts. Same reasoning as ClipUploader's
// own FPS constant: this upload-time UI doesn't need to know about the
// Remotion composition schema at all, and duplicating three small numbers
// is cheaper than coupling the upload flow to the render pipeline. If
// VIDEO_WIDTH/VIDEO_HEIGHT or the tolerance in types/constants.ts ever
// change, update TARGET_WIDTH/TARGET_HEIGHT/RATIO_TOLERANCE here too.
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const TARGET_RATIO = TARGET_WIDTH / TARGET_HEIGHT; // 0.5625, i.e. 9:16
const RATIO_TOLERANCE = 0.03;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** e.g. (1920, 1080) -> "16:9" */
const simplifyRatio = (width: number, height: number): string => {
  const divisor = gcd(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
};

export type CropGuidance = {
  axis: "width" | "height";
  cropEachSidePx: number;
  resultWidth: number;
  resultHeight: number;
};

/**
 * If a clip isn't already close to vertical 9:16, works out exactly how
 * much to crop off — split evenly between both sides of whichever axis is
 * too large — to land on an exact 9:16 frame. Returns null when the clip
 * is already vertical enough that no crop is needed.
 *
 * This is pure guidance for someone who'd rather crop than pad — RankFlow
 * itself never crops a source file; see ClipVideo in Main.tsx for the
 * automatic blurred-pad behavior this is an alternative to.
 */
export const getCropGuidance = (
  width: number,
  height: number,
): CropGuidance | null => {
  if (width <= 0 || height <= 0) {
    return null;
  }
  const ratio = width / height;
  if (Math.abs(ratio - TARGET_RATIO) <= RATIO_TOLERANCE) {
    return null;
  }

  if (ratio > TARGET_RATIO) {
    // Wider than 9:16 relative to its height (landscape, or just not
    // quite tall enough) — crop off the left and right.
    const resultWidth = height * TARGET_RATIO;
    return {
      axis: "width",
      cropEachSidePx: Math.round((width - resultWidth) / 2),
      resultWidth: Math.round(resultWidth),
      resultHeight: Math.round(height),
    };
  }

  // Narrower/taller than 9:16 relative to its width — crop off the top
  // and bottom. Rare in practice (most non-vertical footage is landscape,
  // not over-tall), but the math is symmetric either way.
  const resultHeight = width / TARGET_RATIO;
  return {
    axis: "height",
    cropEachSidePx: Math.round((height - resultHeight) / 2),
    resultWidth: Math.round(width),
    resultHeight: Math.round(resultHeight),
  };
};

/** Convenience wrapper — used for the compact "padded" badge in the clip row. */
export const isSourceVertical = (width: number, height: number): boolean =>
  getCropGuidance(width, height) === null;

/**
 * Reports whether an uploaded clip's native resolution is already
 * vertical enough for YouTube Shorts' core portrait requirement, and if
 * not, gives exact crop numbers as an alternative to RankFlow's automatic
 * blurred-pad background. Purely a resolution/orientation check — other
 * Shorts eligibility rules (like length limits) change over time and
 * aren't checked here, so the copy explicitly points that out rather than
 * implying this is a complete pass/fail verdict.
 */
export const VerticalityCheck: React.FC<{
  width: number;
  height: number;
}> = ({ width, height }) => {
  const isPortrait = height >= width;
  const crop = getCropGuidance(width, height);

  if (crop === null) {
    return (
      <p className="text-[11px] text-geist-success">
        ✓ {width}×{height} ({simplifyRatio(width, height)}) — already
        vertical, meets YouTube Shorts&apos; portrait requirement.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-geist border border-accent/30 bg-accent-soft px-2.5 py-2 text-[11px] text-foreground">
      <p>
        <strong>
          {width}×{height}
        </strong>{" "}
        ({simplifyRatio(width, height)},{" "}
        {isPortrait ? "not quite vertical enough" : "landscape"}) — YouTube
        Shorts requires portrait, taller-than-wide video, so this clip
        won&apos;t qualify as-is.
      </p>
      <p className="text-subtitle">
        RankFlow already pads this automatically with a blurred background
        so nothing gets cut off. Prefer to crop instead? Use the Crop /
        zoom controls below —{" "}
        {crop.axis === "width"
          ? `zoom in until the frame is about ${crop.resultWidth}×${crop.resultHeight} (roughly ${crop.cropEachSidePx}px off each side) for an exact 9:16 frame.`
          : `zoom in until the frame is about ${crop.resultWidth}×${crop.resultHeight} (roughly ${crop.cropEachSidePx}px off top and bottom) for an exact 9:16 frame.`}
      </p>
      <p className="text-subtitle">
        Other Shorts requirements (like length limits) change over time —
        worth double-checking YouTube&apos;s current Shorts guidelines too.
      </p>
    </div>
  );
};