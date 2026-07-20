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

// A one-time title for the whole video (distinct from the per-clip ranking
// list in Phase 4). Stored as an array of {word, color} objects rather than
// a single string — this is the design decision that makes per-word
// coloring simple. Retrofitting this onto a plain string later would be a
// much bigger rewrite, so the array shape is used from the start even
// though phase 7 only needs to render it, not fully lay it out yet — Phase
// 8 will place it inside a scrim without needing to touch this schema.
export const HeaderWordSchema = z.object({
  word: z.string(),
  color: z.string(), // any valid CSS color, e.g. "#ffffff"
  // Forces a manual line break immediately after this word, regardless of
  // whether the browser's natural wrapping would have broken there. Lets
  // you deliberately control a 2-line layout (e.g. "Ranking Most Insane" /
  // "Colorful Curly Hair") instead of leaving it entirely up to wherever
  // the text happens to wrap at the current font size.
  lineBreakAfter: z.boolean(),
});

// "persistent" = visible for the entire video. "firstTwoSeconds" = only
// during the intro, then it disappears for the rest of the video.
export const HeaderDurationModeSchema = z.enum([
  "persistent",
  "firstTwoSeconds",
]);

// Phase 8 — which of the 2 backdrop treatments sits behind the header.
// "shade" darkens the top of the actual footage (a flat black bar, the
// original scrim design). "extendCanvas" grows the composition and puts
// the header on a solid black bar above the untouched footage instead —
// for source clips too short/cropped at the top for a shade to sit
// legibly over. Built in two parts: shade first (this phase), then
// extendCanvas — the enum already has both values so the schema doesn't
// need to change again when extendCanvas lands, but only "shade" is
// wired up to any rendering/UI for now.
export const HeaderBackdropModeSchema = z.enum(["shade", "extendCanvas"]);

export const HeaderSchema = z.object({
  words: z.array(HeaderWordSchema),
  durationMode: HeaderDurationModeSchema,
  // Applies to the whole header (it's one continuous title, not per-word
  // sized) — this is also what Phase 8's backdrop-height measurement
  // reads, so a resized header automatically resizes its own backdrop too.
  fontSize: z.number(),
  // Phase 8: which backdrop treatment is active.
  headerBackdropMode: HeaderBackdropModeSchema,
  // Phase 8, "shade" mode only: how dark the bar is (0 = fully
  // transparent, 1 = fully opaque black).
  headerBackdropShadeOpacity: z.number(),
  // Phase 8, "shade" mode only: manual extra height (px) added on top of
  // the auto-measured shade height, so a lengthy/multi-line header (or
  // just a stylistic preference) can push the bar further down than the
  // automatic measurement alone would. Defaults to 0 (pure auto height).
  headerBackdropShadeExtraHeight: z.number(),
});

export const CompositionProps = z.object({
  clips: z.array(ClipSchema),
  header: HeaderSchema,
});

export const defaultMyCompProps: z.infer<typeof CompositionProps> = {
  clips: [],
  header: {
    words: [],
    durationMode: "persistent",
    fontSize: 56,
    headerBackdropMode: "shade",
    // Matches the near-opaque flat black bar look of the reference
    // screenshot rather than a light/gradient scrim.
    headerBackdropShadeOpacity: 0.85,
    headerBackdropShadeExtraHeight: 0,
  },
};

// How many seconds the header stays on screen when durationMode is
// "firstTwoSeconds". Kept as a named constant (rather than a magic 2
// scattered around) since Phase 8 will likely need this same number to
// size/time the scrim underneath it.
export const HEADER_INTRO_SECONDS = 2;

// Changed from 1280x720 to vertical, matching the actual target format.
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;

// Fallback only — used before any clips exist. Real total duration is
// calculated from the clips array once they're uploaded (see Root.tsx).
export const DURATION_IN_FRAMES = 30;