"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import {
  TRANSITION_MAX_DURATION_SECONDS,
  TRANSITION_MIN_DURATION_SECONDS,
  TRANSITION_STYLE_OPTIONS,
} from "../../types/constants";
import { InputContainer } from "./Container";

// Matches VIDEO_FPS in types/constants.ts. Duplicated here on purpose —
// same reasoning as every other editor's own local FPS constant: this
// component doesn't need to know about the Remotion composition at all.
const FPS = 30;

type UploadStatus = "uploading" | "done" | "error";
export type TransitionStyle = (typeof TRANSITION_STYLE_OPTIONS)[number];

export type TransitionState = {
  style: TransitionStyle;
  durationInFrames: number;
  // Optional whoosh/voice line, same File/src/uploadStatus shape every
  // other uploader in this app uses — a File can't survive a page
  // reload, sourceFileName can (restored from a saved project).
  soundFile: File | null;
  soundSourceFileName: string;
  soundSrc: string | null;
  soundUploadStatus: UploadStatus | null; // null = no sound chosen
};

export const DEFAULT_TRANSITION_STATE: TransitionState = {
  style: "none",
  durationInFrames: 15,
  soundFile: null,
  soundSourceFileName: "",
  soundSrc: null,
  soundUploadStatus: null,
};

const STYLE_OPTIONS: { value: TransitionStyle; label: string }[] = [
  { value: "none", label: "None (hard cut)" },
  { value: "fade", label: "Fade to black" },
  { value: "flash", label: "Flash (white)" },
  { value: "wipe", label: "Wipe — horizontal" },
  { value: "wipeVertical", label: "Wipe — vertical" },
  { value: "diagonalWipe", label: "Wipe — diagonal" },
  { value: "whoosh", label: "Whoosh (motion blur streak)" },
  { value: "glitch", label: "Glitch (RGB split)" },
  { value: "irisRound", label: "Iris (circle)" },
  { value: "shutterSplit", label: "Shutter split" },
];

/** Same /api/upload endpoint every other upload in this app uses. */
const uploadSoundToServer = async (file: File): Promise<string> => {
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

export type TransitionEditorHandle = {
  // Restores a saved project's or draft's transition state wholesale.
  loadTransitionState: (state: TransitionState) => void;
};

/**
 * The global transition — an effect that plays at every internal cut
 * between two ranked clips (never after the last clip, and never in
 * place of the hook's own separate outroAnimation into clip 1).
 *
 * Deliberately rendered in Main.tsx as a pure full-screen overlay
 * centered on the existing hard cut, the same pattern the hook's own
 * outro transition already uses — it never changes any clip's own
 * durationInFrames or computeClipRanges, so turning this on/off (or
 * changing style) can't shift any other timing in the project.
 */
export const TransitionEditor = forwardRef<
  TransitionEditorHandle,
  { onTransitionChange?: (transition: TransitionState) => void }
>(({ onTransitionChange }, ref) => {
  const [transition, setTransition] = useState<TransitionState>(
    DEFAULT_TRANSITION_STATE,
  );

  useEffect(() => {
    onTransitionChange?.(transition);
  }, [transition, onTransitionChange]);

  useImperativeHandle(
    ref,
    () => ({
      // Merged against DEFAULT_TRANSITION_STATE rather than used as-is —
      // a project or autosaved draft saved before this feature existed
      // has no `transition` object at all, and one saved before the
      // sound feature existed is missing soundSrc/soundUploadStatus.
      // Same defensive pattern as HookEditor's loadHookState.
      loadTransitionState: (state: TransitionState) =>
        setTransition({ ...DEFAULT_TRANSITION_STATE, ...state }),
    }),
    [],
  );

  const handleSoundSelected: React.ChangeEventHandler<HTMLInputElement> =
    useCallback((e) => {
      const file = e.currentTarget.files?.[0];
      if (!file) {
        return;
      }

      const src = URL.createObjectURL(file);
      setTransition((prev) => ({
        ...prev,
        soundFile: file,
        soundSourceFileName: file.name,
        soundSrc: src,
        soundUploadStatus: "uploading",
      }));

      uploadSoundToServer(file)
        .then((serverUrl) => {
          setTransition((prev) =>
            prev.soundFile === file
              ? { ...prev, soundSrc: serverUrl, soundUploadStatus: "done" }
              : prev,
          );
        })
        .catch((err) => {
          console.error(err);
          setTransition((prev) =>
            prev.soundFile === file
              ? { ...prev, soundUploadStatus: "error" }
              : prev,
          );
        });

      e.currentTarget.value = "";
    }, []);

  const handleRemoveSound = useCallback(() => {
    setTransition((prev) => {
      if (prev.soundSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(prev.soundSrc);
      }
      return {
        ...prev,
        soundFile: null,
        soundSourceFileName: "",
        soundSrc: null,
        soundUploadStatus: null,
      };
    });
  }, []);

  return (
    <InputContainer>
      <label className="text-sm font-medium">Transition</label>
      <p className="text-xs text-subtitle">
        Plays automatically at every cut between two ranked clips — never
        after the last clip, and never in place of the hook's own closing
        animation above. Pick a style, and optionally add a whoosh or voice
        line that plays right as each transition starts.
      </p>

      <div className="field-row">
        <label className="field-row-label">Style</label>
        <div className="field-row-controls">
          <select
            value={transition.style}
            onChange={(e) =>
              setTransition((prev) => ({
                ...prev,
                style: e.target.value as TransitionStyle,
              }))
            }
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            {STYLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {transition.style !== "none" ? (
        <>
          <div className="field-row">
            <label className="field-row-label">Transition length</label>
            <div className="field-row-controls">
              <input
                type="range"
                min={TRANSITION_MIN_DURATION_SECONDS}
                max={TRANSITION_MAX_DURATION_SECONDS}
                step={0.05}
                value={transition.durationInFrames / FPS}
                onChange={(e) =>
                  setTransition((prev) => ({
                    ...prev,
                    durationInFrames: Math.round(
                      Number(e.target.value) * FPS,
                    ),
                  }))
                }
                className="w-40"
              />
              <span className="w-14 font-mono-tabular text-sm text-subtitle">
                {(transition.durationInFrames / FPS).toFixed(2)}s
              </span>
            </div>
          </div>

          {!transition.soundSrc ? (
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
              Add a whoosh or voice line (optional)
              <input
                type="file"
                accept="audio/*"
                onChange={handleSoundSelected}
                className="hidden"
              />
            </label>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-geist border border-unfocused-border-color bg-background p-geist-half text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {transition.soundSourceFileName || "Transition sound"}
              </span>
              {transition.soundUploadStatus ? (
                <StatusPill status={transition.soundUploadStatus} />
              ) : null}
              <button
                type="button"
                onClick={handleRemoveSound}
                title="Remove transition sound"
                aria-label="Remove transition sound"
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
          )}
        </>
      ) : null}
    </InputContainer>
  );
});

TransitionEditor.displayName = "TransitionEditor";