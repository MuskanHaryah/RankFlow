"use client";

import { Player } from "@remotion/player";
import type { NextPage } from "next";
import { useMemo, useState } from "react";
import { z } from "zod";
import {
  CompositionProps,
  defaultMyCompProps,
  HeaderSchema,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "../../types/constants";
import { ClipUploader, UploadedClip } from "../components/ClipUploader";
import { HeaderEditor } from "../components/HeaderEditor";
import { RenderControls } from "../components/RenderControls";
import { Spacing } from "../components/Spacing";
import { Tips } from "../components/Tips";
import { Main } from "../remotion/MyComp/Main";

const Home: NextPage = () => {
  const [uploadedClips, setUploadedClips] = useState<UploadedClip[]>([]);
  // Lifted the same way as uploadedClips: HeaderEditor owns the actual
  // editing state and just reports the current value up on every change.
  const [header, setHeader] = useState<z.infer<typeof HeaderSchema>>(
    defaultMyCompProps.header,
  );

  // Only include clips with a real, usable duration — clips still showing
  // "reading duration…" (null) or that failed validation are deliberately
  // left out, rather than letting a bad value corrupt the total.
  const inputProps: z.infer<typeof CompositionProps> = useMemo(() => {
    return {
      clips: uploadedClips
        .filter(
          (clip): clip is UploadedClip & { durationInFrames: number } =>
            clip.durationInFrames !== null &&
            Number.isFinite(clip.durationInFrames) &&
            clip.durationInFrames > 0,
        )
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((clip) => ({
          id: clip.id,
          src: clip.src,
          order: clip.order,
          durationInFrames: clip.durationInFrames,
          title: clip.title,
          rank: clip.rank,
          badgeType: clip.badgeType,
          badgeEmoji: clip.badgeEmoji,
          animationStyle: clip.animationStyle,
        })),
      header,
    };
  }, [uploadedClips, header]);

  const totalDurationInFrames = useMemo(() => {
    const total = inputProps.clips.reduce(
      (sum, clip) => sum + clip.durationInFrames,
      0,
    );
    return Number.isFinite(total) ? Math.max(total, 1) : 1;
  }, [inputProps]);

  return (
    <div>
      <div className="max-w-screen-md m-auto mb-5 px-4">
        <div className="overflow-hidden rounded-geist shadow-[0_0_200px_rgba(0,0,0,0.15)] mb-10 mt-16">
          <Player
            component={Main}
            inputProps={inputProps}
            durationInFrames={totalDurationInFrames}
            fps={VIDEO_FPS}
            compositionHeight={VIDEO_HEIGHT}
            compositionWidth={VIDEO_WIDTH}
            style={{
              width: "100%",
            }}
            controls
            autoPlay
            loop
            initiallyMuted
          />
        </div>
        <HeaderEditor onHeaderChange={setHeader} />
        <Spacing></Spacing>
        <ClipUploader onClipsChange={setUploadedClips} />
        <Spacing></Spacing>
        <RenderControls inputProps={inputProps}></RenderControls>
        <Spacing></Spacing>
        <Spacing></Spacing>
        <Spacing></Spacing>
        <Spacing></Spacing>
        <Tips></Tips>
      </div>
    </div>
  );
};

export default Home;