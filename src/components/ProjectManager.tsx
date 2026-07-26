"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteProject,
  listProjects,
  ProjectSnapshot,
  ProjectState,
  saveNewProject,
  updateProject,
} from "../lib/projectStorage";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Input } from "./Input";

const FPS = 30;

const formatSavedAt = (updatedAt: number): string => {
  return new Date(updatedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDuration = (durationInFrames: number): string => {
  const totalSeconds = Math.round(durationInFrames / FPS);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

/**
 * Phase 14 — pause a whole project (every clip with its order/rank/trim/
 * crop/badges/title, header, ranking-list style, final crop, music,
 * voice-overs, master original-audio volume — everything) and resume it
 * later, including after closing the tab entirely.
 *
 * Stored in IndexedDB rather than localStorage (localStorage's ~5-10MB
 * limit doesn't leave much room once a project has several clips' worth
 * of metadata, stickers, and per-clip style overrides — IndexedDB has no
 * such practical ceiling). The actual video/audio *files* are NOT
 * duplicated into IndexedDB — see projectStorage.ts's own comment on
 * ProjectState for why that's the correct call for this app specifically:
 * every upload already lives durably on the server the moment it
 * finishes, so only the metadata (including that server URL) needs to be
 * saved here.
 *
 * `getCurrentProjectState` is a getter function rather than a plain prop
 * so page.tsx doesn't have to assemble a full project snapshot on every
 * render just because this rarely-used panel exists — same pattern
 * AudioEditor already uses for getCurrentPreviewSeconds.
 */
export const ProjectManager: React.FC<{
  getCurrentProjectState: () => ProjectState;
  onLoadProject: (state: ProjectState) => void;
}> = ({ getCurrentProjectState, onLoadProject }) => {
  const [projects, setProjects] = useState<ProjectSnapshot[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [newProjectName, setNewProjectName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingOverwrite, setPendingOverwrite] =
    useState<ProjectSnapshot | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSnapshot | null>(
    null,
  );
  const [pendingLoad, setPendingLoad] = useState<ProjectSnapshot | null>(
    null,
  );

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      const results = await listProjects();
      setProjects(results);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Only reads from IndexedDB inside an effect (not during render) — same
  // hydration-safety reasoning as PresetManager's own equivalent effect:
  // server render and first client render both show the empty/loading
  // state, so there's nothing to mismatch.
  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const commitSave = useCallback(
    async (name: string, overwriteId?: string) => {
      setIsSaving(true);
      setSaveError(null);
      try {
        const state = getCurrentProjectState();
        if (overwriteId) {
          await updateProject(overwriteId, name, state);
        } else {
          await saveNewProject(name, state);
        }
        setNewProjectName("");
        setNameError(null);
        await refreshList();
      } catch (err) {
        console.error(err);
        setSaveError(
          "Couldn't save the project — your browser's storage may be full or blocking IndexedDB.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [getCurrentProjectState, refreshList],
  );

  const handleSaveClick = useCallback(() => {
    const trimmed = newProjectName.trim();
    if (trimmed.length === 0) {
      setNameError("Give this project a name first.");
      return;
    }
    const existing = projects.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      setPendingOverwrite(existing);
      return;
    }
    commitSave(trimmed);
  }, [newProjectName, projects, commitSave]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteProject(id);
        await refreshList();
      } catch (err) {
        console.error(err);
      }
    },
    [refreshList],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Save current project
        </label>
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              text={newProjectName}
              setText={(value) => {
                setNewProjectName(value);
                setNameError(null);
                setSaveError(null);
              }}
            />
          </div>
          <Button onClick={handleSaveClick} disabled={isSaving} compact>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
        {nameError ? (
          <p className="mt-1.5 text-xs text-geist-error">{nameError}</p>
        ) : saveError ? (
          <p className="mt-1.5 text-xs text-geist-error">{saveError}</p>
        ) : (
          <p className="mt-1.5 text-xs text-subtitle">
            Saves everything — clips (order, rank, trim, crop, badges,
            titles, stickers), header, ranking-list style, music,
            voice-overs, and the original-audio volume. Come back anytime,
            even after closing this tab.
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Saved projects
        </label>
        {loadingList ? (
          <p className="rounded-geist border border-dashed border-unfocused-border-color bg-panel px-3 py-3 text-xs text-subtitle">
            Loading saved projects…
          </p>
        ) : projects.length === 0 ? (
          <p className="rounded-geist border border-dashed border-unfocused-border-color bg-panel px-3 py-3 text-xs text-subtitle">
            No saved projects yet — build something below, then save it
            here with a name.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex items-center justify-between gap-3 rounded-geist border border-unfocused-border-color bg-panel px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {project.name}
                  </p>
                  <p className="font-mono-tabular text-[11px] text-subtitle">
                    {project.clipCount} clip
                    {project.clipCount === 1 ? "" : "s"} ·{" "}
                    {formatDuration(project.totalDurationInFrames)} · Saved{" "}
                    {formatSavedAt(project.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    onClick={() => setPendingLoad(project)}
                    secondary
                    compact
                  >
                    Load
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(project)}
                    aria-label={`Delete project "${project.name}"`}
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
        description="A project with this name already exists. Saving will replace it with your current project."
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
        description="This can't be undone. The clips' actual video files stay on the server either way — this only removes the saved project entry."
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingDelete) {
            handleDelete(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingLoad !== null}
        title={`Load "${pendingLoad?.name}"?`}
        description="This replaces everything in your current project — clips, header, style, and audio — with the saved version. Anything you haven't saved in the current project will be lost."
        confirmLabel="Load"
        onConfirm={() => {
          if (pendingLoad) {
            onLoadProject(pendingLoad.state);
          }
          setPendingLoad(null);
        }}
        onCancel={() => setPendingLoad(null)}
      />
    </div>
  );
};