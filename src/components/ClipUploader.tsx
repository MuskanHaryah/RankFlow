"use client";

import {
  closestCenter,
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Button } from "./Button";
import { ClipCropBox } from "./ClipCropBox";
import { ClipTrimmer } from "./ClipTrimmer";
import { ConfirmDialog } from "./ConfirmDialog";
import { isSourceVertical, VerticalityCheck } from "./VerticalityCheck";

export type AnimationStyle =
  | "fade"
  | "slideUp"
  | "pop"
  | "typewriter"
  | "glow"
  | "bounceLetters";

export const ANIMATION_STYLE_OPTIONS: { value: AnimationStyle; label: string }[] =
  [
    { value: "fade", label: "Fade in" },
    { value: "slideUp", label: "Slide up" },
    { value: "pop", label: "Pop" },
    { value: "typewriter", label: "Typewriter + sparkle" },
    { value: "glow", label: "Glow in" },
    { value: "bounceLetters", label: "Bounce letters" },
  ];

// Mirrors types/constants.ts's RankStyleOverrideSchema shape (kept as a
// plain local type, same reasoning as FPS below — this component doesn't
// need to import the Remotion composition schema to know this shape).
// null = inherit the project-level default for this badge/title; a
// present object overrides all six fields together for just this one.
export type RankStyleOverride = {
  color: string;
  fontFamily: string;
  fontWeight: number;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
} | null;

// The subset of the project-level ranking-list style that's relevant to
// seeding a per-clip override — passed down from page.tsx so that turning
// an override on pre-fills it with the *current* global look rather than a
// fixed schema default, which is what makes "start from the shared style,
// then tweak just this one" actually work as a workflow.
export type RankingListStyleForSeeding = {
  badgeColor: string;
  badgeFontFamily: string;
  badgeFontWeight: number;
  badgeBorderEnabled: boolean;
  badgeBorderColor: string;
  badgeBorderWidth: number;
  titleColor: string;
  titleFontFamily: string;
  titleFontWeight: number;
  titleBorderEnabled: boolean;
  titleBorderColor: string;
  titleBorderWidth: number;
};

// A handful of practical, broadly-available font stacks rather than an
// open text field — avoids typos producing an invalid font-family that
// silently falls back to the browser default with no indication why.
export const FONT_FAMILY_OPTIONS: { value: string; label: string }[] = [
  { value: "inherit", label: "Default" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Impact, sans-serif", label: "Impact" },
  { value: "'Comic Sans MS', cursive", label: "Comic Sans" },
  { value: "Verdana, sans-serif", label: "Verdana" },
];

export const FONT_WEIGHT_OPTIONS: { value: number; label: string }[] = [
  { value: 400, label: "Normal" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];

// Phase 10 — mirrors types/constants.ts's StickerSchema shape (same
// decoupling reasoning as RankStyleOverride above). x/y/size are
// percentages of the frame; startFrame/endFrame are relative to this
// clip's own timeline (0 = the instant this clip starts playing).
export type Sticker = {
  id: string;
  emoji: string;
  x: number;
  y: number;
  size: number;
  startFrame: number;
  endFrame: number;
};

// A curated set of common reaction emojis for one-tap picking. The text
// input next to them covers anything not in this list — this isn't meant
// to be exhaustive, just fast for the common case.
export const REACTION_EMOJI_OPTIONS = [
  "😭",
  "😂",
  "🔥",
  "💀",
  "😱",
  "👀",
  "✨",
  "💦",
  "❤️",
  "👍",
  "🤯",
  "🎉",
];

// Matches STICKER_MIN/MAX_SIZE_PERCENT in types/constants.ts — duplicated
// for the same reason FPS below is.
const STICKER_MIN_SIZE_PERCENT = 4;
const STICKER_MAX_SIZE_PERCENT = 40;

export type UploadedClip = {
  id: string;
  file: File;
  src: string; // starts as a blob: URL for instant preview, later replaced by the real uploaded server path
  order: number; // playback sequence position
  durationInFrames: number | null; // effective (trimmed) length; null = still being read
  uploadStatus: "uploading" | "done" | "error";
  title: string; // empty string = no title text shown once revealed
  rank: number; // which badge slot (1..N) this clip is assigned to
  badgeType: "number" | "emoji";
  badgeEmoji: string; // only used when badgeType is "emoji"
  badgeStyleOverride: RankStyleOverride; // null = use the project-level badge defaults
  titleStyleOverride: RankStyleOverride; // null = use the project-level title defaults
  animationStyle: AnimationStyle; // entrance animation for this clip's title reveal
  stickers: Sticker[]; // Phase 10: reaction emojis placed on this clip
  // Phase 11 — trim points, in frames into the *original* source file.
  // trimStartFrame always has a real value (0 until changed); trimEndFrame
  // is null only until sourceDurationInFrames is known, at which point it
  // defaults to the full length (no trim).
  trimStartFrame: number;
  trimEndFrame: number | null;
  // Phase 11 — the clip's full, untrimmed length and native resolution,
  // read from the browser's own <video> element once metadata loads.
  sourceDurationInFrames: number | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  // Phase 11 (extended) — manual crop/zoom/pan. Always initialized
  // immediately (1 / 0 / 0, meaning "no crop") since — unlike duration and
  // resolution — these don't depend on reading the file at all, so there's
  // no null/loading state to represent.
  cropZoom: number;
  cropOffsetX: number;
  cropOffsetY: number;
  // Phase 11 (extended) — rotation in degrees, -180 to 180. 0 = untouched.
  cropRotationDeg: number;
};

export type PlayingOrderMode = "manual" | "ascending" | "descending" | "shuffle";

const MAX_CLIPS = 10;

// Matches VIDEO_FPS in types/constants.ts. Duplicated here on purpose —
// this component doesn't need to know about the Remotion composition at all.
const FPS = 30;

/**
 * Reads a video file's duration (seconds) and native pixel resolution
 * using an offscreen <video> element. Width/height come free from the
 * same loadedmetadata event duration does, so Phase 11's verticality
 * check doesn't need a second pass over the file.
 *
 * Handles a known browser quirk: some formats (webm especially) report
 * duration as Infinity until you seek into the file.
 */
const getVideoMetadata = (
  file: File,
): Promise<{ durationSeconds: number; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const videoEl = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    videoEl.preload = "metadata";
    videoEl.src = objectUrl;

    const finish = (duration: number) => {
      URL.revokeObjectURL(objectUrl);
      if (Number.isFinite(duration) && duration > 0) {
        resolve({
          durationSeconds: duration,
          width: videoEl.videoWidth,
          height: videoEl.videoHeight,
        });
      } else {
        reject(
          new Error(
            `Duration could not be determined for "${file.name}" (got ${duration})`,
          ),
        );
      }
    };

    videoEl.onloadedmetadata = () => {
      if (videoEl.duration === Infinity || Number.isNaN(videoEl.duration)) {
        videoEl.currentTime = 1e101;
        videoEl.ontimeupdate = () => {
          videoEl.ontimeupdate = null;
          finish(videoEl.duration);
        };
      } else {
        finish(videoEl.duration);
      }
    };

    videoEl.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read duration for "${file.name}"`));
    };
  });
};

/**
 * Uploads a file to the server so it becomes a real file a local render
 * process can read. A blob: URL only ever exists in this browser tab's
 * memory — Node has no way to resolve it.
 */
const uploadClipToServer = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      `Upload failed for "${file.name}" (server responded ${response.status})`,
    );
  }

  const data = await response.json();
  return data.url as string;
};

/**
 * Ascending: rank 1 plays first, rank 2 second, and so on.
 * Descending: the highest rank plays first, rank 1 plays last — the
 * classic countdown format, saving the top spot for last.
 * Pure and deterministic — no randomness here, that's shuffleOrder below.
 */
const deriveOrderFromRank = (
  clipsList: UploadedClip[],
  mode: "ascending" | "descending",
): UploadedClip[] => {
  const total = clipsList.length;
  return clipsList.map((clip) => ({
    ...clip,
    order: mode === "ascending" ? clip.rank : total + 1 - clip.rank,
  }));
};

/** Fisher-Yates shuffle, applied to play order only — ranks are untouched. */
const shuffleOrder = (clipsList: UploadedClip[]): UploadedClip[] => {
  const shuffled = [...clipsList];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((clip, index) => ({ ...clip, order: index + 1 }));
};

/**
 * Shared per-clip override editor for either the badge or the title — same
 * six fields either way (color, font family, font weight, border
 * enabled/color/width). One checkbox switches between "inherit the
 * project-level default" (override === null) and "customize this one"
 * (override is an object). Turning it on seeds the object from `seedFrom`
 * — the *current* global default — so tweaking starts from the shared
 * look already in use rather than from scratch.
 */
const RankStyleOverrideEditor: React.FC<{
  label: string;
  override: RankStyleOverride;
  seedFrom: NonNullable<RankStyleOverride>;
  onChange: (override: RankStyleOverride) => void;
}> = ({ label, override, seedFrom, onChange }) => {
  const isCustomized = override !== null;

  const updateField = <K extends keyof NonNullable<RankStyleOverride>>(
    field: K,
    value: NonNullable<RankStyleOverride>[K],
  ) => {
    if (!override) return;
    onChange({ ...override, [field]: value });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-subtitle cursor-pointer">
        <input
          type="checkbox"
          checked={isCustomized}
          onChange={(e) =>
            onChange(e.target.checked ? { ...seedFrom } : null)
          }
          className="h-3.5 w-3.5 accent-accent cursor-pointer"
        />
        Customize {label} style for this clip
      </label>
      {override ? (
        <div className="flex items-center gap-2 flex-wrap control-group">
          <input
            type="color"
            value={override.color}
            onChange={(e) => updateField("color", e.target.value)}
            title={`${label} color`}
            className="w-8 h-8 border border-unfocused-border-color rounded-geist"
          />
          <select
            value={override.fontFamily}
            onChange={(e) => updateField("fontFamily", e.target.value)}
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={override.fontWeight}
            onChange={(e) =>
              updateField("fontWeight", Number(e.target.value))
            }
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            {FONT_WEIGHT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={override.borderEnabled ? "bordered" : "none"}
            onChange={(e) =>
              updateField("borderEnabled", e.target.value === "bordered")
            }
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            <option value="none">No border</option>
            <option value="bordered">Bordered</option>
          </select>
          {override.borderEnabled ? (
            <>
              <input
                type="color"
                value={override.borderColor}
                onChange={(e) => updateField("borderColor", e.target.value)}
                title="Border color"
                className="w-8 h-8 border border-unfocused-border-color rounded-geist"
              />
              <input
                type="number"
                min={1}
                max={20}
                value={override.borderWidth}
                onChange={(e) =>
                  updateField("borderWidth", Number(e.target.value))
                }
                title="Border thickness (px)"
                className="w-14 text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Per-clip reaction-sticker editor. Placement itself happens by clicking
 * the live preview (arming that click-catch mode is this component's
 * "📍 Place on preview" button — the actual click handling lives in
 * page.tsx, which has the Player); this component covers picking which
 * emoji to place next, and fine-tuning/removing stickers already placed.
 */
const StickerEditor: React.FC<{
  stickers: Sticker[];
  clipDurationInFrames: number | null;
  onStickersChange: (stickers: Sticker[]) => void;
  onArmPlacement: (emoji: string) => void;
  placementArmed: boolean;
}> = ({
  stickers,
  clipDurationInFrames,
  onStickersChange,
  onArmPlacement,
  placementArmed,
}) => {
  const [pendingEmoji, setPendingEmoji] = useState("😭");
  // Duration may still be null while the file's metadata is being read —
  // fall back to a generous default so the fine-tune sliders below aren't
  // stuck at a 0-width range in the meantime.
  const maxFrame = clipDurationInFrames ?? FPS * 10;

  const updateSticker = (id: string, patch: Partial<Sticker>) => {
    onStickersChange(
      stickers.map((sticker) =>
        sticker.id === id ? { ...sticker, ...patch } : sticker,
      ),
    );
  };

  const removeSticker = (id: string) => {
    onStickersChange(stickers.filter((sticker) => sticker.id !== id));
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-subtitle">Reaction stickers</label>
      <div className="flex items-center gap-1 flex-wrap">
        {REACTION_EMOJI_OPTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => setPendingEmoji(emoji)}
            className={`text-base leading-none px-1.5 py-1 rounded-geist border ${
              pendingEmoji === emoji
                ? "border-foreground"
                : "border-transparent"
            }`}
          >
            {emoji}
          </button>
        ))}
        <input
          type="text"
          value={pendingEmoji}
          onChange={(e) => setPendingEmoji(e.target.value)}
          placeholder="or type/paste"
          className="w-24 text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
        />
        <button
          type="button"
          onClick={() => onArmPlacement(pendingEmoji)}
          disabled={!pendingEmoji}
          className={`text-sm rounded-geist border px-2 py-1 ${
            placementArmed
              ? "border-foreground bg-foreground text-background"
              : "border-unfocused-border-color text-foreground"
          }`}
        >
          {placementArmed ? "Click the preview…" : "📍 Place on preview"}
        </button>
      </div>

      {stickers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {stickers.map((sticker) => (
            <div
              key={sticker.id}
              className="flex items-center gap-2 flex-wrap text-xs text-subtitle border border-unfocused-border-color rounded-geist p-2"
            >
              <span className="text-base">{sticker.emoji}</span>
              <label>X</label>
              <input
                type="range"
                min={0}
                max={100}
                value={sticker.x}
                onChange={(e) =>
                  updateSticker(sticker.id, { x: Number(e.target.value) })
                }
                className="w-16"
              />
              <label>Y</label>
              <input
                type="range"
                min={0}
                max={100}
                value={sticker.y}
                onChange={(e) =>
                  updateSticker(sticker.id, { y: Number(e.target.value) })
                }
                className="w-16"
              />
              <label>Size</label>
              <input
                type="range"
                min={STICKER_MIN_SIZE_PERCENT}
                max={STICKER_MAX_SIZE_PERCENT}
                value={sticker.size}
                onChange={(e) =>
                  updateSticker(sticker.id, { size: Number(e.target.value) })
                }
                className="w-16"
              />
              <label>Start (s)</label>
              <input
                type="number"
                min={0}
                max={(maxFrame / FPS).toFixed(2)}
                step={0.1}
                value={(sticker.startFrame / FPS).toFixed(2)}
                onChange={(e) => {
                  const startFrame = Math.max(
                    0,
                    Math.min(
                      maxFrame - 1,
                      Math.round(Number(e.target.value) * FPS),
                    ),
                  );
                  updateSticker(sticker.id, {
                    startFrame,
                    endFrame: Math.max(startFrame + 1, sticker.endFrame),
                  });
                }}
                className="w-16 bg-background border border-unfocused-border-color rounded-geist px-1 py-0.5 text-foreground"
              />
              <label>End (s)</label>
              <input
                type="number"
                min={0}
                max={(maxFrame / FPS).toFixed(2)}
                step={0.1}
                value={(sticker.endFrame / FPS).toFixed(2)}
                onChange={(e) => {
                  const endFrame = Math.max(
                    sticker.startFrame + 1,
                    Math.min(
                      maxFrame,
                      Math.round(Number(e.target.value) * FPS),
                    ),
                  );
                  updateSticker(sticker.id, { endFrame });
                }}
                className="w-16 bg-background border border-unfocused-border-color rounded-geist px-1 py-0.5 text-foreground"
              />
              <button
                type="button"
                onClick={() => removeSticker(sticker.id)}
                className="text-red-400"
              >
                ✕ Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Phase 11 (extended) — crop/zoom/pan controls, shown on every clip
 * regardless of orientation (not just non-vertical ones) — cropping is
 * something you might want even on already-vertical footage (e.g.
 * punching in past a shoulder, or reframing off-center subject), so it's
 * never gated behind the verticality check. Pan only does anything once
 * zoomed in — there's no "spare" image outside the frame to pan into at
 * zoom 1 — so the pan sliders are disabled until then.
 */
const ClipCropControls: React.FC<{
  src: string;
  previewTimeSeconds: number;
  cropZoom: number;
  cropOffsetX: number;
  cropOffsetY: number;
  cropRotationDeg: number;
  onChange: (
    cropZoom: number,
    cropOffsetX: number,
    cropOffsetY: number,
  ) => void;
  onRotationChange: (cropRotationDeg: number) => void;
}> = ({
  src,
  previewTimeSeconds,
  cropZoom,
  cropOffsetX,
  cropOffsetY,
  cropRotationDeg,
  onChange,
  onRotationChange,
}) => {
  const isCropped =
    cropZoom > 1 || cropOffsetX !== 0 || cropOffsetY !== 0 ||
    cropRotationDeg !== 0;
  const canPan = cropZoom > 1;

  const resetAll = () => {
    onChange(1, 0, 0);
    onRotationChange(0);
  };

  const rotate90 = () => {
    // Wrap into (-180, 180] so the slider below always reflects the
    // current value correctly instead of accumulating past its own range.
    let next = cropRotationDeg + 90;
    if (next > 180) next -= 360;
    onRotationChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[11px] text-subtitle">
        <span>Crop / zoom / rotate (works on any clip, vertical or not)</span>
        {isCropped ? (
          <button
            type="button"
            onClick={resetAll}
            className="text-accent hover:underline"
          >
            Reset crop
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start control-group">
        <ClipCropBox
          src={src}
          previewTimeSeconds={previewTimeSeconds}
          rotationDeg={cropRotationDeg}
          cropZoom={cropZoom}
          cropOffsetX={cropOffsetX}
          cropOffsetY={cropOffsetY}
          onChange={onChange}
        />

        <div className="flex flex-1 flex-col gap-2.5">
          <label className="flex items-center gap-1.5 text-xs text-subtitle">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={cropZoom}
              onChange={(e) =>
                onChange(Number(e.target.value), cropOffsetX, cropOffsetY)
              }
              className="w-24"
            />
            <span className="font-mono-tabular w-10">
              {cropZoom.toFixed(2)}x
            </span>
          </label>
          <label
            className={`flex items-center gap-1.5 text-xs ${canPan ? "text-subtitle" : "text-disabled-text-color"}`}
          >
            Pan X
            <input
              type="range"
              min={-100}
              max={100}
              value={cropOffsetX}
              disabled={!canPan}
              onChange={(e) =>
                onChange(cropZoom, Number(e.target.value), cropOffsetY)
              }
              className="w-24"
            />
          </label>
          <label
            className={`flex items-center gap-1.5 text-xs ${canPan ? "text-subtitle" : "text-disabled-text-color"}`}
          >
            Pan Y
            <input
              type="range"
              min={-100}
              max={100}
              value={cropOffsetY}
              disabled={!canPan}
              onChange={(e) =>
                onChange(cropZoom, cropOffsetX, Number(e.target.value))
              }
              className="w-24"
            />
          </label>
          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-1.5 text-xs text-subtitle">
              Rotate
              <input
                type="range"
                min={-180}
                max={180}
                step={0.5}
                value={cropRotationDeg}
                onChange={(e) => onRotationChange(Number(e.target.value))}
                className="w-24"
              />
              <span className="font-mono-tabular w-10">
                {cropRotationDeg.toFixed(0)}°
              </span>
            </label>
            <Button compact secondary onClick={rotate90}>
              +90°
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * A single draggable row in the clip list. Split out from the main
 * component because useSortable() must be called once per draggable item,
 * not once for the whole list.
 */
const SortableClipRow: React.FC<{
  clip: UploadedClip;
  clipCount: number;
  dragEnabled: boolean;
  rankingListStyle: RankingListStyleForSeeding;
  stickerPlacementArmedFor: string | null;
  onTitleChange: (id: string, title: string) => void;
  onRankChange: (id: string, rank: number) => void;
  onBadgeTypeChange: (id: string, badgeType: "number" | "emoji") => void;
  onBadgeEmojiChange: (id: string, emoji: string) => void;
  onAnimationStyleChange: (id: string, animationStyle: AnimationStyle) => void;
  onBadgeStyleOverrideChange: (id: string, override: RankStyleOverride) => void;
  onTitleStyleOverrideChange: (id: string, override: RankStyleOverride) => void;
  onStickersChange: (id: string, stickers: Sticker[]) => void;
  onArmStickerPlacement: (id: string, emoji: string) => void;
  onRequestRemove: (id: string) => void;
  onTrimChange: (id: string, trimStartFrame: number, trimEndFrame: number) => void;
  onCropChange: (
    id: string,
    cropZoom: number,
    cropOffsetX: number,
    cropOffsetY: number,
  ) => void;
  onRotationChange: (id: string, cropRotationDeg: number) => void;
}> = ({
  clip,
  clipCount,
  dragEnabled,
  rankingListStyle,
  stickerPlacementArmedFor,
  onTitleChange,
  onRankChange,
  onBadgeTypeChange,
  onBadgeEmojiChange,
  onAnimationStyleChange,
  onBadgeStyleOverrideChange,
  onTitleStyleOverrideChange,
  onStickersChange,
  onArmStickerPlacement,
  onRequestRemove,
  onTrimChange,
  onCropChange,
  onRotationChange,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: clip.id, disabled: !dragEnabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const statusPill =
    clip.uploadStatus === "uploading" ? (
      <span className="rounded-full bg-panel-raised px-2 py-0.5 text-[11px] text-subtitle">
        uploading…
      </span>
    ) : clip.uploadStatus === "done" ? (
      <span className="rounded-full bg-geist-success/10 px-2 py-0.5 text-[11px] text-geist-success">
        uploaded
      </span>
    ) : (
      <span className="rounded-full bg-geist-error/10 px-2 py-0.5 text-[11px] text-geist-error">
        upload failed
      </span>
    );

  // Phase 11 — a quick at-a-glance flag; the full explanation and crop
  // numbers live in the VerticalityCheck panel below.
  const notVerticalBadge =
    clip.sourceWidth !== null &&
    clip.sourceHeight !== null &&
    !isSourceVertical(clip.sourceWidth, clip.sourceHeight) ? (
      <span
        className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent"
        title="Not vertical — RankFlow pads this with a blurred background so nothing is cropped or stretched"
      >
        padded
      </span>
    ) : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-3 rounded-geist border border-unfocused-border-color bg-background p-geist-half text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          {...attributes}
          {...(dragEnabled ? listeners : {})}
          className={`select-none px-1 ${
            dragEnabled
              ? "cursor-grab active:cursor-grabbing text-subtitle"
              : "cursor-not-allowed text-unfocused-border-color"
          }`}
          title={
            dragEnabled
              ? "Drag to reorder"
              : "Switch Playing Order to Manual to drag"
          }
        >
          ⠿
        </span>
        <span className="font-mono-tabular text-xs text-subtitle">
          #{clip.order}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {clip.file.name}
        </span>
        <span className="font-mono-tabular text-xs text-subtitle">
          {(clip.file.size / 1024 / 1024).toFixed(1)} MB
        </span>
        <span className="font-mono-tabular text-xs text-subtitle">
          {clip.durationInFrames === null
            ? "reading duration…"
            : `${(clip.durationInFrames / FPS).toFixed(1)}s`}
        </span>
        {statusPill}
        {notVerticalBadge}
        <button
          type="button"
          onClick={() => onRequestRemove(clip.id)}
          title="Remove this clip"
          aria-label="Remove this clip"
          className="ml-auto shrink-0 rounded-geist p-1.5 text-subtitle transition-colors duration-150 hover:bg-geist-error/10 hover:text-geist-error"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-3 border-t border-unfocused-border-color pt-3">
        {clip.sourceDurationInFrames !== null && clip.trimEndFrame !== null ? (
          <ClipTrimmer
            sourceDurationInFrames={clip.sourceDurationInFrames}
            trimStartFrame={clip.trimStartFrame}
            trimEndFrame={clip.trimEndFrame}
            onChange={(start, end) => onTrimChange(clip.id, start, end)}
          />
        ) : (
          <p className="text-[11px] text-subtitle">
            Reading clip length for trimming…
          </p>
        )}
        {clip.sourceWidth !== null && clip.sourceHeight !== null ? (
          <VerticalityCheck width={clip.sourceWidth} height={clip.sourceHeight} />
        ) : null}
        <ClipCropControls
          src={clip.src}
          previewTimeSeconds={clip.trimStartFrame / FPS}
          cropZoom={clip.cropZoom}
          cropOffsetX={clip.cropOffsetX}
          cropOffsetY={clip.cropOffsetY}
          cropRotationDeg={clip.cropRotationDeg}
          onChange={(zoom, offsetX, offsetY) =>
            onCropChange(clip.id, zoom, offsetX, offsetY)
          }
          onRotationChange={(deg) => onRotationChange(clip.id, deg)}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-unfocused-border-color pt-3">
        <div className="field-row">
          <label className="field-row-label">Rank &amp; badge</label>
          <div className="field-row-controls control-group">
            <input
              type="number"
              min={1}
              max={clipCount}
              value={clip.rank}
              onChange={(e) => onRankChange(clip.id, Number(e.target.value))}
              className="w-14 text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
            />
            <select
              value={clip.badgeType}
              onChange={(e) =>
                onBadgeTypeChange(clip.id, e.target.value as "number" | "emoji")
              }
              className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
            >
              <option value="number">Number badge</option>
              <option value="emoji">Emoji badge</option>
            </select>
            {clip.badgeType === "emoji" ? (
              <input
                type="text"
                value={clip.badgeEmoji}
                onChange={(e) => onBadgeEmojiChange(clip.id, e.target.value)}
                placeholder="🔥"
                className="w-16 text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
              />
            ) : null}
          </div>
        </div>

        <div className="sm:pl-[10.5rem]">
          <RankStyleOverrideEditor
            label="number"
            override={clip.badgeStyleOverride}
            seedFrom={{
              color: rankingListStyle.badgeColor,
              fontFamily: rankingListStyle.badgeFontFamily,
              fontWeight: rankingListStyle.badgeFontWeight,
              borderEnabled: rankingListStyle.badgeBorderEnabled,
              borderColor: rankingListStyle.badgeBorderColor,
              borderWidth: rankingListStyle.badgeBorderWidth,
            }}
            onChange={(override) =>
              onBadgeStyleOverrideChange(clip.id, override)
            }
          />
        </div>

        <div className="field-row">
          <label className="field-row-label">Title &amp; reveal</label>
          <div className="field-row-controls control-group">
            <input
              type="text"
              value={clip.title}
              onChange={(e) => onTitleChange(clip.id, e.target.value)}
              placeholder="Title for this clip (optional)"
              className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
            />
            <select
              value={clip.animationStyle}
              onChange={(e) =>
                onAnimationStyleChange(
                  clip.id,
                  e.target.value as AnimationStyle,
                )
              }
              className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
            >
              {ANIMATION_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="sm:pl-[10.5rem]">
          <RankStyleOverrideEditor
            label="title"
            override={clip.titleStyleOverride}
            seedFrom={{
              color: rankingListStyle.titleColor,
              fontFamily: rankingListStyle.titleFontFamily,
              fontWeight: rankingListStyle.titleFontWeight,
              borderEnabled: rankingListStyle.titleBorderEnabled,
              borderColor: rankingListStyle.titleBorderColor,
              borderWidth: rankingListStyle.titleBorderWidth,
            }}
            onChange={(override) =>
              onTitleStyleOverrideChange(clip.id, override)
            }
          />
        </div>

        <div className="sm:pl-[10.5rem]">
          <StickerEditor
            stickers={clip.stickers}
            clipDurationInFrames={clip.durationInFrames}
            onStickersChange={(stickers) => onStickersChange(clip.id, stickers)}
            onArmPlacement={(emoji) => onArmStickerPlacement(clip.id, emoji)}
            placementArmed={stickerPlacementArmedFor === clip.id}
          />
        </div>
      </div>
    </li>
  );
};

// Phase 10: ClipUploader owns `clips` as uncontrolled internal state (same
// as it always has — see onClipsChange above), so page.tsx can't just pass
// a new sticker down as a prop the normal way. This ref exposes the one
// imperative entry point page.tsx needs: "a sticker was just placed by
// clicking the preview, add it to this clip." Nothing else reaches in from
// outside this component.
export type ClipUploaderHandle = {
  addSticker: (clipId: string, sticker: Sticker) => void;
};

export const ClipUploader = forwardRef<
  ClipUploaderHandle,
  {
    onClipsChange?: (clips: UploadedClip[]) => void;
    rankingListStyle: RankingListStyleForSeeding;
    // Which clip (if any) is currently armed for click-to-place, and the
    // callback to request arming a new one — the armed state itself is
    // owned by page.tsx since it's also what drives the click-catching
    // overlay rendered on top of the Player there.
    stickerPlacementArmedFor: string | null;
    onArmStickerPlacement: (clipId: string, emoji: string) => void;
  }
>(
  (
    {
      onClipsChange,
      rankingListStyle,
      stickerPlacementArmedFor,
      onArmStickerPlacement,
    },
    ref,
  ) => {
  const [clips, setClips] = useState<UploadedClip[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  // Manual = drag-and-drop decides play order directly. Ascending/descending
  // derive play order from rank automatically. Shuffle randomizes it.
  const [playingOrderMode, setPlayingOrderMode] =
    useState<PlayingOrderMode>("manual");
  // Just holds whatever's currently selected in the "apply to all" dropdown —
  // not applied until the button next to it is clicked.
  const [globalAnimationChoice, setGlobalAnimationChoice] =
    useState<AnimationStyle>("fade");
  // Holds the clip awaiting delete confirmation — null means the dialog is
  // closed. Storing the whole clip (not just an id) so the dialog can show
  // the filename without a second lookup.
  const [pendingDeleteClip, setPendingDeleteClip] =
    useState<UploadedClip | null>(null);

  // A small activation distance prevents drags from firing on a plain
  // click — without this, clicking anywhere on a row could accidentally
  // trigger a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  useEffect(() => {
    onClipsChange?.(clips);
  }, [clips, onClipsChange]);

  const onFilesSelected: React.ChangeEventHandler<HTMLInputElement> =
    useCallback((e) => {
      const selectedFiles = e.currentTarget.files;
      if (!selectedFiles || selectedFiles.length === 0) {
        return;
      }

      const fileArray = Array.from(selectedFiles);

      if (fileArray.length > MAX_CLIPS) {
        setWarning(
          `You selected ${fileArray.length} clips — only the first ${MAX_CLIPS} were kept.`,
        );
      } else {
        setWarning(null);
      }

      const trimmedFiles = fileArray.slice(0, MAX_CLIPS);

      const newClips: UploadedClip[] = trimmedFiles.map((file, index) => ({
        id: crypto.randomUUID(),
        file,
        src: URL.createObjectURL(file),
        order: index + 1,
        durationInFrames: null,
        uploadStatus: "uploading",
        title: "",
        rank: index + 1,
        badgeType: "number",
        badgeEmoji: "",
        badgeStyleOverride: null,
        titleStyleOverride: null,
        animationStyle: "fade",
        stickers: [],
        trimStartFrame: 0,
        trimEndFrame: null,
        sourceDurationInFrames: null,
        sourceWidth: null,
        sourceHeight: null,
        cropZoom: 1,
        cropOffsetX: 0,
        cropOffsetY: 0,
        cropRotationDeg: 0,
      }));

      setClips(newClips);
      console.log("Uploaded clips (durations + server upload pending):", newClips);

      // Duration/resolution reading and server upload run independently and
      // in parallel per clip — neither depends on the other finishing first.
      newClips.forEach((clip) => {
        getVideoMetadata(clip.file)
          .then(({ durationSeconds, width, height }) => {
            const durationInFrames = Math.round(durationSeconds * FPS);

            setClips((prevClips) =>
              prevClips.map((prevClip) =>
                prevClip.id === clip.id
                  ? {
                      ...prevClip,
                      durationInFrames,
                      sourceDurationInFrames: durationInFrames,
                      sourceWidth: width,
                      sourceHeight: height,
                      // No trim yet — the full clip plays, same as before
                      // Phase 11 existed.
                      trimStartFrame: 0,
                      trimEndFrame: durationInFrames,
                    }
                  : prevClip,
              ),
            );

            console.log(
              `Metadata read for "${clip.file.name}": ${durationSeconds.toFixed(
                2,
              )}s (${durationInFrames} frames at ${FPS}fps), ${width}x${height}`,
            );
          })
          .catch((err) => {
            console.error(err);
            setWarning(
              `Could not read duration for "${clip.file.name}" — try a different file.`,
            );
          });

        uploadClipToServer(clip.file)
          .then((serverUrl) => {
            setClips((prevClips) =>
              prevClips.map((prevClip) =>
                prevClip.id === clip.id
                  ? { ...prevClip, src: serverUrl, uploadStatus: "done" }
                  : prevClip,
              ),
            );

            console.log(`Uploaded "${clip.file.name}" -> ${serverUrl}`);
          })
          .catch((err) => {
            console.error(err);
            setClips((prevClips) =>
              prevClips.map((prevClip) =>
                prevClip.id === clip.id
                  ? { ...prevClip, uploadStatus: "error" }
                  : prevClip,
              ),
            );
            setWarning(
              `Could not upload "${clip.file.name}" to the server — export will fail until this is fixed.`,
            );
          });
      });
    }, []);

  // Dragging only actually changes anything in manual mode — in the other
  // three modes, play order is derived automatically (ascending/descending)
  // or set by the shuffle button, so a stray drag shouldn't silently
  // override that.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (playingOrderMode !== "manual") {
        return;
      }

      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }

      setClips((prevClips) => {
        const oldIndex = prevClips.findIndex((c) => c.id === active.id);
        const newIndex = prevClips.findIndex((c) => c.id === over.id);
        const reordered = arrayMove(prevClips, oldIndex, newIndex);
        return reordered.map((clip, index) => ({
          ...clip,
          order: index + 1,
        }));
      });
    },
    [playingOrderMode],
  );

  const handleTitleChange = useCallback((id: string, title: string) => {
    setClips((prevClips) =>
      prevClips.map((clip) => (clip.id === id ? { ...clip, title } : clip)),
    );
  }, []);

  // Ranks must stay a valid 1..N permutation with no duplicates — so
  // setting a rank that's already taken by another clip swaps the two
  // clips' ranks rather than creating a conflict. If we're currently in
  // ascending/descending mode, play order is re-derived immediately too,
  // since it depends on rank in those modes.
  const handleRankChange = useCallback(
    (id: string, newRank: number) => {
      setClips((prevClips) => {
        const clampedRank = Math.max(
          1,
          Math.min(prevClips.length, newRank || 1),
        );
        const targetClip = prevClips.find((c) => c.id === id);
        if (!targetClip) {
          return prevClips;
        }
        const conflicting = prevClips.find(
          (c) => c.rank === clampedRank && c.id !== id,
        );
        let updated = prevClips.map((c) => {
          if (c.id === id) {
            return { ...c, rank: clampedRank };
          }
          if (conflicting && c.id === conflicting.id) {
            return { ...c, rank: targetClip.rank };
          }
          return c;
        });

        if (playingOrderMode === "ascending" || playingOrderMode === "descending") {
          updated = deriveOrderFromRank(updated, playingOrderMode);
        }

        return updated;
      });
    },
    [playingOrderMode],
  );

  const handleBadgeTypeChange = useCallback(
    (id: string, badgeType: "number" | "emoji") => {
      setClips((prevClips) =>
        prevClips.map((clip) =>
          clip.id === id ? { ...clip, badgeType } : clip,
        ),
      );
    },
    [],
  );

  const handleBadgeEmojiChange = useCallback(
    (id: string, badgeEmoji: string) => {
      setClips((prevClips) =>
        prevClips.map((clip) =>
          clip.id === id ? { ...clip, badgeEmoji } : clip,
        ),
      );
    },
    [],
  );

  const handleBadgeStyleOverrideChange = useCallback(
    (id: string, badgeStyleOverride: RankStyleOverride) => {
      setClips((prevClips) =>
        prevClips.map((clip) =>
          clip.id === id ? { ...clip, badgeStyleOverride } : clip,
        ),
      );
    },
    [],
  );

  const handleTitleStyleOverrideChange = useCallback(
    (id: string, titleStyleOverride: RankStyleOverride) => {
      setClips((prevClips) =>
        prevClips.map((clip) =>
          clip.id === id ? { ...clip, titleStyleOverride } : clip,
        ),
      );
    },
    [],
  );

  const handleStickersChange = useCallback(
    (id: string, stickers: Sticker[]) => {
      setClips((prevClips) =>
        prevClips.map((clip) =>
          clip.id === id ? { ...clip, stickers } : clip,
        ),
      );
    },
    [],
  );

  // Phase 11 — dragging a trim handle updates durationInFrames directly
  // (trimEndFrame - trimStartFrame), which is what everything downstream
  // (totals, computeClipRanges, the render's trimBefore/trimAfter) already
  // reads. Trimming can shorten a clip past stickers that were placed
  // before the trim — those get clamped into the new range rather than
  // left referencing frames that no longer exist.
  const handleTrimChange = useCallback(
    (id: string, trimStartFrame: number, trimEndFrame: number) => {
      setClips((prevClips) =>
        prevClips.map((clip) => {
          if (clip.id !== id) {
            return clip;
          }
          const durationInFrames = trimEndFrame - trimStartFrame;
          const stickers = clip.stickers.map((sticker) => ({
            ...sticker,
            startFrame: Math.min(
              sticker.startFrame,
              Math.max(0, durationInFrames - 1),
            ),
            endFrame: Math.min(sticker.endFrame, durationInFrames),
          }));
          return {
            ...clip,
            trimStartFrame,
            trimEndFrame,
            durationInFrames,
            stickers,
          };
        }),
      );
    },
    [],
  );

  // Phase 11 (extended) — manual crop/zoom/pan, independent of trim and
  // available regardless of the clip's orientation (see ClipVideo in
  // Main.tsx for how cropZoom > 1 overrides the automatic pad).
  const handleCropChange = useCallback(
    (
      id: string,
      cropZoom: number,
      cropOffsetX: number,
      cropOffsetY: number,
    ) => {
      setClips((prevClips) =>
        prevClips.map((clip) =>
          clip.id === id
            ? { ...clip, cropZoom, cropOffsetX, cropOffsetY }
            : clip,
        ),
      );
    },
    [],
  );

  // Phase 11 (extended) — rotation is independent of zoom/pan (see
  // ClipVideo in Main.tsx: it folds into an extra cover-scale rather than
  // affecting cropOffsetX/Y), so it gets its own setter.
  const handleRotationChange = useCallback(
    (id: string, cropRotationDeg: number) => {
      setClips((prevClips) =>
        prevClips.map((clip) =>
          clip.id === id ? { ...clip, cropRotationDeg } : clip,
        ),
      );
    },
    [],
  );

  // The one imperative entry point page.tsx uses after a placement click
  // on the preview — see the ClipUploaderHandle comment above for why this
  // has to be a ref rather than a normal prop.
  useImperativeHandle(
    ref,
    () => ({
      addSticker: (clipId: string, sticker: Sticker) => {
        setClips((prevClips) =>
          prevClips.map((clip) =>
            clip.id === clipId
              ? { ...clip, stickers: [...clip.stickers, sticker] }
              : clip,
          ),
        );
      },
    }),
    [],
  );

  const handleAnimationStyleChange = useCallback(
    (id: string, animationStyle: AnimationStyle) => {
      setClips((prevClips) =>
        prevClips.map((clip) =>
          clip.id === id ? { ...clip, animationStyle } : clip,
        ),
      );
    },
    [],
  );

  // A one-off bulk-set: applies the chosen style to every clip's
  // animationStyle right now. It does NOT create a persistent "global mode"
  // — each clip's dropdown remains independently editable afterward, same
  // as before. Selecting a different clip's animation individually later
  // simply overwrites that one clip's value, same as any other edit.
  const handleApplyAnimationToAll = useCallback(
    (animationStyle: AnimationStyle) => {
      setClips((prevClips) =>
        prevClips.map((clip) => ({ ...clip, animationStyle })),
      );
    },
    [],
  );

  // Switching mode applies its effect immediately — ascending/descending
  // recompute order from rank right away, shuffle randomizes once on
  // selection, manual leaves whatever order is already set untouched.
  const handleModeChange = useCallback((mode: PlayingOrderMode) => {
    setPlayingOrderMode(mode);
    setClips((prevClips) => {
      if (mode === "ascending" || mode === "descending") {
        return deriveOrderFromRank(prevClips, mode);
      }
      if (mode === "shuffle") {
        return shuffleOrder(prevClips);
      }
      return prevClips;
    });
  }, []);

  const handleShuffleAgain = useCallback(() => {
    setClips((prevClips) => shuffleOrder(prevClips));
  }, []);

  // Removing a clip must keep both `rank` and `order` as valid, gap-free
  // 1..N permutations for the remaining clips (N = new count) — e.g.
  // deleting the clip at rank 3 out of 1-2-3-4-5 should leave 1-2-3-4, not
  // a gap where 3 used to be, since downstream logic (badge slot 1..N,
  // the max on the rank input, ascending/descending order derivation) all
  // assumes a dense permutation. Rank and order are re-compacted
  // independently, each preserving its own existing relative ordering, the
  // same way they're treated as independent concepts everywhere else.
  const handleRemoveClip = useCallback((id: string) => {
    setClips((prevClips) => {
      const removedClip = prevClips.find((c) => c.id === id);
      if (removedClip && removedClip.src.startsWith("blob:")) {
        URL.revokeObjectURL(removedClip.src);
      }

      const remaining = prevClips.filter((c) => c.id !== id);
      const byRank = [...remaining].sort((a, b) => a.rank - b.rank);
      const rankById = new Map(byRank.map((c, i) => [c.id, i + 1]));
      const byOrder = [...remaining].sort((a, b) => a.order - b.order);
      const orderById = new Map(byOrder.map((c, i) => [c.id, i + 1]));

      return remaining.map((c) => ({
        ...c,
        rank: rankById.get(c.id) ?? c.rank,
        order: orderById.get(c.id) ?? c.order,
      }));
    });
  }, []);

  return (
    <div className="flex flex-col gap-4 text-foreground">
      <div className="flex flex-col gap-2">
        <label htmlFor="clip-upload" className="text-sm font-medium">
          Upload up to {MAX_CLIPS} video clips
        </label>
        <input
          id="clip-upload"
          type="file"
          accept="video/*"
          multiple
          onChange={onFilesSelected}
          className="text-sm"
        />
        {warning ? <p className="text-sm text-geist-error">{warning}</p> : null}
      </div>
      {clips.length > 0 ? (
        <>
          <div className="flex flex-col gap-3 border-t border-unfocused-border-color pt-4">
            <div className="field-row">
              <label className="field-row-label">Playing order</label>
              <div className="field-row-controls">
                <select
                  value={playingOrderMode}
                  onChange={(e) =>
                    handleModeChange(e.target.value as PlayingOrderMode)
                  }
                  className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
                >
                  <option value="manual">Manual (drag ⠿ below)</option>
                  <option value="ascending">Ascending rank (1 → N)</option>
                  <option value="descending">Descending rank (N → 1)</option>
                  <option value="shuffle">Shuffle</option>
                </select>
                {playingOrderMode === "shuffle" ? (
                  <Button compact onClick={handleShuffleAgain}>
                    Shuffle again
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-subtitle sm:pl-[10.5rem]">
              {playingOrderMode === "manual"
                ? "Drag ⠿ below to set exactly which clip plays when."
                : "Drag is disabled while an automatic playing order mode is selected — switch to Manual to drag."}
            </p>

            <div className="field-row">
              <label className="field-row-label">
                Apply animation to all clips
              </label>
              <div className="field-row-controls">
                <select
                  value={globalAnimationChoice}
                  onChange={(e) =>
                    setGlobalAnimationChoice(e.target.value as AnimationStyle)
                  }
                  className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
                >
                  {ANIMATION_STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  compact
                  onClick={() =>
                    handleApplyAnimationToAll(globalAnimationChoice)
                  }
                >
                  Apply to all
                </Button>
              </div>
            </div>
            <p className="text-xs text-subtitle sm:pl-[10.5rem]">
              Applies once, to every clip&apos;s title reveal — you can still
              override any single clip&apos;s animation individually
              afterward.
            </p>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={clips.map((clip) => clip.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-3 border-t border-unfocused-border-color pt-4">
                {clips.map((clip) => (
                  <SortableClipRow
                    key={clip.id}
                    clip={clip}
                    clipCount={clips.length}
                    dragEnabled={playingOrderMode === "manual"}
                    rankingListStyle={rankingListStyle}
                    stickerPlacementArmedFor={stickerPlacementArmedFor}
                    onTitleChange={handleTitleChange}
                    onRankChange={handleRankChange}
                    onBadgeTypeChange={handleBadgeTypeChange}
                    onBadgeEmojiChange={handleBadgeEmojiChange}
                    onAnimationStyleChange={handleAnimationStyleChange}
                    onBadgeStyleOverrideChange={handleBadgeStyleOverrideChange}
                    onTitleStyleOverrideChange={handleTitleStyleOverrideChange}
                    onStickersChange={handleStickersChange}
                    onArmStickerPlacement={onArmStickerPlacement}
                    onTrimChange={handleTrimChange}
                    onCropChange={handleCropChange}
                    onRotationChange={handleRotationChange}
                    onRequestRemove={(id) =>
                      setPendingDeleteClip(
                        clips.find((c) => c.id === id) ?? null,
                      )
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      ) : null}
      <ConfirmDialog
        open={pendingDeleteClip !== null}
        title="Remove this clip?"
        description={
          pendingDeleteClip
            ? `"${pendingDeleteClip.file.name}" will be removed from the project. This can't be undone.`
            : undefined
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (pendingDeleteClip) {
            handleRemoveClip(pendingDeleteClip.id);
          }
          setPendingDeleteClip(null);
        }}
        onCancel={() => setPendingDeleteClip(null)}
      />
    </div>
  );
  },
);

ClipUploader.displayName = "ClipUploader";