import { Video } from "@remotion/media";
import { AbsoluteFill, Sequence } from "remotion";
import { z } from "zod";
import { CompositionProps } from "../../../types/constants";

export const Main = ({ clips }: z.infer<typeof CompositionProps>) => {
  // Running total of frames consumed so far. Building the sequence this way
  // guarantees no gaps and no overlaps by construction — each clip starts
  // exactly where the previous one ended, because we're accumulating real
  // durations, not guessing at fixed timing.
  let startFrame = 0;

  const sortedClips = clips.slice().sort((a, b) => a.order - b.order);

  return (
    <AbsoluteFill className="bg-black">
      {sortedClips.map((clip) => {
        const from = startFrame;
        startFrame += clip.durationInFrames;

        return (
          <Sequence
            key={clip.id}
            from={from}
            durationInFrames={clip.durationInFrames}
          >
            <Video src={clip.src} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};