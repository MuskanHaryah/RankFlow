import { z } from "zod";

export const COMP_NAME = "RankFlowComp";

export const ClipSchema = z.object({
  id: z.string(),
  // A URL the Remotion <Video> component can load: a blob: URL during the
  // in-browser preview (this step), or a real uploaded file path once we
  // wire up export in the next step.
  src: z.string(),
  order: z.number(), // playback sequence position (Phase 3)
  durationInFrames: z.number(),
  // Stays empty ("") if the person doesn't type one — the ranking list
  // overlay simply shows no title text for that slot until it's set.
  title: z.string(),
  // Which numbered badge slot (1..N) this clip is assigned to. Deliberately
  // independent from `order` — you can set which clip plays first while
  // separately controlling which rank number it's revealed as.
  rank: z.number(),
  badgeType: z.enum(["number", "emoji"]),
  // Only used when badgeType is "emoji"; ignored otherwise.
  badgeEmoji: z.string(),
  // Controls the entrance animation played when this clip's title first
  // reveals (i.e. the moment its clip starts playing). Does not affect the
  // dim transition when the clip finishes — that stays an instant color
  // change, this is purely the "appear" moment.
  animationStyle: z.enum([
    "fade",
    "slideUp",
    "pop",
    "typewriter",
    "glow",
    "bounceLetters",
  ]),
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