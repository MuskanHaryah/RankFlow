import { z } from "zod";
import {
  GlobalCropSchema,
  HeaderSchema,
  RankingListStyleSchema,
} from "../../types/constants";
import type { MusicState, VoiceOverClip } from "../components/AudioEditor";
import type { UploadedClip } from "../components/ClipUploader";
import type { HookState } from "../components/HookEditor";

/**
 * Phase 14 — what a saved project actually holds.
 *
 * Deliberately metadata-only, not a copy of the video/audio bytes
 * themselves: every clip, the music track, and every voice-over are
 * already uploaded to this app's own server (see /api/upload) the moment
 * they're added, with a durable `src` like "/uploads/xxxx.mp4" — the file
 * is already safely on disk independent of this browser tab. Duplicating
 * that into IndexedDB as well would just be the same bytes stored twice
 * for no benefit, so `file` is always stripped to `null` before saving
 * (see toSerializableClip/toSerializableMusic/toSerializableVoiceOver
 * below) — loading a project back just needs the metadata, since the
 * underlying files are already exactly where they were.
 */
export type ProjectState = {
  clips: UploadedClip[];
  header: z.infer<typeof HeaderSchema>;
  rankingListStyle: z.infer<typeof RankingListStyleSchema>;
  globalCrop: z.infer<typeof GlobalCropSchema>;
  music: MusicState;
  voiceOvers: VoiceOverClip[];
  originalAudioVolume: number;
  hook: HookState;
};

export type ProjectSnapshot = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // Purely a fast-to-render summary for the project list — never used for
  // anything else, so it staying slightly stale (e.g. after a clip is
  // renamed post-save-without-resave) is harmless.
  clipCount: number;
  totalDurationInFrames: number;
  state: ProjectState;
};

const DB_NAME = "rankflow-projects";
const DB_VERSION = 2;
const STORE_NAME = "projects";
// Autosave draft — deliberately a separate store from STORE_NAME, not a
// specially-named row inside it: a draft isn't something the person chose
// to save, so it must never show up in ProjectManager's "Saved projects"
// list. A single fixed key (DRAFT_KEY) means there's only ever one row —
// the draft always reflects "whatever's currently on screen right now",
// not a history of past sessions.
const DRAFT_STORE_NAME = "draft";
const DRAFT_KEY = "current";

// Every File object gets stripped to null (see ProjectState's own comment
// above) — everything else about a clip/track is plain, serializable
// data already.
const toSerializableClip = (clip: UploadedClip): UploadedClip => ({
  ...clip,
  file: null,
});

const toSerializableMusic = (music: MusicState): MusicState => ({
  ...music,
  file: null,
});

const toSerializableVoiceOver = (
  voiceOver: VoiceOverClip,
): VoiceOverClip => ({
  ...voiceOver,
  file: null,
});

const toSerializableHook = (hook: HookState): HookState => ({
  ...hook,
  file: null,
});

/**
 * Only ever called client-side (every exported function here is used from
 * "use client" components), but guarded anyway since this module could in
 * principle be imported somewhere that runs during SSR, where
 * `indexedDB` doesn't exist at all.
 */
const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error("IndexedDB isn't available in this environment (no window)."),
      );
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        // Out-of-line key (DRAFT_KEY, supplied at put()/get() time) rather
        // than a keyPath — there's no natural id field on a draft the way
        // there is on a named ProjectSnapshot, since it's not a record the
        // person is choosing to keep.
        db.createObjectStore(DRAFT_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open the projects database."));
  });
};

/**
 * Creates a brand new saved project (never overwrites an existing one —
 * see updateProject for that). `id` is generated here so the caller gets
 * it back immediately for e.g. highlighting the newly-saved row.
 */
export const saveNewProject = async (
  name: string,
  state: ProjectState,
): Promise<ProjectSnapshot> => {
  const db = await openDb();
  const now = Date.now();

  const snapshot: ProjectSnapshot = {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    clipCount: state.clips.length,
    totalDurationInFrames: state.clips.reduce(
      (sum, clip) => sum + (clip.durationInFrames ?? 0),
      0,
    ),
    state: {
      ...state,
      clips: state.clips.map(toSerializableClip),
      music: toSerializableMusic(state.music),
      voiceOvers: state.voiceOvers.map(toSerializableVoiceOver),
      hook: toSerializableHook(state.hook),
    },
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(snapshot);
    tx.oncomplete = () => resolve(snapshot);
    tx.onerror = () =>
      reject(tx.error ?? new Error("Failed to save the project."));
  });
};

/** Overwrites an already-saved project's state in place, bumping updatedAt. */
export const updateProject = async (
  id: string,
  name: string,
  state: ProjectState,
): Promise<ProjectSnapshot> => {
  const db = await openDb();

  const existing = await getProject(id);
  const snapshot: ProjectSnapshot = {
    id,
    name,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    clipCount: state.clips.length,
    totalDurationInFrames: state.clips.reduce(
      (sum, clip) => sum + (clip.durationInFrames ?? 0),
      0,
    ),
    state: {
      ...state,
      clips: state.clips.map(toSerializableClip),
      music: toSerializableMusic(state.music),
      voiceOvers: state.voiceOvers.map(toSerializableVoiceOver),
      hook: toSerializableHook(state.hook),
    },
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(snapshot);
    tx.oncomplete = () => resolve(snapshot);
    tx.onerror = () =>
      reject(tx.error ?? new Error("Failed to update the project."));
  });
};

/** Newest-first — most recently touched project is what you almost always want on top. */
export const listProjects = async (): Promise<ProjectSnapshot[]> => {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const results = (request.result as ProjectSnapshot[]).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      resolve(results);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to list saved projects."));
  });
};

export const getProject = async (
  id: string,
): Promise<ProjectSnapshot | null> => {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to load the project."));
  });
};

export const deleteProject = async (id: string): Promise<void> => {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("Failed to delete the project."));
  });
};

/**
 * Autosave — a running, unnamed draft of whatever's currently being
 * edited, separate from Phase 14's explicit named saves above. The
 * problem this solves: refreshing the browser (or an accidental tab
 * close) shouldn't lose an hour of unsaved work just because the person
 * never got around to clicking "Save" — that's a genuinely different use
 * case from choosing to keep a named project for later.
 *
 * Called on every meaningful change (debounced — see page.tsx), and
 * restored automatically once on mount. Cleared only by the Discard
 * button, never by a page refresh — refreshing should bring the draft
 * back, not erase it.
 */
export const saveDraft = async (state: ProjectState): Promise<void> => {
  const db = await openDb();
  const serializable: ProjectState = {
    ...state,
    clips: state.clips.map(toSerializableClip),
    music: toSerializableMusic(state.music),
    voiceOvers: state.voiceOvers.map(toSerializableVoiceOver),
    hook: toSerializableHook(state.hook),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
    tx.objectStore(DRAFT_STORE_NAME).put(serializable, DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("Failed to autosave the draft."));
  });
};

/** Returns null if nothing has been autosaved yet (or it was discarded). */
export const loadDraft = async (): Promise<ProjectState | null> => {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, "readonly");
    const request = tx.objectStore(DRAFT_STORE_NAME).get(DRAFT_KEY);
    request.onsuccess = () => resolve((request.result as ProjectState) ?? null);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to load the autosaved draft."));
  });
};

/** Called from the Discard button — this is the only thing that should ever clear the draft. */
export const clearDraft = async (): Promise<void> => {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
    tx.objectStore(DRAFT_STORE_NAME).delete(DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("Failed to clear the autosaved draft."));
  });
};