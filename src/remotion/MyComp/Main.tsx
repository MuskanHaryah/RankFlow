import { Video } from "@remotion/media";
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
}> = ({ text, textStyle, framesSinceStart }) => {
  const typeDuration = Math.min(45, Math.max(18, text.length * 2));
  const revealedFloat = interpolate(
    framesSinceStart,
    [0, typeDuration],
    [0, text.length],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const charsToShow = Math.floor(revealedFloat);
  const isTyping = charsToShow < text.length;

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
      {text.slice(0, charsToShow)}
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
}> = ({ text, textStyle, framesSinceStart, fps }) => {
  return (
    <span style={textStyle}>
      {text.split("").map((char, i) => {
        const localFrame = framesSinceStart - i * LETTER_STAGGER;
        const bounce = spring({
          frame: Math.max(0, localFrame),
          fps,
          config: { damping: 12, stiffness: 260, mass: 0.4 },
        });
        const opacity = interpolate(localFrame, [0, 6], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const translateY = interpolate(bounce, [0, 1], [10, 0]);

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity,
              transform: `translateY(${translateY}px) scale(${Math.max(bounce, 0)})`,
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
}> = ({ text, textStyle, framesSinceStart, fps, animationStyle }) => {
  if (animationStyle === "typewriter") {
    return (
      <TypewriterTitle
        text={text}
        textStyle={textStyle}
        framesSinceStart={framesSinceStart}
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

  return <span style={{ ...textStyle, ...motionStyle }}>{text}</span>;
};

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
 * A manual crop (cropZoom > 1) always wins over the automatic pad, even
 * for a non-vertical clip — cropping is available on every clip
 * regardless of orientation, not gated behind failing the verticality
 * check.
 */
const ClipVideo: React.FC<{ clip: Clip }> = ({ clip }) => {
  const hasManualCrop = clip.cropZoom > 1;
  const vertical = isClipVertical(clip.sourceWidth, clip.sourceHeight);

  if (hasManualCrop || vertical) {
    return (
      <Video
        src={clip.src}
        trimBefore={clip.trimStartFrame}
        trimAfter={clip.trimEndFrame}
        objectFit="cover"
        style={{
          width: "100%",
          height: "100%",
          transform: hasManualCrop
            ? `scale(${clip.cropZoom}) translate(${clip.cropOffsetX}%, ${clip.cropOffsetY}%)`
            : undefined,
        }}
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
          objectFit="contain"
          style={{ width: "100%", height: "100%" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Computed once, shared by both the video Sequence stack below and the
 * ranking list overlay — if these were computed twice with even slightly
 * different logic, the overlay's reveal timing could silently drift out
 * of sync with what's actually playing in the video.
 */
export const computeClipRanges = (clips: Clip[]): ClipRange[] => {
  const sortedByOrder = clips.slice().sort((a, b) => a.order - b.order);
  let cursor = 0;
  return sortedByOrder.map((clip) => {
    const from = cursor;
    const to = cursor + clip.durationInFrames;
    cursor = to;
    return { ...clip, from, to };
  });
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
}: z.infer<typeof CompositionProps>) => {
  const clipRanges = computeClipRanges(clips);
  const { width } = useVideoConfig();

  // Phase 8, part 2: in "extendCanvas" mode the composition (see Root.tsx's
  // calculateMetadata / page.tsx's Player) has already been made taller by
  // exactly this many pixels. Pushing the video track and ranking list down
  // by the same amount here — rather than resizing them — is what keeps the
  // original footage "completely unresized/unpadded/uncropped, just shifted
  // down". In "shade" mode (or no header text) this is 0 and both layers
  // render exactly as they did before Phase 8.
  const videoTrackOffset = getExtendCanvasExtraHeight(header, width);

  return (
    <AbsoluteFill className="bg-black">
      <AbsoluteFill style={{ top: videoTrackOffset }}>
        {clipRanges.map((clip) => (
          <Sequence
            key={clip.id}
            from={clip.from}
            durationInFrames={clip.to - clip.from}
          >
            <ClipVideo clip={clip} />
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
  );
};