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
 * A single draggable row in the clip list. Split out from the main
 * component because useSortable() must be called once per draggable item,
 * not once for the whole list.
 */
const SortableClipRow: React.FC<{
  clip: UploadedClip;
  clipCount: number;
  dragEnabled: boolean;
  onTitleChange: (id: string, title: string) => void;
  onRankChange: (id: string, rank: number) => void;
  onBadgeTypeChange: (id: string, badgeType: "number" | "emoji") => void;
  onBadgeEmojiChange: (id: string, emoji: string) => void;
}> = ({
  clip,
  clipCount,
  dragEnabled,
  onTitleChange,
  onRankChange,
  onBadgeTypeChange,
  onBadgeEmojiChange,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: clip.id, disabled: !dragEnabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-1 text-sm bg-background py-1"
    >
      <div className="flex items-center gap-2">
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
        <span>
          Plays #{clip.order} — {clip.file.name} (
          {(clip.file.size / 1024 / 1024).toFixed(1)} MB) —{" "}
          {clip.durationInFrames === null ? (
            <span className="text-subtitle">reading duration…</span>
          ) : (
            <span>
              {(clip.durationInFrames / FPS).toFixed(1)}s (
              {clip.durationInFrames} frames)
            </span>
          )}
          {" — "}
          {clip.uploadStatus === "uploading" ? (
            <span className="text-subtitle">uploading…</span>
          ) : clip.uploadStatus === "done" ? (
            <span className="text-green-500">uploaded</span>
          ) : (
            <span className="text-red-500">upload failed</span>
          )}
        </span>
      </div>
      <div className="ml-6 flex items-center gap-2 flex-wrap">
        <label className="text-subtitle text-xs">Rank</label>
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
            onBadgeTypeChange(
              clip.id,
              e.target.value as "number" | "emoji",
            )
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
      <input
        type="text"
        value={clip.title}
        onChange={(e) => onTitleChange(clip.id, e.target.value)}
        placeholder="Title for this clip (optional)"
        className="ml-6 text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
      />
    </li>
  );
};

export const ClipUploader: React.FC<{
  onClipsChange?: (clips: UploadedClip[]) => void;
}> = ({ onClipsChange }) => {
  const [clips, setClips] = useState<UploadedClip[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  // Manual = drag-and-drop decides play order directly. Ascending/descending
  // derive play order from rank automatically. Shuffle randomizes it.
  const [playingOrderMode, setPlayingOrderMode] =
    useState<PlayingOrderMode>("manual");

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
    <div className="border border-unfocused-border-color p-geist rounded-geist bg-background text-foreground flex flex-col gap-3">
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
      {warning ? <p className="text-sm text-red-500">{warning}</p> : null}
      {clips.length > 0 ? (
        <>
          <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <label className="text-sm text-subtitle">Playing order</label>
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
            </div>
            {playingOrderMode === "shuffle" ? (
              <Button onClick={handleShuffleAgain}>Shuffle again</Button>
            ) : null}
          </div>
          <p className="text-sm text-subtitle">
            {playingOrderMode === "manual"
              ? "Drag ⠿ below to set exactly which clip plays when."
              : "Drag is disabled while an automatic playing order mode is selected — switch to Manual to drag."}
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={clips.map((clip) => clip.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {clips.map((clip) => (
                  <SortableClipRow
                    key={clip.id}
                    clip={clip}
                    clipCount={clips.length}
                    dragEnabled={playingOrderMode === "manual"}
                    onTitleChange={handleTitleChange}
                    onRankChange={handleRankChange}
                    onBadgeTypeChange={handleBadgeTypeChange}
                    onBadgeEmojiChange={handleBadgeEmojiChange}
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