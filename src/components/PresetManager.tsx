"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { PresetStyleSchema } from "../../types/constants";
import {
  ANIMATION_STYLE_OPTIONS,
  AnimationStyle,
} from "./ClipUploader";
import { loadPresets, Preset, savePresetsToStorage } from "../lib/presets";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Input } from "./Input";

export type PresetStyle = z.infer<typeof PresetStyleSchema>;
// Everything a preset captures *except* the default animation style — that
// one field is a save-time choice made right here in this panel (there's
// no single live "current" animation value elsewhere in the app to source
// it from, since animation is set per-clip), not a value page.tsx can
// hand in the way it hands in header/ranking-list/crop/audio-mix state.
type PresetStyleWithoutAnimation = Omit<PresetStyle, "defaultAnimationStyle">;

const formatSavedAt = (createdAt: number): string => {
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/**
 * Phase 13 — save the current project's full style (header look, ranking
 * list colors/fonts/borders/spacing, final crop, default title animation,
 * audio mix levels) as a named preset, and load any saved preset back onto
 * whatever project is currently open. Deliberately does NOT touch clips,
 * header wording, or uploaded audio files — see PresetStyleSchema's own
 * comment in constants.ts for why that's content, not style.
 *
 * Presets list starts empty and is only populated from localStorage inside
 * an effect (not during the initial render) — this keeps the server-
 * rendered and first-client-render HTML identical (both show the empty
 * state), avoiding any hydration mismatch from reading a browser-only API
 * during render.
 */
export const PresetManager: React.FC<{
  currentStyle: PresetStyleWithoutAnimation;
  onLoadPreset: (style: PresetStyle) => void;
}> = ({ currentStyle, onLoadPreset }) => {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newPresetName, setNewPresetName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [animationStyleToSave, setAnimationStyleToSave] =
    useState<AnimationStyle>("fade");
  const [pendingOverwrite, setPendingOverwrite] = useState<Preset | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<Preset | null>(null);
  const [pendingLoad, setPendingLoad] = useState<Preset | null>(null);

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const persist = useCallback((next: Preset[]) => {
    setPresets(next);
    savePresetsToStorage(next);
  }, []);

  const commitSave = useCallback(
    (name: string, replaceId?: string) => {
      const preset: Preset = {
        id: replaceId ?? crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        style: { ...currentStyle, defaultAnimationStyle: animationStyleToSave },
      };
      setPresets((prevPresets) => {
        const next = replaceId
          ? prevPresets.map((p) => (p.id === replaceId ? preset : p))
          : [...prevPresets, preset];
        savePresetsToStorage(next);
        return next;
      });
      setNewPresetName("");
      setNameError(null);
    },
    [currentStyle, animationStyleToSave],
  );

  const handleSaveClick = useCallback(() => {
    const trimmed = newPresetName.trim();
    if (trimmed.length === 0) {
      setNameError("Give this preset a name first.");
      return;
    }
    const existing = presets.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      setPendingOverwrite(existing);
      return;
    }
    commitSave(trimmed);
  }, [newPresetName, presets, commitSave]);

  const sortedPresets = [...presets].sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Save current style as a preset
        </label>
        <div className="mb-2 flex items-center gap-2">
          <label className="text-xs text-subtitle" htmlFor="preset-animation-style">
            Default title animation
          </label>
          <select
            id="preset-animation-style"
            value={animationStyleToSave}
            onChange={(e) =>
              setAnimationStyleToSave(e.target.value as AnimationStyle)
            }
            className="rounded-geist border border-unfocused-border-color bg-panel px-2 py-1 text-xs text-foreground transition-colors duration-150 focus:border-focused-border-color"
          >
            {ANIMATION_STYLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              text={newPresetName}
              setText={(value) => {
                setNewPresetName(value);
                setNameError(null);
              }}
            />
          </div>
          <Button onClick={handleSaveClick} compact>
            Save
          </Button>
        </div>
        {nameError ? (
          <p className="mt-1.5 text-xs text-geist-error">{nameError}</p>
        ) : (
          <p className="mt-1.5 text-xs text-subtitle">
            Captures header look, ranking-list style, final crop, default
            title animation, and audio mix levels — not your clips, header
            text, or uploaded audio files.
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Saved presets
        </label>
        {sortedPresets.length === 0 ? (
          <p className="rounded-geist border border-dashed border-unfocused-border-color bg-panel px-3 py-3 text-xs text-subtitle">
            No saved presets yet — style your project below, then save it
            here with a name.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sortedPresets.map((preset) => (
              <li
                key={preset.id}
                className="flex items-center justify-between gap-3 rounded-geist border border-unfocused-border-color bg-panel px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {preset.name}
                  </p>
                  <p className="font-mono-tabular text-[11px] text-subtitle">
                    Saved {formatSavedAt(preset.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    onClick={() => setPendingLoad(preset)}
                    secondary
                    compact
                  >
                    Load
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(preset)}
                    aria-label={`Delete preset "${preset.name}"`}
                    className="rounded-geist px-2 py-1.5 text-xs font-medium text-subtitle transition-colors duration-150 hover:text-geist-error"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={pendingOverwrite !== null}
        title={`Overwrite "${pendingOverwrite?.name}"?`}
        description="A preset with this name already exists. Saving will replace its style with your current settings."
        confirmLabel="Overwrite"
        onConfirm={() => {
          if (pendingOverwrite) {
            commitSave(pendingOverwrite.name, pendingOverwrite.id);
          }
          setPendingOverwrite(null);
        }}
        onCancel={() => setPendingOverwrite(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name}"?`}
        description="This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingDelete) {
            persist(presets.filter((p) => p.id !== pendingDelete.id));
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingLoad !== null}
        title={`Load "${pendingLoad?.name}"?`}
        description="This replaces your current header look, ranking-list style, final crop, default title animation, and audio mix levels. Your clips and their content aren't affected."
        confirmLabel="Load"
        onConfirm={() => {
          if (pendingLoad) {
            onLoadPreset(pendingLoad.style);
          }
          setPendingLoad(null);
        }}
        onCancel={() => setPendingLoad(null)}
      />
    </div>
  );
};