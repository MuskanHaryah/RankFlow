"use client";

import { Player, PlayerRef } from "@remotion/player";
import type { NextPage } from "next";
import { useCallback, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  CompositionProps,
  defaultMyCompProps,
  HeaderSchema,
  RankingListStyleSchema,
  STICKER_DEFAULT_DURATION_SECONDS,
  STICKER_DEFAULT_SIZE_PERCENT,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "../../types/constants";
import {
  ClipUploader,
  ClipUploaderHandle,
  Sticker,
  UploadedClip,
} from "../components/ClipUploader";
import { HeaderEditor } from "../components/HeaderEditor";
import { RankingListStyleEditor } from "../components/RankingListStyleEditor";
import { RenderControls } from "../components/RenderControls";
import { Section } from "../components/Section";
import { ThemeToggle } from "../components/ThemeToggle";
import { Tips } from "../components/Tips";
import { getCompositionHeight } from "../remotion/MyComp/headerBackdrop";
import { computeClipRanges, Main } from "../remotion/MyComp/Main";

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

  // Phase 10 — which clip (if any) is currently "armed" for click-to-place
  // sticker placement, and which emoji it'll place. Owned here (not inside
  // ClipUploader) because it's also what the click-catching overlay below
  // needs to know whether to render at all.
  const [stickerPlacementArmedFor, setStickerPlacementArmedFor] = useState<{
    clipId: string;
    emoji: string;
  } | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  // ClipUploader owns its clips as uncontrolled internal state; this ref is
  // the one imperative entry point used to push a newly-placed sticker
  // into it after a click on the preview (see ClipUploaderHandle).
  const clipUploaderRef = useRef<ClipUploaderHandle>(null);

  const handleArmStickerPlacement = useCallback(
    (clipId: string, emoji: string) => {
      // Pausing on arm (rather than leaving autoPlay running) is what
      // makes "click to place" actually land on the frame the person
      // intended — otherwise the video keeps advancing between choosing
      // an emoji and clicking, and the sticker's start time drifts.
      playerRef.current?.pause();
      setStickerPlacementArmedFor({ clipId, emoji });
    },
    [],
  );

  // Only include clips with a real, usable duration — clips still showing
  // "reading duration…" (null) or that failed validation are deliberately
  // left out, rather than letting a bad value corrupt the total.
  const inputProps: z.infer<typeof CompositionProps> = useMemo(() => {
    return {
      clips: uploadedClips
        .filter(
          (
            clip,
          ): clip is UploadedClip & {
            durationInFrames: number;
            trimEndFrame: number;
            sourceDurationInFrames: number;
            sourceWidth: number;
            sourceHeight: number;
          } =>
            clip.durationInFrames !== null &&
            Number.isFinite(clip.durationInFrames) &&
            clip.durationInFrames > 0 &&
            clip.trimEndFrame !== null &&
            clip.sourceDurationInFrames !== null &&
            clip.sourceWidth !== null &&
            clip.sourceHeight !== null,
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
          stickers: clip.stickers,
          trimStartFrame: clip.trimStartFrame,
          trimEndFrame: clip.trimEndFrame,
          sourceDurationInFrames: clip.sourceDurationInFrames,
          sourceWidth: clip.sourceWidth,
          sourceHeight: clip.sourceHeight,
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

  // Phase 10 — the actual "click the preview to place a sticker" handler.
  // Only active while stickerPlacementArmedFor is set (the overlay below
  // isn't even rendered otherwise, so this can't fire by accident).
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!stickerPlacementArmedFor) {
        return;
      }

      // The overlay div is sized to exactly match the Player's own
      // rendered area (see the JSX below), so its own bounding rect *is*
      // the video's visible area — no separate lookup into the Player
      // needed to translate a click into frame-relative percentages.
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.min(
        100,
        Math.max(0, ((e.clientX - rect.left) / rect.width) * 100),
      );
      const y = Math.min(
        100,
        Math.max(0, ((e.clientY - rect.top) / rect.height) * 100),
      );

      const clipRanges = computeClipRanges(inputProps.clips);
      const targetClip = clipRanges.find(
        (clip) => clip.id === stickerPlacementArmedFor.clipId,
      );

      if (!targetClip) {
        // The clip this was armed for no longer exists (e.g. removed
        // while placement was armed) — quietly disarm rather than place a
        // sticker on nothing.
        setStickerPlacementArmedFor(null);
        return;
      }

      const clipDurationInFrames = targetClip.to - targetClip.from;
      const absoluteFrame =
        playerRef.current?.getCurrentFrame() ?? targetClip.from;
      // Clip-relative, and clamped into this clip's own range — if the
      // playhead happens to be sitting on a different clip than the one
      // being placed on, default to that clip's own start rather than a
      // frame number that wouldn't make sense for it.
      const clipRelativeFrame = Math.min(
        Math.max(absoluteFrame - targetClip.from, 0),
        Math.max(clipDurationInFrames - 1, 0),
      );

      const defaultDurationInFrames = Math.max(
        1,
        Math.min(
          Math.round(STICKER_DEFAULT_DURATION_SECONDS * VIDEO_FPS),
          clipDurationInFrames,
        ),
      );
      const startFrame = Math.min(
        clipRelativeFrame,
        Math.max(0, clipDurationInFrames - defaultDurationInFrames),
      );
      const endFrame = Math.min(
        startFrame + defaultDurationInFrames,
        clipDurationInFrames,
      );

      const sticker: Sticker = {
        id: crypto.randomUUID(),
        emoji: stickerPlacementArmedFor.emoji,
        x,
        y,
        size: STICKER_DEFAULT_SIZE_PERCENT,
        startFrame,
        endFrame,
      };

      clipUploaderRef.current?.addSticker(
        stickerPlacementArmedFor.clipId,
        sticker,
      );
      setStickerPlacementArmedFor(null);
    },
    [stickerPlacementArmedFor, inputProps.clips],
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
                ref={clipUploaderRef}
                onClipsChange={setUploadedClips}
                rankingListStyle={rankingListStyle}
                stickerPlacementArmedFor={stickerPlacementArmedFor?.clipId ?? null}
                onArmStickerPlacement={handleArmStickerPlacement}
              />
            </Section>
            <Section label="Export" description="Render the final video locally" defaultOpen={false}>
              <RenderControls inputProps={inputProps}></RenderControls>
            </Section>
          </div>

          {/* Preview — pinned on the right on desktop, on top on mobile
              (matching where it already sat before this layout change) */}
          <div className="order-1 mb-8 lg:sticky lg:top-[88px] lg:order-2 lg:mb-0">
            <div className="relative overflow-hidden rounded-geist-lg border border-unfocused-border-color bg-panel shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_24px_60px_-24px_rgba(0,0,0,0.7)]">
              <Player
                ref={playerRef}
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
              {stickerPlacementArmedFor ? (
                <div
                  onClick={handlePreviewClick}
                  className="absolute inset-0 cursor-crosshair flex items-start justify-center"
                >
                  <div className="mt-4 flex items-center gap-2 bg-black/75 text-white text-sm px-3 py-1.5 rounded-geist">
                    <span>
                      Click anywhere on the video to place{" "}
                      {stickerPlacementArmedFor.emoji}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStickerPlacementArmedFor(null);
                      }}
                      className="underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
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