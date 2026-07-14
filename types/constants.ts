import { z } from "zod";

export const COMP_NAME = "RankFlowComp";

export const ClipSchema = z.object({
  id: z.string(),
  // A URL the Remotion <Video> component can load: a blob: URL during the
  // in-browser preview (this step), or a real uploaded file path once we
  // wire up export in the next step.
  src: z.string(),
  order: z.number(),
  durationInFrames: z.number(),
});

export const CompositionProps = z.object({
  clips: z.array(ClipSchema),
});

export const defaultMyCompProps: z.infer<typeof CompositionProps> = {
  clips: [],
};

// Changed from 1280x720 to vertical, matching the actual target format.
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;

// Fallback only — used before any clips exist. Real total duration is
// calculated from the clips array once they're uploaded (see Root.tsx).
export const DURATION_IN_FRAMES = 30;