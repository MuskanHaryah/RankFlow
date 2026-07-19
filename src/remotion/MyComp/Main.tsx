import { Video } from "@remotion/media";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { z } from "zod";
import { CompositionProps } from "../../../types/constants";

type Clip = z.infer<typeof CompositionProps>["clips"][number];
type ClipRange = Clip & { from: number; to: number };

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
                <span
                  style={{
                    fontSize: 42,
                    fontWeight: 700,
                    color: isCurrent
                      ? "rgba(255,255,255,1)"
                      : "rgba(255,255,255,0.35)",
                    textShadow: "0 2px 6px rgba(0,0,0,0.7)",
                  }}
                >
                  {clip.title}
                </span>
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