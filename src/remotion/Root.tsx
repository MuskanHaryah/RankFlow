import { Composition } from "remotion";
import {
  COMP_NAME,
  defaultMyCompProps,
  DURATION_IN_FRAMES,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "../../types/constants";
import { getCompositionHeight } from "./MyComp/headerBackdrop";
import { Main } from "./MyComp/Main";
import { NextLogo } from "./MyComp/NextLogo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id={COMP_NAME}
        component={Main}
        durationInFrames={DURATION_IN_FRAMES}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultMyCompProps}
        calculateMetadata={async ({ props }) => {
          // Total video length = sum of every clip's duration. This runs
          // automatically whenever the clips array changes, so the CLI
          // render (Step 4) always uses the correct real total — we never
          // have to manually keep a duration number in sync by hand.
          const totalDuration = props.clips.reduce(
            (sum, clip) => sum + clip.durationInFrames,
            0,
          );

          // Phase 8, part 2: in "extendCanvas" mode the composition itself
          // grows taller by the header's measured height (plus any manual
          // extra), so the header gets a genuine black bar rather than
          // sitting over footage. In "shade" mode (or no header text) this
          // adds 0 and the canvas stays exactly VIDEO_HEIGHT, unchanged
          // from before Phase 8.
          const height = getCompositionHeight(
            props.header,
            VIDEO_HEIGHT,
            VIDEO_WIDTH,
          );

          return {
            durationInFrames: Math.max(totalDuration, 1),
            height,
          };
        }}
      />
      <Composition
        id="NextLogo"
        component={NextLogo}
        durationInFrames={300}
        fps={30}
        width={140}
        height={140}
        defaultProps={{
          outProgress: 0,
        }}
      />
    </>
  );
};