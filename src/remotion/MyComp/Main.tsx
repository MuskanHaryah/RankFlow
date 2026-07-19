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
import { CompositionProps } from "../../../types/constants";

type Clip = z.infer<typeof CompositionProps>["clips"][number];
type ClipRange = Clip & { from: number; to: number };

// How long the entrance animation takes to finish, in frames, once a
// clip's title first reveals. Purely the "appear" moment — has no effect
// on the later bright -> dim transition when the clip finishes.
const REVEAL_DURATION = 20;

/**
 * Wraps a revealed title in one of three entrance animations. `framesSinceStart`
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

export const Main = ({ clips }: z.infer<typeof CompositionProps>) => {
  const clipRanges = computeClipRanges(clips);

  return (
    <AbsoluteFill className="bg-black">
      {clipRanges.map((clip) => (
        <Sequence
          key={clip.id}
          from={clip.from}
          durationInFrames={clip.to - clip.from}
        >
          <Video src={clip.src} />
        </Sequence>
      ))}
      <RankingList clipRanges={clipRanges} />
    </AbsoluteFill>
  );
};