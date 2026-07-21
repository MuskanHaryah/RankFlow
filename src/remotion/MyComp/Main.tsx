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
import { CompositionProps, HEADER_INTRO_SECONDS } from "../../../types/constants";
import {
  HEADER_HORIZONTAL_PADDING,
  HEADER_LINE_HEIGHT,
  HEADER_TOP_PADDING,
  getExtendCanvasExtraHeight,
  getShadeBackdropHeight,
} from "./headerBackdrop";

type Clip = z.infer<typeof CompositionProps>["clips"][number];
type ClipRange = Clip & { from: number; to: number };
type HeaderProps = z.infer<typeof CompositionProps>["header"];

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
 * Computed once, shared by both the video Sequence stack below and the
 * ranking list overlay — if these were computed twice with even slightly
 * different logic, the overlay's reveal timing could silently drift out
 * of sync with what's actually playing in the video.
 */
const computeClipRanges = (clips: Clip[]): ClipRange[] => {
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
 * The persistent ranking list — spans the entire video timeline (it's a
 * sibling of the Sequence stack, not nested inside any one clip's
 * Sequence). Every rank slot (1..N) is visible from frame 0. A slot's
 * title only reveals once its clip's range has started, stays bright
 * while that clip is the one currently playing, and dims once playback
 * has moved on to a later clip.
 */
const RankingList: React.FC<{ clipRanges: ClipRange[] }> = ({
  clipRanges,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sortedByRank = clipRanges.slice().sort((a, b) => a.rank - b.rank);

  return (
    <AbsoluteFill style={{ padding: 60, justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {sortedByRank.map((clip) => {
          const hasStarted = frame >= clip.from;
          const isCurrent = frame >= clip.from && frame < clip.to;

          return (
            <div
              key={clip.id}
              style={{ display: "flex", alignItems: "center", gap: 16 }}
            >
              <span
                style={{
                  fontSize: 48,
                  fontWeight: 900,
                  color: isCurrent ? "#FFD54A" : "white",
                  textShadow: "0 2px 6px rgba(0,0,0,0.7)",
                  minWidth: 60,
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
                    fontSize: 42,
                    fontWeight: 700,
                    color: isCurrent
                      ? "rgba(255,255,255,1)"
                      : "rgba(255,255,255,0.35)",
                    textShadow: "0 2px 6px rgba(0,0,0,0.7)",
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

export const Main = ({ clips, header }: z.infer<typeof CompositionProps>) => {
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
            <Video src={clip.src} />
          </Sequence>
        ))}
      </AbsoluteFill>
      <HeaderShadeBackdrop header={header} canvasWidth={width} />
      <AbsoluteFill style={{ top: videoTrackOffset }}>
        <RankingList clipRanges={clipRanges} />
      </AbsoluteFill>
      <Header header={header} />
    </AbsoluteFill>
  );
};