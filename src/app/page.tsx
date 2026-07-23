"use client";

import { Player } from "@remotion/player";
import type { NextPage } from "next";
import { useMemo, useState } from "react";
import { z } from "zod";
import {
  CompositionProps,
  defaultMyCompProps,
  HeaderSchema,
  RankingListStyleSchema,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "../../types/constants";
import { ClipUploader, UploadedClip } from "../components/ClipUploader";
import { HeaderEditor } from "../components/HeaderEditor";
import { RankingListStyleEditor } from "../components/RankingListStyleEditor";
import { RenderControls } from "../components/RenderControls";
import { Section } from "../components/Section";
import { ThemeToggle } from "../components/ThemeToggle";
import { Tips } from "../components/Tips";
import { getCompositionHeight } from "../remotion/MyComp/headerBackdrop";
import { Main } from "../remotion/MyComp/Main";

const Home: NextPage = () => {
  const [uploadedClips, setUploadedClips] = useState<UploadedClip[]>([]);
  // Lifted the same way as uploadedClips: HeaderEditor owns the actual
  // editing state and just reports the current value up on every change.
  const [header, setHeader] = useState<z.infer<typeof HeaderSchema>>(
    defaultMyCompProps.header,
  );
  // Same lifted pattern again: RankingListStyleEditor owns the actual
  // editing state, this just holds the latest reported value.
  const [rankingListStyle, setRankingListStyle] = useState<
    z.infer<typeof RankingListStyleSchema>
  >(defaultMyCompProps.rankingListStyle);

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
          badgeStyleOverride: clip.badgeStyleOverride,
          titleStyleOverride: clip.titleStyleOverride,
          animationStyle: clip.animationStyle,
        })),
      header,
      rankingListStyle,
    };
  }, [uploadedClips, header, rankingListStyle]);

  const totalDurationInFrames = useMemo(() => {
    const total = inputProps.clips.reduce(
      (sum, clip) => sum + clip.durationInFrames,
      0,
    );
    return Number.isFinite(total) ? Math.max(total, 1) : 1;
  }, [inputProps]);

  // Phase 8, part 2: mirrors Root.tsx's calculateMetadata exactly (same
  // helper, same inputs), so the live preview's canvas size always matches
  // what the real render actually produces — in "shade" mode (or no
  // header) this is just VIDEO_HEIGHT, unchanged from before Phase 8.
  const compositionHeight = useMemo(
    () => getCompositionHeight(header, VIDEO_HEIGHT, VIDEO_WIDTH),
    [header],
  );

  // Purely presentational readouts for the status strip below — derived
  // from state that already exists, doesn't affect rendering/export.
  const clipCount = inputProps.clips.length;
  const totalSeconds = (totalDurationInFrames / VIDEO_FPS).toFixed(1);

  return (
    <div className="min-h-screen bg-background font-geist">
      <header className="sticky top-0 z-20 border-b border-unfocused-border-color bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent text-sm font-bold text-accent-contrast"
            >
              #1
            </span>
            <div>
              <h1 className="text-base font-bold leading-none tracking-tight text-foreground">
                RankFlow
              </h1>
              <p className="mt-1 text-[11px] leading-none text-subtitle">
                Ranking-video maker
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 sm:flex">
              <span className="rounded-full border border-unfocused-border-color bg-panel px-2.5 py-1 font-mono-tabular text-[11px] text-subtitle">
                {clipCount} clip{clipCount === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-unfocused-border-color bg-panel px-2.5 py-1 font-mono-tabular text-[11px] text-subtitle">
                {totalSeconds}s
              </span>
              <span className="rounded-full border border-unfocused-border-color bg-panel px-2.5 py-1 font-mono-tabular text-[11px] text-subtitle">
                {VIDEO_WIDTH}×{compositionHeight}
              </span>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-8 lg:px-8">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-10">
          {/* Controls — scrolls normally, sits on the left on desktop */}
          <div className="order-2 flex flex-col gap-5 lg:order-1">
            <Section label="Header" description="A one-time title for the whole video">
              <HeaderEditor onHeaderChange={setHeader} />
            </Section>
            <Section
              label="Ranking list style"
              description="Shared look for every rank's number and title"
              defaultOpen={false}
            >
              <RankingListStyleEditor onStyleChange={setRankingListStyle} />
            </Section>
            <Section label="Clips" description="Upload, order, and rank your footage">
              <ClipUploader
                onClipsChange={setUploadedClips}
                rankingListStyle={rankingListStyle}
              />
            </Section>
            <Section label="Export" description="Render the final video locally" defaultOpen={false}>
              <RenderControls inputProps={inputProps}></RenderControls>
            </Section>
          </div>

          {/* Preview — pinned on the right on desktop, on top on mobile
              (matching where it already sat before this layout change) */}
          <div className="order-1 mb-8 lg:sticky lg:top-[88px] lg:order-2 lg:mb-0">
            <div className="overflow-hidden rounded-geist-lg border border-unfocused-border-color bg-panel shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_24px_60px_-24px_rgba(0,0,0,0.7)]">
              <Player
                component={Main}
                inputProps={inputProps}
                durationInFrames={totalDurationInFrames}
                fps={VIDEO_FPS}
                compositionHeight={compositionHeight}
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
            <p className="mt-3 text-center font-mono-tabular text-[11px] text-subtitle">
              {VIDEO_WIDTH} × {compositionHeight} · {VIDEO_FPS}fps ·{" "}
              {totalSeconds}s
            </p>
          </div>
        </div>

        <div className="mt-16 border-t border-unfocused-border-color pt-8">
          <Tips></Tips>
        </div>
      </main>
    </div>
  );
};

export default Home;