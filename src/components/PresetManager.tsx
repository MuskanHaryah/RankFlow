"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { PresetStyleSchema } from "../../types/constants";
import { loadPresets, Preset, savePresetsToStorage } from "../lib/presets";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Input } from "./Input";

export type PresetStyle = z.infer<typeof PresetStyleSchema>;

const formatSavedAt = (createdAt: number): string => {
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/**
 * Phase 13 (corrected) — save the current project's full style (header,
 * including its exact wording and per-word colors; ranking-list colors/
 * fonts/borders/spacing; and each rank's badge/title styling and
 * animation) as a named preset, and load any saved preset back onto
 * whatever project is currently open.
 *
 * Deliberately does NOT capture: the actual clip footage, any clip's
 * crop/rotation (that's specific to that source video, not a reusable
 * look), the final-video crop, uploaded music/voice-over files or their
 * mix levels, or any rank's title *text* — see PresetStyleSchema's own
 * comment in constants.ts for the full reasoning.
 *
 * `currentStyle` already has everything needed to save — including a
 * live snapshot of every currently-uploaded clip's rank/badge/title
 * style — so there's no separate save-time-only field to collect here
 * the way an earlier version of this component needed for animation.
 *
 * Presets list starts empty and is only populated from localStorage inside
 * an effect (not during the initial render) — this keeps the server-
 * rendered and first-client-render HTML identical (both show the empty
 * state), avoiding any hydration mismatch from reading a browser-only API
 * during render.
 */
export const PresetManager: React.FC<{
  currentStyle: PresetStyle;
  onLoadPreset: (style: PresetStyle) => void;
}> = ({ currentStyle, onLoadPreset }) => {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newPresetName, setNewPresetName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
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
        style: currentStyle,
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
    [currentStyle],
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
            Captures your header (its exact text and colors included),
            ranking-list style, and each rank's badge/title styling and
            animation — not your clips&apos; footage, crop, or uploaded
            audio.
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
        description="This replaces your current header (including its text and colors) and ranking-list style, and re-applies each rank's saved badge/title styling to whichever clips currently hold those ranks. Your clips' footage, crop, and audio aren't affected. Clips uploaded after loading won't get a rank's saved style automatically — load this preset again once they're in if you want it applied to them too."
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