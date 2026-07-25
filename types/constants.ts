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

// Phase 10 — a single reaction-emoji sticker placed on a specific clip.
// Position and size are percentages (0-100) of the frame, not raw pixels
// — this is what keeps a sticker's placement correct regardless of the
// composition's actual resolution, and regardless of Phase 8's
// extendCanvas mode changing the canvas height (the sticker still renders
// relative to the video track's own area, which shifts as a whole). Timing
// is frame-relative to this clip's own Sequence — 0 is the instant this
// clip starts playing — the same convention every other per-clip timing
// value in this schema already uses, and what lets stickers render as a
// simple nested <Sequence> inside the clip's existing one.
export const StickerSchema = z.object({
  id: z.string(),
  emoji: z.string(),
  x: z.number(),
  y: z.number(),
  // Percentage of frame *width* — an emoji's glyph is roughly square, so
  // sizing off one dimension keeps it proportional without needing a
  // separate width/height.
  size: z.number(),
  startFrame: z.number(),
  endFrame: z.number(),
});

// Named so Phase 13's preset schema can reuse it without duplicating this
// list — see PresetStyleSchema below.
export const AnimationStyleSchema = z.enum([
  "fade",
  "slideUp",
  "pop",
  "typewriter",
  "glow",
  "bounceLetters",
]);

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
  animationStyle: AnimationStyleSchema,
  // Phase 10 — reaction emoji stickers placed on this specific clip.
  // Separate from badgeEmoji (Phase 4's rank badge) — these are freely
  // positioned decorations, not tied to the ranking list at all.
  stickers: z.array(StickerSchema),
  // Phase 11 — trim points, in frames into this clip's *original,
  // untrimmed* source file (not the overall video timeline — that's what
  // computeClipRanges' from/to are for). trimStartFrame defaults to 0 and
  // trimEndFrame defaults to sourceDurationInFrames, i.e. "no trim" until
  // the person drags a handle. `durationInFrames` above is kept in sync
  // by the editor as trimEndFrame - trimStartFrame, so every existing
  // reader of durationInFrames (calculateMetadata, computeClipRanges, the
  // page's own totals) keeps working completely unchanged — trimming
  // just changes what that number *is*, not who reads it.
  trimStartFrame: z.number(),
  trimEndFrame: z.number(),
  // Phase 11 — the clip's full, untrimmed length in frames, detected once
  // on upload. This is what the trim scrubber's track spans and what
  // trimEndFrame is clamped against — distinct from durationInFrames (the
  // currently-playing, possibly-trimmed length).
  sourceDurationInFrames: z.number(),
  // Phase 11 — native pixel resolution, detected once on upload (read
  // straight off the browser's <video> element, no ffmpeg probe needed).
  // Used purely as a rendering decision: footage that isn't close to
  // vertical gets a blurred-and-scaled copy of itself as a background
  // (see isClipVertical below and Main.tsx's ClipVideo) rather than being
  // stretched or cropped. The source file itself is never modified.
  sourceWidth: z.number(),
  sourceHeight: z.number(),
  // Phase 11 (extended, redesigned) — independent 4-directional crop.
  // Each is a percent (0-45) of the frame cut away from that specific
  // edge, so the person can crop more off the left than the right, more
  // off the top than the bottom, etc. — a genuinely asymmetric crop, not
  // a single "zoom into a centered box" value applied the same to every
  // side. 0/0/0/0 (the default) means "no crop" — Main.tsx's ClipVideo
  // falls back to its automatic behavior (plain cover for vertical
  // footage, blurred-pad for non-vertical). Any inset above 0 means the
  // person has taken over framing manually, and that always wins over the
  // automatic pad — even for a non-vertical clip.
  cropInsetTop: z.number(),
  cropInsetBottom: z.number(),
  cropInsetLeft: z.number(),
  cropInsetRight: z.number(),
  // Rotation in degrees (-180 to 180), for straightening a tilted shot or
  // reorienting footage that was recorded sideways/upside down. Whenever
  // this is non-zero, an additional scale is applied automatically (see
  // getRotationCoverScale below) so the rotated content still fully
  // covers the frame — no blank corners to crop around.
  cropRotationDeg: z.number(),
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

// Phase 12 — one background music track for the whole video. src === null
// means no music has been added yet, in which case Main.tsx's MusicTrack
// renders nothing at all.
export const MusicSchema = z.object({
  src: z.string().nullable(),
  durationInFrames: z.number(),
  volume: z.number(), // overall/base level, 0-1
  // Multiplier applied to `volume` for however much of the video is
  // "during some clip's audio" — see Main.tsx's MusicTrack for why this
  // collapses to a constant for the video's whole length in this app
  // specifically (clips play back-to-back with no gaps today), and why
  // it's still computed as a genuine per-frame check rather than hardcoded
  // to a flat value.
  duckLevel: z.number(),
});

export const defaultMusic: z.infer<typeof MusicSchema> = {
  src: null,
  durationInFrames: 0,
  volume: 0.5,
  duckLevel: 0.2, // "drops to 20% during any clip audio" — Phase 12's own wording
};

// Phase 12 — a single voice-over/narration clip layered on top of the
// composition, independent from the video clips' own audio. Placed on the
// *absolute* video timeline (not clip-relative like Phase 10's stickers)
// since audio timing is naturally thought of against the whole finished
// video, not against one specific clip.
export const VoiceOverSchema = z.object({
  id: z.string(),
  src: z.string(),
  // Where in the finished video's timeline this starts playing. Its own
  // length comes from the audio file's actual duration
  // (durationInFrames below) — there's no separate "how long to play it"
  // control, the same way a video clip's own played length isn't
  // separately configurable from its trim points.
  startFrame: z.number(),
  durationInFrames: z.number(),
  // 0-2 (see MAX_VOICE_OVER_VOLUME). Unlike a plain HTML5 <audio> element
  // (capped at 1, i.e. never
  // louder than the source recording itself), Remotion's volume is applied
  // via a Web Audio gain node, so values above 1 genuinely amplify beyond
  // the recording's own loudness — needed because a TTS/recorded
  // voice-over is very often quieter than a video clip's own audio, and
  // capping at 1 made it impossible to ever fully close that gap.
  volume: z.number(),
  // The window (absolute timeline frames) during which every clip's
  // *original* audio is ducked to make room for this voice-over. Kept
  // independent from startFrame/durationInFrames above — the ducked
  // window might deliberately start a little before the voice-over's own
  // first word, or extend a little past its last one.
  duckOriginalFrom: z.number(),
  duckOriginalTo: z.number(),
  // How much of the original clip audio survives during the duck window:
  // 0 = fully silent, 1 = no ducking effect at all. Kept per-voice-over
  // (not one global number) so a quiet aside and a loud callout can duck
  // the original audio by different amounts.
  duckOriginalLevel: z.number(),
});

// Starts pre-boosted rather than at exactly 1 (the recording's own level) —
// a TTS/recorded voice-over is, in practice, almost always quieter than a
// video clip's original audio, so defaulting to "no boost at all" meant
// nearly everyone had to immediately go find and raise this slider by
// hand. Still fully adjustable per voice-over from 0 up to
// MAX_VOICE_OVER_VOLUME.
export const VOICE_OVER_DEFAULT_VOLUME = 1.6;
export const MAX_VOICE_OVER_VOLUME = 2;
// Original audio nearly silenced under narration by default — enough that
// the voice-over is clearly the thing to listen to, without going fully
// silent (0), which would read as a hard cut rather than a duck.
export const VOICE_OVER_DEFAULT_DUCK_LEVEL = 0.15;
// How much of the video (in seconds) a freshly-added voice-over's duck
// window defaults to spanning, centered on wherever it's placed — a
// starting point the person then drags/types to match their actual
// narration length.
export const VOICE_OVER_DEFAULT_DUCK_WINDOW_SECONDS = 4;

// Phase 12 (extended) — a single master volume for every clip's original
// audio, applied uniformly across the whole video (not configurable per
// clip — that's deliberate, per the request this was added for: one
// control for "how loud is my footage's own sound", separate from music
// and voice-over levels). Defaults to 1 (unchanged from how clips always
// sounded before this existed). Allowed above 1, same reasoning as
// voice-over volume: source footage audio is very often quieter than
// you'd want, and capping at 1 would make it impossible to boost.
export const DEFAULT_ORIGINAL_AUDIO_VOLUME = 1;
export const MAX_ORIGINAL_AUDIO_VOLUME = 2;

// Phase 11 (extended) — crops the *final composited video* (every clip,
// the ranking list, the header — everything), as opposed to ClipSchema's
// crop fields which only affect one clip's own footage. Same 4-directional
// independent-edge model as the per-clip crop, no rotation option (the
// whole canvas being tilted isn't a real use case the way straightening
// one clip is).
export const GlobalCropSchema = z.object({
  top: z.number(),
  bottom: z.number(),
  left: z.number(),
  right: z.number(),
});

// Phase 13 — a named, reusable bundle of *style* settings: every
// color/font/border/spacing/backdrop/crop/mix preference a person has
// dialed in, deliberately excluding anything that's this-specific-video
// *content* rather than a reusable look — the actual clips, the header's
// literal wording, and any uploaded music/voice-over file. Saved to (and
// loaded from) localStorage as a named Preset; never sent to the render
// pipeline directly, which is why this lives as its own schema rather than
// folded into CompositionProps.
export const PresetStyleSchema = z.object({
  // Every header field except `words` (the literal title text) — a
  // preset should carry "how the header looks," not what it says.
  // Deriving this via .omit() keeps it in lockstep automatically if
  // HeaderSchema ever grows another style field.
  header: HeaderSchema.omit({ words: true }),
  rankingListStyle: RankingListStyleSchema,
  globalCrop: GlobalCropSchema,
  // The animation a saved preset "remembers" as its house style. Loading a
  // preset applies this to every clip currently in the project — the same
  // one-off bulk-set the existing "Apply to all" control already performs,
  // not a new per-clip mechanic.
  defaultAnimationStyle: AnimationStyleSchema,
  // Audio *mix* levels, not the uploaded files themselves — a preset never
  // carries someone else's music/voice-over file as content, but "music
  // sits at 50% and ducks to 20%" is a genuine reusable style choice.
  musicVolume: z.number(),
  musicDuckLevel: z.number(),
  originalAudioVolume: z.number(),
});

export const PresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(), // Date.now() at save time
  style: PresetStyleSchema,
});

export const PRESETS_STORAGE_KEY = "rankflow-presets";

export const CompositionProps = z.object({
  clips: z.array(ClipSchema),
  header: HeaderSchema,
  rankingListStyle: RankingListStyleSchema,
  music: MusicSchema,
  voiceOvers: z.array(VoiceOverSchema),
  originalAudioVolume: z.number(),
  globalCrop: GlobalCropSchema,
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
  music: defaultMusic,
  voiceOvers: [],
  originalAudioVolume: DEFAULT_ORIGINAL_AUDIO_VOLUME,
  globalCrop: { top: 0, bottom: 0, left: 0, right: 0 },
};

// How many seconds the header stays on screen when durationMode is
// "firstTwoSeconds". Kept as a named constant (rather than a magic 2
// scattered around) since Phase 8 will likely need this same number to
// size/time the scrim underneath it.
export const HEADER_INTRO_SECONDS = 2;

// Phase 10 — starting point for a newly click-placed sticker, before any
// manual fine-tuning. A fairly large reaction-emoji size and a short dwell
// time; both are easy to nudge from rather than meant to be final.
export const STICKER_DEFAULT_SIZE_PERCENT = 14;
export const STICKER_MIN_SIZE_PERCENT = 4;
export const STICKER_MAX_SIZE_PERCENT = 40;
export const STICKER_DEFAULT_DURATION_SECONDS = 1.5;

// Changed from 1280x720 to vertical, matching the actual target format.
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;

// Phase 11 — how far off exactly-9:16 a clip's aspect ratio is allowed to
// be before Main.tsx treats it as "not vertical" and switches on the
// blurred-pad background. A little slack — rather than requiring an exact
// pixel match — is what lets ordinary vertical phone footage (which is
// almost never *exactly* 1080x1920) through without unnecessary padding.
// Mirrored (deliberately, not imported — see ClipUploader.tsx's own FPS
// constant for the same reasoning) as a local constant in
// VerticalityCheck.tsx, which needs the same threshold for the upload UI's
// own vertical/padded messaging without pulling in the render pipeline.
export const VERTICAL_ASPECT_RATIO = VIDEO_WIDTH / VIDEO_HEIGHT; // 0.5625, i.e. 9:16
export const VERTICAL_ASPECT_RATIO_TOLERANCE = 0.03;

export const isClipVertical = (width: number, height: number): boolean => {
  if (width <= 0 || height <= 0) {
    // Resolution not known yet — don't pad on a guess.
    return true;
  }
  const ratio = width / height;
  return (
    Math.abs(ratio - VERTICAL_ASPECT_RATIO) <= VERTICAL_ASPECT_RATIO_TOLERANCE
  );
};

// Phase 11 (extended, redesigned) — how far any single edge can be cropped
// in, as a percent of the frame. Individual editors additionally clamp a
// pair of opposite edges (e.g. left + right) to never exceed 90 combined,
// so at least 10% of the frame always remains rather than collapsing to
// zero width/height.
export const CLIP_CROP_MAX_INSET_PERCENT = 45;

/**
 * How much extra uniform scale a clip needs, on top of its own zoom, so
 * that rotating it by `rotationDeg` still fully covers a frame of the
 * given aspect ratio (width/height) — i.e. no blank corners peeking
 * through at the frame's edges. This is the standard "rotate then
 * re-cover" formula: a same-aspect rectangle rotated by θ needs scale
 * max(cosθ + sinθ/aspect, aspect·sinθ + cosθ) to still cover its original
 * bounding box. At rotationDeg = 0 this is exactly 1 (no extra scale).
 *
 * Duplicated (deliberately — see ClipUploader.tsx's own FPS constant for
 * the same reasoning) as a local copy in ClipCropBox.tsx, which needs the
 * identical formula to render a live preview that actually matches what
 * Main.tsx will produce, without importing the render pipeline into the
 * upload UI.
 */
export const getRotationCoverScale = (
  rotationDeg: number,
  aspect: number = VIDEO_WIDTH / VIDEO_HEIGHT,
): number => {
  if (rotationDeg === 0) {
    return 1;
  }
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const scaleForWidth = cos + sin / aspect;
  const scaleForHeight = aspect * sin + cos;
  return Math.max(scaleForWidth, scaleForHeight);
};

export type CropTransform = {
  scale: number;
  translateXPercent: number;
  translateYPercent: number;
};

/**
 * Computes the scale + translate for an independently 4-directional-cropped
 * rectangle — insetTop/Bottom/Left/Right, each a percent (0-45ish) of the
 * frame cut away from that specific edge — so the remaining rectangle fills
 * the frame with no distortion, optionally combined with a rotation.
 *
 * The crop rectangle is scaled *uniformly* (the same factor on both axes,
 * never stretched) — whichever axis needs more scale-up to fully cover the
 * frame determines the scale, so the less-constrained axis ends up showing
 * a little more than its raw inset number implies. This is the same
 * tradeoff any crop tool makes when fitting an arbitrary rectangle into a
 * fixed-aspect output: honest independent-edge control, without ever
 * distorting the footage to force an exact fit.
 *
 * Duplicated as a local copy in ClipCropBox.tsx (same reasoning as
 * getRotationCoverScale above) so the upload-time crop preview matches
 * this exactly without importing the render pipeline.
 */
export const computeInsetCropTransform = (
  insetTop: number,
  insetBottom: number,
  insetLeft: number,
  insetRight: number,
  rotationDeg: number = 0,
  aspect: number = VIDEO_WIDTH / VIDEO_HEIGHT,
): CropTransform => {
  const cropWidthPercent = Math.max(1, 100 - insetLeft - insetRight);
  const cropHeightPercent = Math.max(1, 100 - insetTop - insetBottom);
  const cropCenterX = insetLeft + cropWidthPercent / 2;
  const cropCenterY = insetTop + cropHeightPercent / 2;
  const cropScale = Math.max(
    100 / cropWidthPercent,
    100 / cropHeightPercent,
  );
  const rotationCoverScale = getRotationCoverScale(rotationDeg, aspect);
  const scale = cropScale * rotationCoverScale;

  // The translate needed to re-center the crop rectangle's own center at
  // the frame's center, expressed in the element's own percent-of-box
  // units (matching how CSS resolves percentage `translate` values) —
  // derived by requiring the crop-rect-center to map back to (50, 50)
  // under the combined scale+rotate+translate transform. When rotationDeg
  // is 0, this reduces to a plain scale*(center - cropCenter) offset.
  const dx0 = scale * (50 - cropCenterX);
  const dy0 = scale * (50 - cropCenterY);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return {
    scale,
    translateXPercent: dx0 * cos - dy0 * sin,
    translateYPercent: dx0 * sin + dy0 * cos,
  };
};

// Fallback only — used before any clips exist. Real total duration is
// calculated from the clips array once they're uploaded (see Root.tsx).
export const DURATION_IN_FRAMES = 30;