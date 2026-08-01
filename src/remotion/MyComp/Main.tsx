import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";
import {
  CompositionProps,
  HEADER_INTRO_SECONDS,
  HOOK_INTRO_DURATION_IN_FRAMES,
  computeInsetCropTransform,
  isClipVertical,
} from "../../../types/constants";
import {
  HEADER_HORIZONTAL_PADDING,
  HEADER_LINE_HEIGHT,
  HEADER_TOP_PADDING,
  getExtendCanvasExtraHeight,
  getShadeBackdropHeight,
} from "./headerBackdrop";

export type Clip = z.infer<typeof CompositionProps>["clips"][number];
export type ClipRange = Clip & { from: number; to: number };
export type Sticker = Clip["stickers"][number];
export type Music = z.infer<typeof CompositionProps>["music"];
export type VoiceOver = z.infer<typeof CompositionProps>["voiceOvers"][number];
export type Hook = z.infer<typeof CompositionProps>["hook"];
type HeaderProps = z.infer<typeof CompositionProps>["header"];
type RankingListStyleProps = z.infer<typeof CompositionProps>["rankingListStyle"];

// Base sizes at scale = 1 / badgeScale = 1 / titleScale = 1. Everything the
// ranking list draws is derived from these three, so "resize the whole
// table" (scale), "resize just the numbers" (badgeScale), and "resize just
// the titles" (titleScale) all move a genuinely shared layout rather than
// three independently-drifting copies of it.
const BASE_BADGE_FONT_SIZE = 48;
const BASE_BADGE_MIN_WIDTH = 60;
const BASE_TITLE_FONT_SIZE = 42;

type ResolvedRankElementStyle = {
  color: string;
  fontFamily: string;
  fontWeight: number;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
};

/**
 * A clip's badgeStyleOverride, if set, otherwise the project-level badge
 * defaults. Called once per clip per render — cheap, and keeps "what
 * style does this badge actually use" in one place rather than inlined at
 * every point badge styling is read.
 */
const resolveBadgeStyle = (
  clip: Clip,
  listStyle: RankingListStyleProps,
): ResolvedRankElementStyle =>
  clip.badgeStyleOverride ?? {
    color: listStyle.badgeColor,
    fontFamily: listStyle.badgeFontFamily,
    fontWeight: listStyle.badgeFontWeight,
    borderEnabled: listStyle.badgeBorderEnabled,
    borderColor: listStyle.badgeBorderColor,
    borderWidth: listStyle.badgeBorderWidth,
  };

/** Same idea as resolveBadgeStyle, for the title text instead. */
const resolveTitleStyle = (
  clip: Clip,
  listStyle: RankingListStyleProps,
): ResolvedRankElementStyle =>
  clip.titleStyleOverride ?? {
    color: listStyle.titleColor,
    fontFamily: listStyle.titleFontFamily,
    fontWeight: listStyle.titleFontWeight,
    borderEnabled: listStyle.titleBorderEnabled,
    borderColor: listStyle.titleBorderColor,
    borderWidth: listStyle.titleBorderWidth,
  };

/**
 * Renders the border as a stroke drawn directly on the glyph's own outline
 * (`-webkit-text-stroke`) rather than a background shape — there's no
 * colored circle/box behind the number or title, just a thin outline on
 * the letterforms themselves. `paintOrder: "stroke fill"` makes Chromium
 * paint the stroke first and the fill color on top, so the interior of
 * each glyph still shows the assigned text color cleanly instead of the
 * stroke color bleeding inward over a thin glyph. Returns {} (no stroke at
 * all) when the border is turned off — deliberately not just width: 0, so
 * "None" can't leave a stray color/width implying a border is still active.
 */
const textStrokeStyle = (
  resolved: ResolvedRankElementStyle,
): React.CSSProperties =>
  resolved.borderEnabled
    ? {
        WebkitTextStroke: `${resolved.borderWidth}px ${resolved.borderColor}`,
        paintOrder: "stroke fill",
      }
    : {};

// Matches the broad "is this an emoji" Unicode property plus the
// auxiliary code points that combine with it into multi-part emoji:
// variation selector (FE0F), zero-width joiner (200D — family/profession
// emoji), Fitzpatrick skin-tone modifiers, and regional-indicator letters
// (flag emoji, which are pairs of these). Used to test a single grapheme
// cluster (see `graphemes` below), not a whole string.
//
// Built via the RegExp constructor rather than a /u-flagged literal —
// this project's tsconfig targets ES5, and TypeScript rejects the `u`
// flag on regex *literals* for that target even though every actual
// runtime this code runs on (browsers, and the headless Chrome Remotion
// renders with) fully supports it. A constructed RegExp isn't a literal,
// so it isn't subject to that compile-time restriction.
const EMOJI_TEST_REGEX = new RegExp(
  "\\p{Extended_Pictographic}|\\p{Regional_Indicator}|\\u200D|\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}]",
  "u",
);

/**
 * Splits a string into Unicode grapheme clusters — the "characters" a
 * person actually perceives — correctly keeping multi-codepoint emoji
 * (flags, ZWJ family/skin-tone sequences, or a single emoji above the
 * Basic Multilingual Plane, which is most modern emoji) together as one
 * unit. Plain `text.split("")` breaks on individual UTF-16 code units,
 * which corrupts any such emoji: a lone surrogate half renders as a
 * broken tofu glyph. This was the actual cause of emoji appearing as
 * broken boxes in the "Bounce letters" and typewriter reveal styles
 * specifically — those are the two animations that slice the title
 * character-by-character. Intl.Segmenter is fully supported in both
 * regular Chrome (preview) and the headless Chrome Remotion renders
 * with, so this isn't a compatibility gamble.
 */
const graphemes = (text: string): string[] => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
};

/**
 * The per-grapheme style override needed for emoji specifically: color
 * (bitmap/COLR font) emoji glyphs always render their own embedded
 * colors regardless of the CSS `color` property, so the dim-when-
 * finished effect (driven by `color` for plain text) has no visible
 * effect on them — this applies `opacity` instead, the one visual
 * property color emoji genuinely do respect. The text-stroke border is
 * also explicitly canceled here rather than left inherited, since a
 * stroke width isn't something a color-glyph emoji can meaningfully
 * apply either.
 */
const emojiGraphemeStyle = (isCurrent: boolean): React.CSSProperties => ({
  opacity: isCurrent ? 1 : 0.68,
  WebkitTextStroke: "0px transparent",
});

// How long the entrance animation takes to finish, in frames, once a
// clip's title first reveals. Purely the "appear" moment — has no effect
// on the later bright -> dim transition when the clip finishes.
const REVEAL_DURATION = 20;

/** Frames between each letter's animation start, for the staggered styles. */
const LETTER_STAGGER = 2;

/**
 * Letter-by-letter reveal with a small sparkle that pulses at the typing
 * cursor while typing, then flares and fades once the title finishes typing.
 * Typing speed scales with title length but stays within a sane range so a
 * very long title doesn't feel sluggish and a very short one doesn't blip by.
 */
const TypewriterTitle: React.FC<{
  text: string;
  textStyle: React.CSSProperties;
  framesSinceStart: number;
  isCurrent: boolean;
}> = ({ text, textStyle, framesSinceStart, isCurrent }) => {
  const chars = graphemes(text);
  const typeDuration = Math.min(45, Math.max(18, chars.length * 2));
  const revealedFloat = interpolate(
    framesSinceStart,
    [0, typeDuration],
    [0, chars.length],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const charsToShow = Math.floor(revealedFloat);
  const isTyping = charsToShow < chars.length;

  // While typing: a gentle pulse so the sparkle reads as "active" at the
  // cursor. Once typing finishes: one quick flare-and-fade, then gone.
  const sparkleOpacity = isTyping
    ? interpolate(framesSinceStart % 8, [0, 4, 8], [0.35, 1, 0.35])
    : interpolate(framesSinceStart - typeDuration, [0, 12], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
  const sparkleScale = isTyping
    ? 1
    : interpolate(framesSinceStart - typeDuration, [0, 12], [1, 1.6], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  return (
    <span style={textStyle}>
      {chars.slice(0, charsToShow).map((char, i) =>
        EMOJI_TEST_REGEX.test(char) ? (
          <span key={i} style={emojiGraphemeStyle(isCurrent)}>
            {char}
          </span>
        ) : (
          char
        ),
      )}
      {sparkleOpacity > 0 ? (
        <span
          style={{
            display: "inline-block",
            marginLeft: 2,
            opacity: sparkleOpacity,
            transform: `scale(${sparkleScale})`,
          }}
        >
          ✨
        </span>
      ) : null}
    </span>
  );
};

/**
 * Each letter springs in one after another (a short stagger per letter)
 * rather than the whole title moving as one block.
 */
const BounceLettersTitle: React.FC<{
  text: string;
  textStyle: React.CSSProperties;
  framesSinceStart: number;
  fps: number;
  isCurrent: boolean;
}> = ({ text, textStyle, framesSinceStart, fps, isCurrent }) => {
  return (
    <span style={textStyle}>
      {graphemes(text).map((char, i) => {
        const localFrame = framesSinceStart - i * LETTER_STAGGER;
        const bounce = spring({
          frame: Math.max(0, localFrame),
          fps,
          config: { damping: 12, stiffness: 260, mass: 0.4 },
        });
        const entranceOpacity = interpolate(localFrame, [0, 6], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const translateY = interpolate(bounce, [0, 1], [10, 0]);
        const isEmoji = EMOJI_TEST_REGEX.test(char);

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              // Composed rather than set twice — a single element only
              // has one `opacity`, so an emoji grapheme's dim-when-
              // finished factor multiplies directly into the same
              // entrance-fade number a plain-text grapheme also uses.
              opacity: isEmoji
                ? entranceOpacity * (isCurrent ? 1 : 0.68)
                : entranceOpacity,
              transform: `translateY(${translateY}px) scale(${Math.max(bounce, 0)})`,
              ...(isEmoji ? { WebkitTextStroke: "0px transparent" } : {}),
            }}
          >
            {char === " " ? "\u00A0" : char}
          </span>
        );
      })}
    </span>
  );
};

/**
 * Wraps a revealed title in one of six entrance animations. `framesSinceStart`
 * is frame - clip.from, i.e. how long ago this clip's title became visible —
 * NOT the raw timeline frame, so the animation always plays out relative to
 * the moment of reveal regardless of where in the video that happens.
 */
const AnimatedTitle: React.FC<{
  text: string;
  textStyle: React.CSSProperties;
  framesSinceStart: number;
  fps: number;
  animationStyle: Clip["animationStyle"];
  isCurrent: boolean;
}> = ({ text, textStyle, framesSinceStart, fps, animationStyle, isCurrent }) => {
  if (animationStyle === "typewriter") {
    return (
      <TypewriterTitle
        text={text}
        textStyle={textStyle}
        framesSinceStart={framesSinceStart}
        isCurrent={isCurrent}
      />
    );
  }

  if (animationStyle === "bounceLetters") {
    return (
      <BounceLettersTitle
        text={text}
        textStyle={textStyle}
        framesSinceStart={framesSinceStart}
        fps={fps}
        isCurrent={isCurrent}
      />
    );
  }

  let motionStyle: React.CSSProperties = {};

  if (animationStyle === "fade") {
    const opacity = interpolate(
      framesSinceStart,
      [0, REVEAL_DURATION],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    motionStyle = { opacity };
  } else if (animationStyle === "slideUp") {
    const progress = interpolate(
      framesSinceStart,
      [0, REVEAL_DURATION],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    const translateY = interpolate(progress, [0, 1], [24, 0]);
    motionStyle = { opacity: progress, transform: `translateY(${translateY}px)` };
  } else if (animationStyle === "glow") {
    // Fades in like "fade", but also flares a soft glow around the text
    // that's brightest partway through the reveal and settles to a faint
    // steady glow rather than vanishing completely.
    const progress = interpolate(
      framesSinceStart,
      [0, REVEAL_DURATION],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    const glowIntensity = interpolate(
      framesSinceStart,
      [0, REVEAL_DURATION / 2, REVEAL_DURATION],
      [0, 1, 0.3],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    motionStyle = {
      opacity: progress,
      textShadow: `0 0 ${8 + glowIntensity * 20}px rgba(255,213,74,${glowIntensity}), 0 2px 6px rgba(0,0,0,0.7)`,
    };
  } else {
    // "pop" — a springy overshoot on scale, settling just past 1 before
    // relaxing back, plus a quick fade so it doesn't flash in at full scale.
    const scale = spring({
      frame: framesSinceStart,
      fps,
      config: { damping: 10, stiffness: 200, mass: 0.5 },
    });
    const opacity = interpolate(
      framesSinceStart,
      [0, REVEAL_DURATION / 2],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    motionStyle = { opacity, transform: `scale(${scale})` };
  }

  // Grouped into runs (not one span per grapheme — these styles don't
  // animate per-letter, so there's no need for that many elements): a
  // plain-text run renders as a bare string inheriting textStyle
  // normally, an emoji run gets its stroke canceled and is dimmed via
  // opacity instead of color, same reasoning as emojiGraphemeStyle above.
  const runs: { text: string; isEmoji: boolean }[] = [];
  for (const char of graphemes(text)) {
    const isEmoji = EMOJI_TEST_REGEX.test(char);
    const last = runs[runs.length - 1];
    if (last && last.isEmoji === isEmoji) {
      last.text += char;
    } else {
      runs.push({ text: char, isEmoji });
    }
  }

  return (
    <span style={{ ...textStyle, ...motionStyle }}>
      {runs.map((run, i) =>
        run.isEmoji ? (
          <span key={i} style={emojiGraphemeStyle(isCurrent)}>
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </span>
  );
};

/**
 * Phase 12 — how much of a clip's *original* audio should survive at this
 * exact point in the finished video's timeline, given every voice-over's
 * own duck window. Takes the strongest (lowest) applicable duck level
 * rather than multiplying overlapping windows together — simpler to
 * reason about, and overlapping voice-overs duck the same clip audio into
 * near-silence either way in practice, so multiplying wouldn't sound
 * meaningfully different, just harder to predict from the numbers alone.
 * 1 (no ducking at all) when no voice-over's window covers this frame.
 */
const getDuckedClipVolume = (
  absoluteFrame: number,
  voiceOvers: VoiceOver[],
): number => {
  let multiplier = 1;
  for (const voiceOver of voiceOvers) {
    if (
      absoluteFrame >= voiceOver.duckOriginalFrom &&
      absoluteFrame < voiceOver.duckOriginalTo
    ) {
      multiplier = Math.min(multiplier, voiceOver.duckOriginalLevel);
    }
  }
  return multiplier;
};

/**
 * Phase 12 (extended) — the final volume for a clip's original audio at a
 * given moment: the project-wide master level (originalAudioVolume, one
 * control for the whole video — not per clip) multiplied by whatever
 * per-frame ducking applies from getDuckedClipVolume above. Multiplying
 * rather than picking one or the other is what lets someone turn the
 * whole video's footage audio down to, say, 60%, and still have
 * voice-over ducking correctly drop it further (to 60% × duck level)
 * during a voice-over, instead of the duck window suddenly overriding
 * their overall level back up to 100%.
 */
const getFinalClipVolume = (
  absoluteFrame: number,
  voiceOvers: VoiceOver[],
  originalAudioVolume: number,
): number => originalAudioVolume * getDuckedClipVolume(absoluteFrame, voiceOvers);

/**
 * Phase 11 — a single clip's own video track.
 *
 * `trimBefore`/`trimAfter` (in frames, into the *original* source file —
 * independent of this Sequence's own timeline) play only the trimmed
 * range the person selected in the trim scrubber, rather than the whole
 * source clip.
 *
 * If the source isn't close to the vertical 9:16 canvas *and* the person
 * hasn't set a manual crop, it's padded automatically: a blurred,
 * scaled-up copy of the same clip fills the frame as a background, with a
 * normal, un-cropped, un-stretched copy centered on top. This is
 * deliberately the simple, safe fallback rather than attempting smart
 * subject-tracking crop — see Phase 11's own notes on why. The background
 * copy is muted so the clip's audio only plays once, from the foreground
 * copy.
 *
 * A manual crop (any of the 4 insets > 0, or cropRotationDeg !== 0) always
 * wins over the automatic pad, even for a non-vertical clip — cropping and
 * rotation are available on every clip regardless of orientation, not
 * gated behind failing the verticality check.
 *
 * Phase 12 — the clip's own (non-muted) audio is volume-automated per
 * frame via getFinalClipVolume above, so it reflects both the project's
 * overall original-audio level and ducks under any voice-over whose
 * window covers the current moment, returning to that overall level the
 * instant that window ends. `clip.from` (this clip's absolute start on the
 * finished video's timeline) is what lets that per-frame check work
 * correctly regardless of where in the video this clip happens to sit —
 * the volume callback itself always receives *this Sequence's own* local
 * frame numbering, same as useCurrentFrame() would inside it.
 */
const ClipVideo: React.FC<{
  clip: ClipRange;
  voiceOvers: VoiceOver[];
  originalAudioVolume: number;
}> = ({ clip, voiceOvers, originalAudioVolume }) => {
  const volume = (localFrame: number) =>
    getFinalClipVolume(clip.from + localFrame, voiceOvers, originalAudioVolume);
  const hasManualCrop =
    clip.cropInsetTop > 0 ||
    clip.cropInsetBottom > 0 ||
    clip.cropInsetLeft > 0 ||
    clip.cropInsetRight > 0 ||
    clip.cropRotationDeg !== 0;
  const vertical = isClipVertical(clip.sourceWidth, clip.sourceHeight);

  if (hasManualCrop || vertical) {
    let transform: string | undefined;
    if (hasManualCrop) {
      const { scale, translateXPercent, translateYPercent } =
        computeInsetCropTransform(
          clip.cropInsetTop,
          clip.cropInsetBottom,
          clip.cropInsetLeft,
          clip.cropInsetRight,
          clip.cropRotationDeg,
        );
      transform = `translate(${translateXPercent}%, ${translateYPercent}%) rotate(${clip.cropRotationDeg}deg) scale(${scale})`;
    }
    return (
      <Video
        src={clip.src}
        trimBefore={clip.trimStartFrame}
        trimAfter={clip.trimEndFrame}
        volume={volume}
        objectFit="cover"
        style={{ width: "100%", height: "100%", transform }}
      />
    );
  }

  return (
    <AbsoluteFill>
      <Video
        src={clip.src}
        trimBefore={clip.trimStartFrame}
        trimAfter={clip.trimEndFrame}
        muted
        objectFit="cover"
        style={{
          width: "100%",
          height: "100%",
          filter: "blur(60px) brightness(0.55)",
          transform: "scale(1.15)",
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Video
          src={clip.src}
          trimBefore={clip.trimStartFrame}
          trimAfter={clip.trimEndFrame}
          volume={volume}
          objectFit="contain"
          style={{ width: "100%", height: "100%" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Phase 17 — the pre-roll hook video itself, always occupying frames
 * [0, hook.durationInFrames) of the whole composition (the Sequence
 * wrapping this in Main below is what makes frame 0 here == the video's
 * own frame 0, so no offset math is needed the way ranked clips need
 * clip.from). Renders nothing when there's no hook.
 *
 * Its own audio goes through the exact same getFinalClipVolume as every
 * ranked clip — a voice-over placed over the hook (e.g. "let's rank the
 * most beautiful clay DIYs") ducks the hook's own footage audio
 * underneath it exactly the way it would for a ranked clip.
 */
const HookTrack: React.FC<{
  hook: Hook;
  voiceOvers: VoiceOver[];
  originalAudioVolume: number;
}> = ({ hook, voiceOvers, originalAudioVolume }) => {
  const frame = useCurrentFrame();

  if (!hook.src || hook.durationInFrames <= 0) {
    return null;
  }

  const volume = (localFrame: number) =>
    getFinalClipVolume(localFrame, voiceOvers, originalAudioVolume);

  const progress = interpolate(
    frame,
    [0, HOOK_INTRO_DURATION_IN_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  let introStyle: React.CSSProperties = {};
  if (hook.introAnimation === "fade") {
    introStyle = { opacity: progress };
  } else if (hook.introAnimation === "slideUp") {
    introStyle = {
      opacity: progress,
      transform: `translateY(${interpolate(progress, [0, 1], [40, 0])}px)`,
    };
  } else if (hook.introAnimation === "zoomIn") {
    introStyle = {
      opacity: progress,
      transform: `scale(${interpolate(progress, [0, 1], [1.15, 1])})`,
    };
  }

  return (
    <Video
      src={hook.src}
      volume={volume}
      objectFit="cover"
      style={{ width: "100%", height: "100%", ...introStyle }}
    />
  );
};

/**
 * Phase 17 — the transition effect across the boundary between the hook
 * ending and the first ranked clip starting (the "closing animation" that
 * marks the ranking process beginning). Rendered as a full-screen overlay
 * above literally everything else (video, header, ranking list) — a
 * transition needs to read as covering the whole frame, not just the
 * video layer underneath the header.
 *
 * `frame` here is deliberately read via useCurrentFrame() at Main's own
 * top level, NOT nested inside any Sequence — so it's already the
 * absolute composition frame, directly comparable to hookDurationInFrames
 * without any offset math.
 */
const HookOutroTransition: React.FC<{
  hook: Hook;
  hookDurationInFrames: number;
}> = ({ hook, hookDurationInFrames }) => {
  const frame = useCurrentFrame();

  if (
    !hook.src ||
    hookDurationInFrames <= 0 ||
    hook.outroAnimation === "none"
  ) {
    return null;
  }

  const halfDuration = hook.outroDurationInFrames / 2;
  const windowStart = hookDurationInFrames - halfDuration;
  const windowEnd = hookDurationInFrames + halfDuration;

  if (frame < windowStart || frame > windowEnd) {
    return null;
  }

  // Shared by "fade" and "zoomFlash" — both are a ramp up to full
  // intensity exactly at the cut, then back down, just with a different
  // color/interpretation of what "full intensity" covers the screen with.
  const rampToCutAndBack = (): number =>
    frame < hookDurationInFrames
      ? interpolate(frame, [windowStart, hookDurationInFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : interpolate(frame, [hookDurationInFrames, windowEnd], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  if (hook.outroAnimation === "fade") {
    return (
      <AbsoluteFill
        style={{ backgroundColor: "black", opacity: rampToCutAndBack() }}
      />
    );
  }

  if (hook.outroAnimation === "zoomFlash") {
    return (
      <AbsoluteFill
        style={{ backgroundColor: "white", opacity: rampToCutAndBack() }}
      />
    );
  }

  // "wipe" — a black panel slides fully across the frame left-to-right,
  // covering the cut point itself at the midpoint, then continues off the
  // far edge to reveal whatever's now playing underneath.
  const wipeProgress = interpolate(frame, [windowStart, windowEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateXPercent = interpolate(wipeProgress, [0, 1], [-100, 100]);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundColor: "black",
          transform: `translateX(${translateXPercent}%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Computed once, shared by both the video Sequence stack below and the
 * ranking list overlay — if these were computed twice with even slightly
 * different logic, the overlay's reveal timing could silently drift out
 * of sync with what's actually playing in the video.
 *
 * `startOffset` (Phase 17) shifts every clip's from/to later by this many
 * frames — how the hook, when one exists, pushes the entire ranked
 * countdown back to start right after it instead of at frame 0. Defaults
 * to 0, identical to every call site before the hook existed.
 */
export const computeClipRanges = (
  clips: Clip[],
  startOffset: number = 0,
): ClipRange[] => {
  const sortedByOrder = clips.slice().sort((a, b) => a.order - b.order);
  let cursor = startOffset;
  return sortedByOrder.map((clip) => {
    const from = cursor;
    const to = cursor + clip.durationInFrames;
    cursor = to;
    return { ...clip, from, to };
  });
};

/**
 * Phase 12 — the single background music track, spanning from frame 0 for
 * its own full duration (Phase 12's own wording: "apply it under the whole
 * composition" — there's no separate start-time control, unlike
 * voice-overs below, which are each placed individually). Renders nothing
 * at all when no track has been added (src === null) or its duration
 * hasn't been read yet.
 *
 * The duck multiplier is a genuine per-frame check against clipRanges —
 * "is *some* clip's audio playing right now" — rather than a hardcoded
 * constant. In this app specifically, clips always play back-to-back with
 * zero gaps (see computeClipRanges above), so today this multiplier is
 * constant for the video's entire length; the moment gaps become possible
 * (e.g. a future feature trims a clip shorter without shifting the ones
 * after it), music correctly swells back to full volume during them
 * without this needing to change at all.
 */
const MusicTrack: React.FC<{
  music: Music;
  clipRanges: ClipRange[];
  hookDurationInFrames: number;
}> = ({ music, clipRanges, hookDurationInFrames }) => {
  if (!music.src || music.durationInFrames <= 0) {
    return null;
  }

  const volume = (frame: number) => {
    // The hook (Phase 17) has its own video audio too, same as any ranked
    // clip — music ducks under it exactly the same way.
    const isDuringHookAudio = frame < hookDurationInFrames;
    const isDuringClipAudio = clipRanges.some(
      (range) => frame >= range.from && frame < range.to,
    );
    return (
      music.volume * (isDuringHookAudio || isDuringClipAudio ? music.duckLevel : 1)
    );
  };

  return (
    <Sequence durationInFrames={music.durationInFrames}>
      <Audio src={music.src} volume={volume} />
    </Sequence>
  );
};

/**
 * A flat linear multiply on volume makes the 100%->200% range of the
 * slider feel almost unchanged, since human loudness perception is closer
 * to logarithmic than linear — doubling a number doesn't sound like
 * "twice as loud." Squaring the amount *over* 100% accelerates the boost
 * the further past 100% the person drags the slider, so 150% is a clear,
 * audible step up and 200% (the max) lands around 4x the original signal
 * — a dramatic, unmistakable difference rather than a modest linear bump.
 * At/under 100% this is unchanged (a straight pass-through), matching
 * "100% = the recording's own original level" exactly.
 */
const getVoiceOverAppliedVolume = (storedVolume: number): number => {
  if (storedVolume <= 1) {
    return storedVolume;
  }
  return 1 + (storedVolume - 1) ** 2 * 3;
};

/**
 * Phase 12 — a single voice-over/narration clip. A thin wrapper: all the
 * actual ducking-the-original-audio-underneath-it logic lives in
 * getDuckedClipVolume above (applied to each *clip's* Video, not here) —
 * this component's own job is just "play this audio file starting at this
 * absolute frame," nothing more.
 */
const VoiceOverTrack: React.FC<{ voiceOver: VoiceOver }> = ({
  voiceOver,
}) => {
  const appliedVolume = getVoiceOverAppliedVolume(voiceOver.volume);
  return (
    <Sequence
      from={voiceOver.startFrame}
      durationInFrames={voiceOver.durationInFrames}
    >
      <Audio src={voiceOver.src} volume={() => appliedVolume} />
    </Sequence>
  );
};

/**
 * Phase 10 — a single reaction-emoji sticker. Position/size are stored as
 * percentages of the frame (see StickerSchema's comment for why), resolved
 * to actual pixels here via useVideoConfig's width — so a sticker lands in
 * the same relative spot regardless of the composition's actual resolution
 * or whether Phase 8's extendCanvas mode is active. Rendered inside a
 * <Sequence> by the caller, so this component itself doesn't need to know
 * about timing at all — if it's mounted, it's visible.
 */
const StickerOverlay: React.FC<{ sticker: Sticker }> = ({ sticker }) => {
  const { width } = useVideoConfig();
  const fontSize = (width * sticker.size) / 100;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <span
        style={{
          position: "absolute",
          left: `${sticker.x}%`,
          top: `${sticker.y}%`,
          // Centers the glyph on the stored x/y point rather than the
          // point being its top-left corner — matches where a person
          // actually clicked to place it.
          transform: "translate(-50%, -50%)",
          fontSize,
          lineHeight: 1,
        }}
      >
        {sticker.emoji}
      </span>
    </AbsoluteFill>
  );
};

/**
 * The persistent ranking list — spans the entire video timeline (it's a
 * sibling of the Sequence stack, not nested inside any one clip's
 * Sequence). Every rank slot (1..N) is visible from frame 0. A slot's
 * title only reveals once its clip's range has started, stays bright
 * while that clip is the one currently playing, and dims once playback
 * has moved on to a later clip — the dim/bright effect is layered on as
 * opacity over whichever title color is resolved for that clip, so a
 * custom title color and the play-state effect never fight each other.
 * The badge's own color/font/border, by contrast, stays fixed at
 * whatever's resolved for it regardless of play state — a rank's assigned
 * identity (e.g. gold for #1) isn't something that should dim.
 */
const RankingList: React.FC<{
  clipRanges: ClipRange[];
  listStyle: RankingListStyleProps;
}> = ({ clipRanges, listStyle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sortedByRank = clipRanges.slice().sort((a, b) => a.rank - b.rank);

  const badgeFontSize = BASE_BADGE_FONT_SIZE * listStyle.scale * listStyle.badgeScale;
  const badgeMinWidth = BASE_BADGE_MIN_WIDTH * listStyle.scale * listStyle.badgeScale;
  const titleFontSize = BASE_TITLE_FONT_SIZE * listStyle.scale * listStyle.titleScale;
  const rowGap = listStyle.rowGap * listStyle.scale;
  const itemGap = listStyle.itemGap * listStyle.scale;

  return (
    <AbsoluteFill
      style={{
        padding: 60,
        justifyContent: "center",
        transform: `translateY(${listStyle.verticalOffset}px)`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: rowGap }}>
        {sortedByRank.map((clip) => {
          const hasStarted = frame >= clip.from;
          const isCurrent = frame >= clip.from && frame < clip.to;
          const badgeStyle = resolveBadgeStyle(clip, listStyle);
          const titleStyle = resolveTitleStyle(clip, listStyle);

          return (
            <div
              key={clip.id}
              style={{ display: "flex", alignItems: "center", gap: itemGap }}
            >
              <span
                style={{
                  fontSize: badgeFontSize,
                  fontWeight: badgeStyle.fontWeight,
                  fontFamily: badgeStyle.fontFamily,
                  color: badgeStyle.color,
                  textShadow: "0 2px 6px rgba(0,0,0,0.7)",
                  minWidth: badgeMinWidth,
                  ...textStrokeStyle(badgeStyle),
                }}
              >
                {clip.badgeType === "emoji" && clip.badgeEmoji
                  ? clip.badgeEmoji
                  : `${clip.rank}.`}
              </span>
              {hasStarted && clip.title ? (
                <AnimatedTitle
                  text={clip.title}
                  framesSinceStart={frame - clip.from}
                  fps={fps}
                  animationStyle={clip.animationStyle}
                  isCurrent={isCurrent}
                  textStyle={{
                    fontSize: titleFontSize,
                    // "Faded" comes from a genuinely light weight, not a
                    // capped-down version of whatever weight was chosen —
                    // finished titles always render at 300 regardless of
                    // the configured (usually bold) title weight, which is
                    // what actually reads as "light" rather than "still
                    // kind of bold but a little dimmer."
                    fontWeight: isCurrent ? titleStyle.fontWeight : 300,
                    fontFamily: titleStyle.fontFamily,
                    // AnimatedTitle's own entrance animation drives this
                    // span's `opacity` (0 -> 1) for several of the reveal
                    // styles, and its motionStyle is spread after this
                    // textStyle — so a separate `opacity` here would get
                    // silently clobbered once the reveal finishes. The
                    // dim-when-not-current effect is baked into the color
                    // itself instead, the same principle the original
                    // rgba-alpha approach used, just generalized to work
                    // with any base color the person picks, not only white.
                    color: isCurrent
                      ? titleStyle.color
                      : `color-mix(in srgb, ${titleStyle.color} 68%, transparent)`,
                    textShadow: "0 2px 6px rgba(0,0,0,0.7)",
                    ...(isCurrent
                      ? textStrokeStyle(titleStyle)
                      : textStrokeStyle({ ...titleStyle, borderEnabled: false })),
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Phase 8, part 1 — the "shade" backdrop: a flat, solid-black bar behind
 * the header, sized to the header's actual measured height (plus the
 * person's manual extend-downward amount) rather than a fixed guessed
 * number. Renders nothing when there's no header text (height is 0), and
 * re-derives its height from `header` on every render, so it can never go
 * stale relative to the current text/font size/line-wrapping.
 */
const HeaderShadeBackdrop: React.FC<{
  header: HeaderProps;
  canvasWidth: number;
}> = ({ header, canvasWidth }) => {
  if (header.headerBackdropMode !== "shade") {
    return null;
  }

  const height = getShadeBackdropHeight(header, canvasWidth);
  if (height <= 0) {
    return null;
  }

  return (
    <AbsoluteFill
      style={{
        top: 0,
        bottom: "auto",
        height,
        backgroundColor: `rgba(0, 0, 0, ${header.headerBackdropShadeOpacity})`,
      }}
    />
  );
};

/**
 * A one-time title for the whole video — a sibling of the ranking list, not
 * nested inside it and not per-clip. Each word renders as its own <span>
 * with its own color, joined by plain spaces. Words are grouped into lines
 * wherever `lineBreakAfter` is set, so line breaks are deliberate rather
 * than left entirely to the browser's natural wrapping — the browser will
 * still additionally soft-wrap within a line if it's too long for the
 * canvas width. In "firstTwoSeconds" mode it simply stops rendering past
 * the cutoff; Phase 8 can layer a fade onto this same cutoff later if that
 * feels too abrupt once the scrim exists.
 */
const Header: React.FC<{ header: HeaderProps }> = ({ header }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (header.words.length === 0) {
    return null;
  }

  if (
    header.durationMode === "firstTwoSeconds" &&
    frame >= HEADER_INTRO_SECONDS * fps
  ) {
    return null;
  }

  // Split the flat word list into lines wherever a word is flagged
  // lineBreakAfter. Always at least one line, even with no manual breaks.
  const lines: (typeof header.words)[] = [];
  let currentLine: typeof header.words = [];
  for (const headerWord of header.words) {
    currentLine.push(headerWord);
    if (headerWord.lineBreakAfter) {
      lines.push(currentLine);
      currentLine = [];
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        padding: `${HEADER_TOP_PADDING}px ${HEADER_HORIZONTAL_PADDING}px 0`,
        pointerEvents: "none",
        transform: `translateY(${header.verticalOffset}px)`,
      }}
    >
      <div
        style={{
          fontSize: header.fontSize,
          fontWeight: 900,
          textAlign: "center",
          lineHeight: HEADER_LINE_HEIGHT,
        }}
      >
        {lines.map((lineWords, lineIndex) => (
          <div key={lineIndex}>
            {lineWords.map((headerWord, i) => (
              <span
                key={i}
                style={{
                  color: headerWord.color,
                  textShadow: "0 2px 8px rgba(0,0,0,0.75)",
                }}
              >
                {headerWord.word}
                {i < lineWords.length - 1 ? " " : ""}
              </span>
            ))}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const Main = ({
  clips,
  header,
  rankingListStyle,
  music,
  voiceOvers,
  originalAudioVolume,
  globalCrop,
  hook,
}: z.infer<typeof CompositionProps>) => {
  // Phase 17 — 0 when there's no hook (or its duration hasn't been read
  // yet), otherwise exactly how many frames the hook occupies at the very
  // front of the timeline. Every ranked clip's own from/to is shifted
  // later by this via computeClipRanges' startOffset — the countdown
  // simply starts right after the hook ends instead of at frame 0.
  const hookDurationInFrames =
    hook.src && hook.durationInFrames > 0 ? hook.durationInFrames : 0;
  const clipRanges = computeClipRanges(clips, hookDurationInFrames);
  const { width } = useVideoConfig();

  // Phase 8, part 2: in "extendCanvas" mode the composition (see Root.tsx's
  // calculateMetadata / page.tsx's Player) has already been made taller by
  // exactly this many pixels. Pushing the video track and ranking list down
  // by the same amount here — rather than resizing them — is what keeps the
  // original footage "completely unresized/unpadded/uncropped, just shifted
  // down". In "shade" mode (or no header text) this is 0 and both layers
  // render exactly as they did before Phase 8.
  const videoTrackOffset = getExtendCanvasExtraHeight(header, width);

  // Phase 11 (extended) — crops the entire final composited video (every
  // clip, the ranking list, the header — everything visual), as opposed to
  // each clip's own individual crop above which only affects that one
  // clip's footage. Same shared transform function, no rotation option
  // here. When all four insets are 0 (the default) this is scale(1)
  // translate(0,0) — a no-op, identical to before this feature existed.
  // Audio (MusicTrack/VoiceOverTrack below) is deliberately kept *outside*
  // this transformed wrapper — cropping is a visual concept, and nesting
  // <Audio> inside a transformed element has no meaning for it.
  const hasGlobalCrop =
    globalCrop.top > 0 ||
    globalCrop.bottom > 0 ||
    globalCrop.left > 0 ||
    globalCrop.right > 0;
  const globalCropTransform = computeInsetCropTransform(
    globalCrop.top,
    globalCrop.bottom,
    globalCrop.left,
    globalCrop.right,
  );

  return (
    <AbsoluteFill className="bg-black" style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={
          hasGlobalCrop
            ? {
                transform: `translate(${globalCropTransform.translateXPercent}%, ${globalCropTransform.translateYPercent}%) scale(${globalCropTransform.scale})`,
              }
            : undefined
        }
      >
        <AbsoluteFill style={{ top: videoTrackOffset }}>
          {hookDurationInFrames > 0 ? (
            <Sequence durationInFrames={hookDurationInFrames}>
              <HookTrack
                hook={hook}
                voiceOvers={voiceOvers}
                originalAudioVolume={originalAudioVolume}
              />
            </Sequence>
          ) : null}
          {clipRanges.map((clip) => (
            <Sequence
              key={clip.id}
              from={clip.from}
              durationInFrames={clip.to - clip.from}
            >
              <ClipVideo
                clip={clip}
                voiceOvers={voiceOvers}
                originalAudioVolume={originalAudioVolume}
              />
              {clip.stickers.map((sticker) => {
                // A nested <Sequence>'s `from` is relative to its parent
                // Sequence's own local frame 0 — i.e. exactly the "0 = this
                // clip's own start" convention stickers are stored in. No
                // manual offset math needed here at all.
                const durationInFrames = Math.max(
                  1,
                  sticker.endFrame - sticker.startFrame,
                );
                return (
                  <Sequence
                    key={sticker.id}
                    from={sticker.startFrame}
                    durationInFrames={durationInFrames}
                  >
                    <StickerOverlay sticker={sticker} />
                  </Sequence>
                );
              })}
            </Sequence>
          ))}
        </AbsoluteFill>
        <HeaderShadeBackdrop header={header} canvasWidth={width} />
        <AbsoluteFill style={{ top: videoTrackOffset }}>
          <RankingList clipRanges={clipRanges} listStyle={rankingListStyle} />
        </AbsoluteFill>
        <Header header={header} />
      </AbsoluteFill>
      <MusicTrack
        music={music}
        clipRanges={clipRanges}
        hookDurationInFrames={hookDurationInFrames}
      />
      {voiceOvers.map((voiceOver) => (
        <VoiceOverTrack key={voiceOver.id} voiceOver={voiceOver} />
      ))}
      <HookOutroTransition
        hook={hook}
        hookDurationInFrames={hookDurationInFrames}
      />
    </AbsoluteFill>
  );
};