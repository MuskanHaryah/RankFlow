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
import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button";

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

export type UploadedClip = {
  id: string;
  file: File;
  src: string; // starts as a blob: URL for instant preview, later replaced by the real uploaded server path
  order: number; // playback sequence position
  durationInFrames: number | null; // null = still being read
  uploadStatus: "uploading" | "done" | "error";
  title: string; // empty string = no title text shown once revealed
  rank: number; // which badge slot (1..N) this clip is assigned to
  badgeType: "number" | "emoji";
  badgeEmoji: string; // only used when badgeType is "emoji"
  badgeStyleOverride: RankStyleOverride; // null = use the project-level badge defaults
  titleStyleOverride: RankStyleOverride; // null = use the project-level title defaults
  animationStyle: AnimationStyle; // entrance animation for this clip's title reveal
};

export type PlayingOrderMode = "manual" | "ascending" | "descending" | "shuffle";

const MAX_CLIPS = 10;

// Matches VIDEO_FPS in types/constants.ts. Duplicated here on purpose —
// this component doesn't need to know about the Remotion composition at all.
const FPS = 30;

/**
 * Reads a video file's duration in seconds using an offscreen <video> element.
 *
 * Handles a known browser quirk: some formats (webm especially) report
 * duration as Infinity until you seek into the file.
 */
const getVideoDurationInSeconds = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const videoEl = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    videoEl.preload = "metadata";
    videoEl.src = objectUrl;

    const finish = (duration: number) => {
      URL.revokeObjectURL(objectUrl);
      if (Number.isFinite(duration) && duration > 0) {
        resolve(duration);
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
 * A single draggable row in the clip list. Split out from the main
 * component because useSortable() must be called once per draggable item,
 * not once for the whole list.
 */
const SortableClipRow: React.FC<{
  clip: UploadedClip;
  clipCount: number;
  dragEnabled: boolean;
  rankingListStyle: RankingListStyleForSeeding;
  onTitleChange: (id: string, title: string) => void;
  onRankChange: (id: string, rank: number) => void;
  onBadgeTypeChange: (id: string, badgeType: "number" | "emoji") => void;
  onBadgeEmojiChange: (id: string, emoji: string) => void;
  onAnimationStyleChange: (id: string, animationStyle: AnimationStyle) => void;
  onBadgeStyleOverrideChange: (id: string, override: RankStyleOverride) => void;
  onTitleStyleOverrideChange: (id: string, override: RankStyleOverride) => void;
}> = ({
  clip,
  clipCount,
  dragEnabled,
  rankingListStyle,
  onTitleChange,
  onRankChange,
  onBadgeTypeChange,
  onBadgeEmojiChange,
  onAnimationStyleChange,
  onBadgeStyleOverrideChange,
  onTitleStyleOverrideChange,
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
      </div>
    </li>
  );
};

export const ClipUploader: React.FC<{
  onClipsChange?: (clips: UploadedClip[]) => void;
  rankingListStyle: RankingListStyleForSeeding;
}> = ({ onClipsChange, rankingListStyle }) => {
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
      }));

      setClips(newClips);
      console.log("Uploaded clips (durations + server upload pending):", newClips);

      // Duration reading and server upload run independently and in
      // parallel per clip — neither depends on the other finishing first.
      newClips.forEach((clip) => {
        getVideoDurationInSeconds(clip.file)
          .then((durationInSeconds) => {
            const durationInFrames = Math.round(durationInSeconds * FPS);

            setClips((prevClips) =>
              prevClips.map((prevClip) =>
                prevClip.id === clip.id
                  ? { ...prevClip, durationInFrames }
                  : prevClip,
              ),
            );

            console.log(
              `Duration read for "${clip.file.name}": ${durationInSeconds.toFixed(
                2,
              )}s -> ${durationInFrames} frames at ${FPS}fps`,
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
                    onTitleChange={handleTitleChange}
                    onRankChange={handleRankChange}
                    onBadgeTypeChange={handleBadgeTypeChange}
                    onBadgeEmojiChange={handleBadgeEmojiChange}
                    onAnimationStyleChange={handleAnimationStyleChange}
                    onBadgeStyleOverrideChange={handleBadgeStyleOverrideChange}
                    onTitleStyleOverrideChange={handleTitleStyleOverrideChange}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      ) : null}
    </div>
  );
}