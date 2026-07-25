import { z } from "zod";
import { PresetSchema, PRESETS_STORAGE_KEY } from "../../types/constants";

export type Preset = z.infer<typeof PresetSchema>;

const isBrowser = () => typeof window !== "undefined";

/**
 * Reads every saved preset from localStorage. Deliberately fails soft
 * (empty array) rather than throwing — a corrupted/outdated localStorage
 * value (e.g. from an older version of this schema) should never crash the
 * whole page on load; it should just mean "no presets available yet,"
 * which the person can recover from by simply saving a new one.
 */
export const loadPresets = (): Preset[] => {
  if (!isBrowser()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    const result = z.array(PresetSchema).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
};

export const savePresetsToStorage = (presets: Preset[]): void => {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
};