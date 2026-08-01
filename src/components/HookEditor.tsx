"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import {
  HOOK_OUTRO_MAX_DURATION_SECONDS,
  HOOK_OUTRO_MIN_DURATION_SECONDS,
} from "../../types/constants";
import { InputContainer } from "./Container";

// Matches VIDEO_FPS in types/constants.ts. Duplicated here on purpose —
// same reasoning as ClipUploader.tsx's own local FPS constant: this
// component doesn't need to know about the Remotion composition at all.
const FPS = 30;

type UploadStatus = "uploading" | "done" | "error";
export type HookIntroAnimation = "none" | "fade" | "slideUp" | "zoomIn";
export type HookOutroAnimation = "none" | "fade" | "wipe" | "zoomFlash";

export type HookState = {
  file: File | null;
  // Persisted independently of `file` — a File object can't survive a
  // page reload/project load, but the display name still needs to show
  // up for a hook that was restored from a saved project. Empty string
  // when there's no hook at all.
  sourceFileName: string;
  src: string | null;
  durationInFrames: number | null; // null = still being read, or no file yet
  uploadStatus: UploadStatus | null; // null = no file yet
  introAnimation: HookIntroAnimation;
  outroAnimation: HookOutroAnimation;
  outroDurationInFrames: number;
};

const DEFAULT_HOOK_STATE: HookState = {
  file: null,
  sourceFileName: "",
  src: null,
  durationInFrames: null,
  uploadStatus: null,
  introAnimation: "fade",
  outroAnimation: "wipe",
  outroDurationInFrames: 15,
};

const INTRO_OPTIONS: { value: HookIntroAnimation; label: string }[] = [
  { value: "none", label: "None (hard start)" },
  { value: "fade", label: "Fade in" },
  { value: "slideUp", label: "Slide up" },
  { value: "zoomIn", label: "Zoom in" },
];

const OUTRO_OPTIONS: { value: HookOutroAnimation; label: string }[] = [
  { value: "none", label: "None (hard cut)" },
  { value: "fade", label: "Fade to black" },
  { value: "wipe", label: "Wipe" },
  { value: "zoomFlash", label: "Flash" },
];

/**
 * Reads a video file's duration in seconds using an offscreen <video>
 * element. Same Infinity-duration quirk handling as ClipUploader.tsx's
 * own duration reader — some formats report Infinity until seeked.
 * Duplicated locally rather than imported, same decoupling reasoning as
 * the FPS constant above.
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

/** Same /api/upload endpoint every other upload in this app uses. */
const uploadHookToServer = async (file: File): Promise<string> => {
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

const StatusPill: React.FC<{ status: UploadStatus }> = ({ status }) =>
  status === "uploading" ? (
    <span className="rounded-full bg-panel-raised px-2 py-0.5 text-[11px] text-subtitle">
      uploading…
    </span>
  ) : status === "done" ? (
    <span className="rounded-full bg-geist-success/10 px-2 py-0.5 text-[11px] text-geist-success">
      uploaded
    </span>
  ) : (
    <span className="rounded-full bg-geist-error/10 px-2 py-0.5 text-[11px] text-geist-error">
      upload failed
    </span>
  );

export type HookEditorHandle = {
  // Phase 14 — restores a saved project's or draft's hook state wholesale.
  loadHookState: (state: HookState) => void;
};

/**
 * Phase 17 — a short pre-roll "hook" that plays before the ranking
 * countdown begins, to grab attention before the actual ranked content
 * starts. Lives entirely outside the clips list — it isn't a ranked clip,
 * doesn't get a badge or a title, and Main.tsx prepends it to the very
 * front of the timeline, shifting every ranked clip's own start later.
 *
 * Deliberately reuses the exact same voice-over/ducking system Phase 12
 * already built rather than inventing a second one: placing a voice-over
 * clip's startFrame within the hook's own duration (e.g. via "Use current
 * preview time" while scrubbed to the hook) just works, the same as
 * placing one over any ranked clip.
 */
export const HookEditor = forwardRef<
  HookEditorHandle,
  { onHookChange?: (hook: HookState) => void }
>(({ onHookChange }, ref) => {
  const [hook, setHook] = useState<HookState>(DEFAULT_HOOK_STATE);

  useEffect(() => {
    onHookChange?.(hook);
  }, [hook, onHookChange]);

  useImperativeHandle(
    ref,
    () => ({
      loadHookState: (state: HookState) => setHook(state),
    }),
    [],
  );

  const handleFileSelected: React.ChangeEventHandler<HTMLInputElement> =
    useCallback((e) => {
      const file = e.currentTarget.files?.[0];
      if (!file) {
        return;
      }

      const src = URL.createObjectURL(file);
      setHook((prev) => ({
        ...DEFAULT_HOOK_STATE,
        introAnimation: prev.introAnimation,
        outroAnimation: prev.outroAnimation,
        outroDurationInFrames: prev.outroDurationInFrames,
        file,
        sourceFileName: file.name,
        src,
        uploadStatus: "uploading",
      }));

      getVideoDurationInSeconds(file)
        .then((durationInSeconds) => {
          setHook((prev) =>
            prev.file === file
              ? {
                  ...prev,
                  durationInFrames: Math.round(durationInSeconds * FPS),
                }
              : prev,
          );
        })
        .catch((err) => console.error(err));

      uploadHookToServer(file)
        .then((serverUrl) => {
          setHook((prev) =>
            prev.file === file
              ? { ...prev, src: serverUrl, uploadStatus: "done" }
              : prev,
          );
        })
        .catch((err) => {
          console.error(err);
          setHook((prev) =>
            prev.file === file ? { ...prev, uploadStatus: "error" } : prev,
          );
        });

      // Allow selecting the same file again later (e.g. re-adding after
      // removing it).
      e.currentTarget.value = "";
    }, []);

  const handleRemove = useCallback(() => {
    setHook((prev) => {
      if (prev.src?.startsWith("blob:")) {
        URL.revokeObjectURL(prev.src);
      }
      return {
        ...DEFAULT_HOOK_STATE,
        introAnimation: prev.introAnimation,
        outroAnimation: prev.outroAnimation,
        outroDurationInFrames: prev.outroDurationInFrames,
      };
    });
  }, []);

  return (
    <InputContainer>
      <label className="text-sm font-medium">Hook (pre-roll)</label>
      <p className="text-xs text-subtitle">
        A short teaser clip that plays before the ranking countdown starts,
        to grab attention — e.g. a quick clip with a voice-over saying
        "let's rank the most beautiful clay DIYs." Not one of your ranked
        clips: no badge, no title, no rank.
      </p>

      {!hook.src ? (
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-geist border border-dashed border-unfocused-border-color px-3 py-2 text-sm text-subtitle transition-colors duration-150 hover:border-accent hover:text-accent">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Choose a hook video
          <input
            type="file"
            accept="video/*"
            onChange={handleFileSelected}
            className="hidden"
          />
        </label>
      ) : (
        <div className="flex flex-col gap-3 rounded-geist border border-unfocused-border-color bg-background p-geist-half">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {hook.sourceFileName || "Hook video"}
            </span>
            <span className="font-mono-tabular text-xs text-subtitle">
              {hook.durationInFrames === null
                ? "reading duration…"
                : `${(hook.durationInFrames / FPS).toFixed(1)}s`}
            </span>
            {hook.uploadStatus ? (
              <StatusPill status={hook.uploadStatus} />
            ) : null}
            <button
              type="button"
              onClick={handleRemove}
              title="Remove hook video"
              aria-label="Remove hook video"
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

          <div className="field-row">
            <label className="field-row-label">Starts with</label>
            <div className="field-row-controls">
              <select
                value={hook.introAnimation}
                onChange={(e) =>
                  setHook((prev) => ({
                    ...prev,
                    introAnimation: e.target.value as HookIntroAnimation,
                  }))
                }
                className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
              >
                {INTRO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-row">
            <label className="field-row-label">Closes with</label>
            <div className="field-row-controls">
              <select
                value={hook.outroAnimation}
                onChange={(e) =>
                  setHook((prev) => ({
                    ...prev,
                    outroAnimation: e.target.value as HookOutroAnimation,
                  }))
                }
                className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
              >
                {OUTRO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {hook.outroAnimation !== "none" ? (
            <div className="field-row">
              <label className="field-row-label">Transition length</label>
              <div className="field-row-controls">
                <input
                  type="range"
                  min={HOOK_OUTRO_MIN_DURATION_SECONDS}
                  max={HOOK_OUTRO_MAX_DURATION_SECONDS}
                  step={0.05}
                  value={hook.outroDurationInFrames / FPS}
                  onChange={(e) =>
                    setHook((prev) => ({
                      ...prev,
                      outroDurationInFrames: Math.round(
                        Number(e.target.value) * FPS,
                      ),
                    }))
                  }
                  className="w-40"
                />
                <span className="w-14 font-mono-tabular text-sm text-subtitle">
                  {(hook.outroDurationInFrames / FPS).toFixed(2)}s
                </span>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-subtitle">
            Place a voice-over over the hook the same way you would over any
            ranked clip — scrub the preview to the hook, then use "Use
            current preview time" in the Audio section below.
          </p>
        </div>
      )}
    </InputContainer>
  );
});

HookEditor.displayName = "HookEditor";