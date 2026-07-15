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
  order: number;
  durationInFrames: number | null; // null = still being read
  uploadStatus: "uploading" | "done" | "error";
};

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
 * A single draggable row in the clip list. Split out from the main
 * component because useSortable() must be called once per draggable item,
 * not once for the whole list.
 */
const SortableClipRow: React.FC<{ clip: UploadedClip }> = ({ clip }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: clip.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 text-sm bg-background"
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing select-none px-1 text-subtitle"
        title="Drag to reorder"
      >
        ⠿
      </span>
      <span>
        #{clip.order} — {clip.file.name} (
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
    </li>
  );
};

export const ClipUploader: React.FC<{
  onClipsChange?: (clips: UploadedClip[]) => void;
}> = ({ onClipsChange }) => {
  const [clips, setClips] = useState<UploadedClip[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

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

  // Dragging changes the array's order — but the Remotion composition
  // reads the `order` field, not array position, so we reassign it here
  // to match. This is the step that actually makes the reorder "real"
  // rather than just visual.
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setClips((prevClips) => {
      const oldIndex = prevClips.findIndex((c) => c.id === active.id);
      const newIndex = prevClips.findIndex((c) => c.id === over.id);
      const reordered = arrayMove(prevClips, oldIndex, newIndex);
      return reordered.map((clip, index) => ({ ...clip, order: index + 1 }));
    });
  }, []);

  const handleShuffle = useCallback(() => {
    setClips((prevClips) => {
      const shuffled = [...prevClips];
      // Fisher-Yates shuffle
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.map((clip, index) => ({ ...clip, order: index + 1 }));
    });
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
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm text-subtitle">
              Drag ⠿ to reorder, or:
            </span>
            <Button disabled={clips.length < 2} onClick={handleShuffle}>
              Shuffle
            </Button>
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
              <ul className="flex flex-col gap-1">
                {clips.map((clip) => (
                  <SortableClipRow key={clip.id} clip={clip} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      ) : null}
    </div>
  );
};