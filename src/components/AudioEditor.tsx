"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MAX_ORIGINAL_AUDIO_VOLUME,
  MAX_VOICE_OVER_VOLUME,
  DEFAULT_ORIGINAL_AUDIO_VOLUME,
  VOICE_OVER_DEFAULT_DUCK_LEVEL,
  VOICE_OVER_DEFAULT_DUCK_WINDOW_SECONDS,
  VOICE_OVER_DEFAULT_VOLUME,
} from "../../types/constants";
import { InputContainer } from "./Container";

// Matches VIDEO_FPS in types/constants.ts. Duplicated here on purpose —
// same reasoning as ClipUploader.tsx's own local FPS constant: this
// component doesn't need to know about the Remotion composition at all,
// just how to convert the seconds a person types into frames.
const FPS = 30;

type UploadStatus = "uploading" | "done" | "error";

export type MusicState = {
  file: File | null;
  src: string | null;
  durationInFrames: number | null; // null = still being read, or no file yet
  uploadStatus: UploadStatus | null; // null = no file yet
  volume: number;
  duckLevel: number;
};

export type VoiceOverClip = {
  id: string;
  file: File;
  src: string;
  durationInFrames: number | null; // null = still being read
  uploadStatus: UploadStatus;
  startFrame: number;
  volume: number;
  duckOriginalFrom: number;
  duckOriginalTo: number;
  duckOriginalLevel: number;
};

const DEFAULT_MUSIC_STATE: MusicState = {
  file: null,
  src: null,
  durationInFrames: null,
  uploadStatus: null,
  volume: 0.5,
  duckLevel: 0.2,
};

/**
 * Reads an audio file's duration in seconds using an offscreen <audio>
 * element. Same Infinity-duration quirk handling as ClipUploader.tsx's
 * getVideoDurationInSeconds — some formats report Infinity until seeked.
 */
const getAudioDurationInSeconds = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const audioEl = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    audioEl.preload = "metadata";
    audioEl.src = objectUrl;

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

    audioEl.onloadedmetadata = () => {
      if (audioEl.duration === Infinity || Number.isNaN(audioEl.duration)) {
        audioEl.currentTime = 1e101;
        audioEl.ontimeupdate = () => {
          audioEl.ontimeupdate = null;
          finish(audioEl.duration);
        };
      } else {
        finish(audioEl.duration);
      }
    };

    audioEl.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read duration for "${file.name}"`));
    };
  });
};

/** Same /api/upload endpoint the video clips use — it branches on file type. */
const uploadAudioToServer = async (file: File): Promise<string> => {
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

/** Matches ClipUploader.tsx's own per-row remove button exactly — same
 * icon, same hover treatment — so "remove" reads identically everywhere
 * in the app. */
const RemoveIconButton: React.FC<{ onClick: () => void; label: string }> = ({
  onClick,
  label,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
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
);

/** Small chip-style action button for "Use current preview time" — a
 * clock icon plus accent-colored text reads as clearly clickable without
 * the visual weight of a full Button component in an already-dense row. */
const UseCurrentTimeButton: React.FC<{ onClick: () => void }> = ({
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
    Use current preview time
  </button>
);

/**
 * A seconds field that's actually typeable. `type="number"` inputs whose
 * `value` is recomputed with `.toFixed(2)` on every render (the previous
 * version of this file) reformat themselves mid-keystroke — the display
 * snaps back before a person can finish typing a second character, which
 * reads as "only the up/down arrows work."
 *
 * The fix: keep a local text buffer that's free to hold whatever the
 * person is currently typing (including transiently invalid states like
 * "2." or an empty string), and only re-sync that buffer from the real
 * frame value when this input *isn't* focused — e.g. right after a "Use
 * current preview time" click changes the value from outside. While
 * focused, every keystroke both updates the visible text immediately and
 * (when it parses to a valid number) commits the frame value upstream, so
 * dependent UI (like the duck window's own min/max clamps) stays live as
 * you type rather than only updating on blur.
 */
const SecondsInput: React.FC<{
  valueInFrames: number;
  onCommitFrames: (frames: number) => void;
}> = ({ valueInFrames, onCommitFrames }) => {
  const [draft, setDraft] = useState(() => (valueInFrames / FPS).toFixed(2));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft((valueInFrames / FPS).toFixed(2));
    }
  }, [valueInFrames, isFocused]);

  const commit = (text: string) => {
    const seconds = Number(text);
    if (Number.isFinite(seconds)) {
      onCommitFrames(Math.max(0, Math.round(seconds * FPS)));
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => {
        setDraft(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => {
        setIsFocused(false);
        commit(draft);
      }}
      className="w-20 rounded-geist border border-unfocused-border-color bg-background px-2 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    />
  );
};

/**
 * Phase 12 — background music (one track for the whole video, with a
 * fixed-percentage duck under clip audio) and voice-over clips (any
 * uploaded spoken-word audio, placed anywhere in the timeline, with its
 * own duck window over the original clip audio underneath it).
 *
 * `getCurrentPreviewSeconds` is read from page.tsx's Player ref — every
 * "Use current preview time" button below is what makes placing a
 * voice-over and setting its duck window not require guessing seconds by
 * hand: scrub the preview to the right moment, then click the button.
 */
export const AudioEditor: React.FC<{
  onMusicChange?: (music: MusicState) => void;
  onVoiceOversChange?: (voiceOvers: VoiceOverClip[]) => void;
  onOriginalAudioVolumeChange?: (volume: number) => void;
  getCurrentPreviewSeconds: () => number;
}> = ({
  onMusicChange,
  onVoiceOversChange,
  onOriginalAudioVolumeChange,
  getCurrentPreviewSeconds,
}) => {
  const [music, setMusic] = useState<MusicState>(DEFAULT_MUSIC_STATE);
  const [voiceOvers, setVoiceOvers] = useState<VoiceOverClip[]>([]);
  // Phase 12 (extended) — one master volume for every clip's original
  // audio, applied uniformly across the whole video rather than per clip.
  const [originalAudioVolume, setOriginalAudioVolume] = useState(
    DEFAULT_ORIGINAL_AUDIO_VOLUME,
  );

  useEffect(() => {
    onMusicChange?.(music);
  }, [music, onMusicChange]);

  useEffect(() => {
    onVoiceOversChange?.(voiceOvers);
  }, [voiceOvers, onVoiceOversChange]);

  useEffect(() => {
    onOriginalAudioVolumeChange?.(originalAudioVolume);
  }, [originalAudioVolume, onOriginalAudioVolumeChange]);

  const handleMusicFileSelected: React.ChangeEventHandler<HTMLInputElement> =
    useCallback((e) => {
      const file = e.currentTarget.files?.[0];
      if (!file) {
        return;
      }

      const src = URL.createObjectURL(file);
      setMusic({
        file,
        src,
        durationInFrames: null,
        uploadStatus: "uploading",
        volume: DEFAULT_MUSIC_STATE.volume,
        duckLevel: DEFAULT_MUSIC_STATE.duckLevel,
      });

      getAudioDurationInSeconds(file)
        .then((durationInSeconds) => {
          setMusic((prev) =>
            prev.file === file
              ? {
                  ...prev,
                  durationInFrames: Math.round(durationInSeconds * FPS),
                }
              : prev,
          );
        })
        .catch((err) => console.error(err));

      uploadAudioToServer(file)
        .then((serverUrl) => {
          setMusic((prev) =>
            prev.file === file
              ? { ...prev, src: serverUrl, uploadStatus: "done" }
              : prev,
          );
        })
        .catch((err) => {
          console.error(err);
          setMusic((prev) =>
            prev.file === file ? { ...prev, uploadStatus: "error" } : prev,
          );
        });
    }, []);

  const handleRemoveMusic = useCallback(() => {
    setMusic((prev) => {
      if (prev.src?.startsWith("blob:")) {
        URL.revokeObjectURL(prev.src);
      }
      return DEFAULT_MUSIC_STATE;
    });
  }, []);

  const handleVoiceOverFileSelected: React.ChangeEventHandler<HTMLInputElement> =
    useCallback(
      (e) => {
        const file = e.currentTarget.files?.[0];
        if (!file) {
          return;
        }

        const id = crypto.randomUUID();
        const src = URL.createObjectURL(file);
        // Seed placement at wherever the preview currently is, and default
        // the duck window to start there too — a sensible starting point
        // that gets corrected to the voice-over's own exact length the
        // moment its real duration is known (see below), and can still be
        // dragged/typed to something else entirely afterward.
        const startFrame = Math.max(
          0,
          Math.round(getCurrentPreviewSeconds() * FPS),
        );

        const newVoiceOver: VoiceOverClip = {
          id,
          file,
          src,
          durationInFrames: null,
          uploadStatus: "uploading",
          startFrame,
          volume: VOICE_OVER_DEFAULT_VOLUME,
          duckOriginalFrom: startFrame,
          duckOriginalTo:
            startFrame + VOICE_OVER_DEFAULT_DUCK_WINDOW_SECONDS * FPS,
          duckOriginalLevel: VOICE_OVER_DEFAULT_DUCK_LEVEL,
        };

        setVoiceOvers((prev) => [...prev, newVoiceOver]);

        getAudioDurationInSeconds(file)
          .then((durationInSeconds) => {
            const durationInFrames = Math.round(durationInSeconds * FPS);
            setVoiceOvers((prev) =>
              prev.map((vo) =>
                vo.id === id
                  ? {
                      ...vo,
                      durationInFrames,
                      // Now that the real length is known, snap the duck
                      // window to match it exactly, rather than leaving
                      // the placeholder guess in place.
                      duckOriginalTo: vo.startFrame + durationInFrames,
                    }
                  : vo,
              ),
            );
          })
          .catch((err) => console.error(err));

        uploadAudioToServer(file)
          .then((serverUrl) => {
            setVoiceOvers((prev) =>
              prev.map((vo) =>
                vo.id === id
                  ? { ...vo, src: serverUrl, uploadStatus: "done" }
                  : vo,
              ),
            );
          })
          .catch((err) => {
            console.error(err);
            setVoiceOvers((prev) =>
              prev.map((vo) =>
                vo.id === id ? { ...vo, uploadStatus: "error" } : vo,
              ),
            );
          });

        // Allow selecting the same file again later (e.g. re-adding after
        // removing it) — without this, the input's onChange won't fire a
        // second time for an identical file.
        e.currentTarget.value = "";
      },
      [getCurrentPreviewSeconds],
    );

  const updateVoiceOver = useCallback(
    (id: string, patch: Partial<VoiceOverClip>) => {
      setVoiceOvers((prev) =>
        prev.map((vo) => (vo.id === id ? { ...vo, ...patch } : vo)),
      );
    },
    [],
  );

  const removeVoiceOver = useCallback((id: string) => {
    setVoiceOvers((prev) => {
      const removed = prev.find((vo) => vo.id === id);
      if (removed?.src.startsWith("blob:")) {
        URL.revokeObjectURL(removed.src);
      }
      return prev.filter((vo) => vo.id !== id);
    });
  }, []);

  return (
    <InputContainer>
      <label className="text-sm font-medium">Audio</label>

      <div className="flex flex-col gap-3 control-group">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-subtitle">
          <span aria-hidden="true">🔊</span> Original video sound
        </p>
        <p className="text-[11px] text-subtitle">
          One level for every clip&apos;s own audio together — not
          configurable per clip.
        </p>
        <div className="field-row">
          <label className="field-row-label">Volume</label>
          <div className="field-row-controls">
            <input
              type="range"
              min={0}
              max={MAX_ORIGINAL_AUDIO_VOLUME}
              step={0.05}
              value={originalAudioVolume}
              onChange={(e) => setOriginalAudioVolume(Number(e.target.value))}
              className="w-40"
            />
            <span className="w-12 font-mono-tabular text-sm text-subtitle">
              {Math.round(originalAudioVolume * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-subtitle">
          <span aria-hidden="true">🎵</span> Background music
        </p>
        {!music.file ? (
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
            Choose a music file
            <input
              type="file"
              accept="audio/*"
              onChange={handleMusicFileSelected}
              className="hidden"
            />
          </label>
        ) : (
          <div className="flex flex-col gap-3 rounded-geist border border-unfocused-border-color bg-background p-geist-half">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {music.file.name}
              </span>
              <span className="font-mono-tabular text-xs text-subtitle">
                {music.durationInFrames === null
                  ? "reading duration…"
                  : `${(music.durationInFrames / FPS).toFixed(1)}s`}
              </span>
              {music.uploadStatus ? (
                <StatusPill status={music.uploadStatus} />
              ) : null}
              <RemoveIconButton
                onClick={handleRemoveMusic}
                label="Remove music track"
              />
            </div>
            <div className="field-row">
              <label className="field-row-label">Volume</label>
              <div className="field-row-controls">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={music.volume}
                  onChange={(e) =>
                    setMusic((prev) => ({
                      ...prev,
                      volume: Number(e.target.value),
                    }))
                  }
                  className="w-40"
                />
                <span className="w-12 font-mono-tabular text-sm text-subtitle">
                  {Math.round(music.volume * 100)}%
                </span>
              </div>
            </div>
            <div className="field-row">
              <label className="field-row-label">Volume during clips</label>
              <div className="field-row-controls">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={music.duckLevel}
                  onChange={(e) =>
                    setMusic((prev) => ({
                      ...prev,
                      duckLevel: Number(e.target.value),
                    }))
                  }
                  className="w-40"
                />
                <span className="w-12 font-mono-tabular text-sm text-subtitle">
                  {Math.round(music.duckLevel * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-unfocused-border-color pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-subtitle">
          <span aria-hidden="true">🎙️</span> Voice-over clips
        </p>
        <p className="text-xs text-subtitle">
          Upload any spoken-word audio — recorded yourself, or generated with
          an external text-to-speech tool — and place it anywhere in the
          video. The original clip audio automatically ducks underneath it
          for whatever range you set below.
        </p>
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
          Add a voice-over clip
          <input
            type="file"
            accept="audio/*"
            onChange={handleVoiceOverFileSelected}
            className="hidden"
          />
        </label>

        {voiceOvers.map((vo, index) => (
          <div
            key={vo.id}
            className="flex flex-col gap-3 rounded-geist border border-unfocused-border-color bg-background p-geist-half text-sm shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {vo.file.name}
              </span>
              <span className="font-mono-tabular text-xs text-subtitle">
                {vo.durationInFrames === null
                  ? "reading duration…"
                  : `${(vo.durationInFrames / FPS).toFixed(1)}s`}
              </span>
              <StatusPill status={vo.uploadStatus} />
              <RemoveIconButton
                onClick={() => removeVoiceOver(vo.id)}
                label="Remove this voice-over"
              />
            </div>

            <div className="field-row">
              <label className="field-row-label">Starts at</label>
              <div className="field-row-controls control-group">
                <SecondsInput
                  valueInFrames={vo.startFrame}
                  onCommitFrames={(startFrame) =>
                    updateVoiceOver(vo.id, { startFrame })
                  }
                />
                <span className="text-xs text-subtitle">s</span>
                <UseCurrentTimeButton
                  onClick={() =>
                    updateVoiceOver(vo.id, {
                      startFrame: Math.max(
                        0,
                        Math.round(getCurrentPreviewSeconds() * FPS),
                      ),
                    })
                  }
                />
              </div>
            </div>

            <div className="field-row">
              <label className="field-row-label">Volume</label>
              <div className="field-row-controls">
                <input
                  type="range"
                  min={0}
                  max={MAX_VOICE_OVER_VOLUME}
                  step={0.05}
                  value={vo.volume}
                  onChange={(e) =>
                    updateVoiceOver(vo.id, { volume: Number(e.target.value) })
                  }
                  className="w-40"
                />
                <span className="w-12 font-mono-tabular text-sm text-subtitle">
                  {Math.round(vo.volume * 100)}%
                </span>
              </div>
              {vo.volume > 1 ? (
                <p className="text-[11px] leading-snug text-subtitle">
                  Above 100% amplifies beyond the original recording's own
                  loudness — useful since a quieter TTS/recorded voice-over
                  often needs boosting to match a video clip's own audio.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 rounded-geist border border-unfocused-border-color bg-panel-raised/40 p-geist-half">
              <p className="flex items-center gap-1.5 text-xs font-medium text-subtitle">
                <span aria-hidden="true">🔉</span> Duck the original video's
                volume
              </p>
              <div className="field-row">
                <label className="field-row-label">From</label>
                <div className="field-row-controls control-group">
                  <SecondsInput
                    valueInFrames={vo.duckOriginalFrom}
                    onCommitFrames={(duckOriginalFrom) =>
                      updateVoiceOver(vo.id, {
                        duckOriginalFrom,
                        duckOriginalTo: Math.max(
                          duckOriginalFrom + 1,
                          vo.duckOriginalTo,
                        ),
                      })
                    }
                  />
                  <span className="text-xs text-subtitle">s</span>
                  <UseCurrentTimeButton
                    onClick={() =>
                      updateVoiceOver(vo.id, {
                        duckOriginalFrom: Math.max(
                          0,
                          Math.round(getCurrentPreviewSeconds() * FPS),
                        ),
                      })
                    }
                  />
                </div>
              </div>
              <div className="field-row">
                <label className="field-row-label">To</label>
                <div className="field-row-controls control-group">
                  <SecondsInput
                    valueInFrames={vo.duckOriginalTo}
                    onCommitFrames={(duckOriginalTo) =>
                      updateVoiceOver(vo.id, {
                        duckOriginalTo: Math.max(
                          vo.duckOriginalFrom + 1,
                          duckOriginalTo,
                        ),
                      })
                    }
                  />
                  <span className="text-xs text-subtitle">s</span>
                  <UseCurrentTimeButton
                    onClick={() =>
                      updateVoiceOver(vo.id, {
                        duckOriginalTo: Math.max(
                          0,
                          Math.round(getCurrentPreviewSeconds() * FPS),
                        ),
                      })
                    }
                  />
                </div>
              </div>
              <div className="field-row">
                <label className="field-row-label">
                  Original volume during this
                </label>
                <div className="field-row-controls">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vo.duckOriginalLevel}
                    onChange={(e) =>
                      updateVoiceOver(vo.id, {
                        duckOriginalLevel: Number(e.target.value),
                      })
                    }
                    className="w-40"
                  />
                  <span className="w-12 font-mono-tabular text-sm text-subtitle">
                    {Math.round(vo.duckOriginalLevel * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </InputContainer>
  );
};