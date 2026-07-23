import { z } from "zod";

export const COMP_NAME = "RankFlowComp";

// Phase 9 — one bundle of overridable style properties, shared by both the
// badge/number and the title text. null on a clip means "inherit every one
// of these from the project-level defaults below"; a present object
// overrides ALL of them together for that one badge or title. Bundling
// them (instead of 6 separate override toggles per element per clip) is a
// deliberate simplification — see the guide's own warning about too many
// independently-configurable per-clip knobs. Turning an override on in the
// UI should pre-fill it with the current global values, so the person is
// tweaking from a sensible starting point rather than blank fields.
export const RankStyleOverrideSchema = z
  .object({
    color: z.string(),
    fontFamily: z.string(),
    fontWeight: z.number(),
    // "None" is `borderEnabled: false` — not just borderWidth: 0 — so a
    // person picking "no border" doesn't leave a stray borderColor/width
    // sitting around implying one is still active.
    borderEnabled: z.boolean(),
    borderColor: z.string(),
    borderWidth: z.number(),
  })
  .nullable();

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
  // Phase 9: null = this badge uses the project-level badge defaults
  // below. A present object overrides color/font/border for just this
  // badge — e.g. rank 1 in gold while every other rank stays the shared
  // default look.
  badgeStyleOverride: RankStyleOverrideSchema,
  // Phase 9: same idea as badgeStyleOverride, but for this clip's title
  // text instead. Deliberately a separate override from the badge's — a
  // customized number color/border says nothing about the title, and vice
  // versa. Note: the title's color here is its *base* color; the existing
  // bright-when-playing/dimmed-otherwise effect is layered on top as
  // opacity, not baked into this color, so the two don't fight each other.
  titleStyleOverride: RankStyleOverrideSchema,
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
// legibly over. Both modes are now wired up to rendering/UI (part 1:
// shade, part 2: extendCanvas).
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
  // Phase 8, "extendCanvas" mode only: manual extra height (px) added on
  // top of the auto-measured black-bar height, same idea as the shade
  // slider above but for the grown-canvas bar instead. Defaults to 0
  // (pure auto height).
  headerBackdropExtendCanvasExtraHeight: z.number(),
  // Moves the header up/down from its default top-anchored position —
  // same "nudge" pattern as the ranking list's verticalOffset below.
  // Purely a visual transform applied after layout: the backdrop (shade
  // bar / extendCanvas bar) height is still measured from the header's
  // actual text/font size, not from this offset, so pushing the header
  // far enough can move it outside its own backdrop — same tradeoff the
  // ranking list's own verticalOffset already has.
  verticalOffset: z.number(),
});

// Phase 9 — project-level ranking-list visual defaults. Every clip uses
// these unless it sets its own badgeStyleOverride / titleStyleOverride
// (see ClipSchema above).
export const RankingListStyleSchema = z.object({
  // Multiplies every size value in the ranking list — badge font size,
  // title font size, badge minimum width, and the gaps between rows/items
  // — together, so resizing "the whole ranking table" moves badge and
  // title as one proportioned unit. badgeScale/titleScale below then let
  // badge size and title size be fine-tuned independently on top of this,
  // e.g. making numbers noticeably bigger than their titles without
  // affecting overall list size.
  scale: z.number(),
  badgeScale: z.number(),
  titleScale: z.number(),
  // Moves the entire list up/down from its default anchored position.
  // Negative = up, positive = down. A small step size in the UI (rather
  // than a coarse slider) is what makes this feel like "nudging" rather
  // than jumping to a new spot.
  verticalOffset: z.number(),
  // Space between each rank row (badge + title together, as one block) and
  // the next rank's row — a flexbox `gap`, so it only ever adds space
  // *between* rows, never above the first rank or below the last one.
  // Independent from `scale`; still multiplied by it at render time so
  // "resize the whole list" continues to move spacing proportionally too.
  rowGap: z.number(),
  // Space between a single rank's badge (number/emoji) and its title text,
  // within one row. Independent from `scale` for the same reason as
  // rowGap above.
  itemGap: z.number(),

  badgeColor: z.string(),
  badgeFontFamily: z.string(),
  badgeFontWeight: z.number(),
  badgeBorderEnabled: z.boolean(),
  badgeBorderColor: z.string(),
  badgeBorderWidth: z.number(),

  // titleColor is a *base* color — the existing bright-when-playing /
  // dimmed-otherwise behavior is layered on top as opacity at render time,
  // not baked into this value, so choosing a title color doesn't remove
  // the play-state effect.
  titleColor: z.string(),
  titleFontFamily: z.string(),
  titleFontWeight: z.number(),
  titleBorderEnabled: z.boolean(),
  titleBorderColor: z.string(),
  titleBorderWidth: z.number(),
});

export const defaultRankingListStyle: z.infer<typeof RankingListStyleSchema> =
  {
    scale: 1,
    badgeScale: 1,
    titleScale: 1,
    verticalOffset: 0,
    // Matches the values Main.tsx used to hardcode as BASE_ROW_GAP /
    // BASE_ITEM_GAP, now exposed as real defaults instead of constants.
    rowGap: 18,
    itemGap: 16,

    badgeColor: "#ffffff",
    badgeFontFamily: "inherit",
    badgeFontWeight: 900,
    // "Default should be black and tiny."
    badgeBorderEnabled: true,
    badgeBorderColor: "#000000",
    badgeBorderWidth: 2,

    titleColor: "#ffffff",
    titleFontFamily: "inherit",
    titleFontWeight: 700,
    titleBorderEnabled: true,
    titleBorderColor: "#000000",
    titleBorderWidth: 2,
  };

export const CompositionProps = z.object({
  clips: z.array(ClipSchema),
  header: HeaderSchema,
  rankingListStyle: RankingListStyleSchema,
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
    headerBackdropExtendCanvasExtraHeight: 0,
    verticalOffset: 0,
  },
  rankingListStyle: defaultRankingListStyle,
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