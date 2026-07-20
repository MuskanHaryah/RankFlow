"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { HeaderSchema } from "../../types/constants";
import { InputContainer } from "./Container";

type HeaderWord = z.infer<typeof HeaderSchema>["words"][number];
type HeaderDurationMode = z.infer<typeof HeaderSchema>["durationMode"];

const DEFAULT_WORD_COLOR = "#ffffff";
const DEFAULT_FONT_SIZE = 56;
const MIN_FONT_SIZE = 24;
const MAX_FONT_SIZE = 96;

// Phase 8, part 1 — shade backdrop defaults/ranges. Opacity default matches
// the near-opaque flat black bar look of the reference design. Extra height
// is a manual "push the bar further down" override on top of the
// auto-measured height, for a lengthy header or just stylistic preference.
const DEFAULT_SHADE_OPACITY = 0.85;
const MIN_SHADE_OPACITY = 0;
const MAX_SHADE_OPACITY = 1;
const SHADE_OPACITY_STEP = 0.01;
const DEFAULT_SHADE_EXTRA_HEIGHT = 0;
const MIN_SHADE_EXTRA_HEIGHT = 0;
const MAX_SHADE_EXTRA_HEIGHT = 400;

/**
 * A one-time title for the whole video (distinct from the per-clip ranking
 * list). Typing a sentence splits it into individually-colored words —
 * clicking a word's swatch opens a native color picker for just that word,
 * and clicking a word's "↵" button forces a line break immediately after
 * it, independent of wherever the browser would naturally wrap the text.
 * A font-size slider resizes the whole header (it's one continuous title,
 * so this is a single project-level value, not per-word).
 *
 * Colors and line breaks are preserved by position as you keep typing, so
 * adding a word at the end doesn't reset choices you already made for the
 * words before it. If you delete/insert a word in the middle, everything
 * after that point re-aligns positionally — same tradeoff every plain-
 * text-editor-with-per-token-styling has, and simplest to reason about.
 */
export const HeaderEditor: React.FC<{
  onHeaderChange?: (header: z.infer<typeof HeaderSchema>) => void;
}> = ({ onHeaderChange }) => {
  const [headerText, setHeaderText] = useState("");
  const [words, setWords] = useState<HeaderWord[]>([]);
  const [durationMode, setDurationMode] =
    useState<HeaderDurationMode>("persistent");
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  // Phase 8, part 1 — only "shade" is wired up right now (see
  // headerBackdrop.ts / Main.tsx); the mode is fixed rather than exposed as
  // a selector until "extendCanvas" is built in part 2.
  const [shadeOpacity, setShadeOpacity] = useState(DEFAULT_SHADE_OPACITY);
  const [shadeExtraHeight, setShadeExtraHeight] = useState(
    DEFAULT_SHADE_EXTRA_HEIGHT,
  );

  // Same pattern as ClipUploader's onClipsChange: notify the parent via an
  // effect keyed on the actual state, not inline on every keystroke handler.
  // Safe as long as the parent passes a stable callback (e.g. a useState
  // setter directly) rather than a new inline function every render.
  useEffect(() => {
    onHeaderChange?.({
      words,
      durationMode,
      fontSize,
      headerBackdropMode: "shade",
      headerBackdropShadeOpacity: shadeOpacity,
      headerBackdropShadeExtraHeight: shadeExtraHeight,
    });
  }, [
    words,
    durationMode,
    fontSize,
    shadeOpacity,
    shadeExtraHeight,
    onHeaderChange,
  ]);

  const handleTextChange = useCallback((value: string) => {
    setHeaderText(value);
    const rawWords = value.trim().length === 0 ? [] : value.trim().split(/\s+/);
    setWords((prevWords) =>
      rawWords.map((word, i) => ({
        word,
        color: prevWords[i]?.color ?? DEFAULT_WORD_COLOR,
        lineBreakAfter: prevWords[i]?.lineBreakAfter ?? false,
      })),
    );
  }, []);

  const handleColorChange = useCallback((index: number, color: string) => {
    setWords((prevWords) =>
      prevWords.map((w, i) => (i === index ? { ...w, color } : w)),
    );
  }, []);

  const handleToggleLineBreak = useCallback((index: number) => {
    setWords((prevWords) =>
      prevWords.map((w, i) =>
        i === index ? { ...w, lineBreakAfter: !w.lineBreakAfter } : w,
      ),
    );
  }, []);

  return (
    <InputContainer>
      <label htmlFor="header-text" className="text-sm font-medium mb-2">
        Header (one-time title for the whole video)
      </label>
      <input
        id="header-text"
        type="text"
        value={headerText}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder="Ranking Wholesome Story Time Vines"
        className="leading-[1.7] block w-full rounded-geist bg-background p-geist-half text-foreground text-sm border border-unfocused-border-color transition-colors duration-150 ease-in-out focus:border-focused-border-color outline-none mb-3"
      />

      {words.length > 0 ? (
        <>
          <p className="text-sm text-subtitle mb-2">
            Click a word&apos;s swatch for its own color. Click ↵ to force a
            line break right after that word.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {words.map((w, i) => (
              <div
                key={i}
                className="flex items-center gap-1 border border-unfocused-border-color rounded-geist px-2 py-1 text-sm bg-background"
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="color"
                    value={w.color}
                    onChange={(e) => handleColorChange(i, e.target.value)}
                    className="w-6 h-6 p-0 border-none bg-transparent cursor-pointer"
                  />
                  <span style={{ color: w.color }}>{w.word}</span>
                </label>
                <button
                  type="button"
                  onClick={() => handleToggleLineBreak(i)}
                  title={
                    w.lineBreakAfter
                      ? "Line break after this word (click to remove)"
                      : "Force a line break after this word"
                  }
                  className={`ml-1 px-1.5 rounded-geist text-xs leading-none ${
                    w.lineBreakAfter
                      ? "bg-foreground text-background"
                      : "text-subtitle border border-unfocused-border-color"
                  }`}
                >
                  ↵
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <label className="text-sm text-subtitle">Font size</label>
            <input
              type="range"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-subtitle w-10">{fontSize}px</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <label className="text-sm text-subtitle">Shade darkness</label>
            <input
              type="range"
              min={MIN_SHADE_OPACITY}
              max={MAX_SHADE_OPACITY}
              step={SHADE_OPACITY_STEP}
              value={shadeOpacity}
              onChange={(e) => setShadeOpacity(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-subtitle w-10">
              {Math.round(shadeOpacity * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <label className="text-sm text-subtitle">
              Extend shade downward
            </label>
            <input
              type="range"
              min={MIN_SHADE_EXTRA_HEIGHT}
              max={MAX_SHADE_EXTRA_HEIGHT}
              value={shadeExtraHeight}
              onChange={(e) => setShadeExtraHeight(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-subtitle w-14">
              {shadeExtraHeight}px
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-subtitle">Show header</label>
            <select
              value={durationMode}
              onChange={(e) =>
                setDurationMode(e.target.value as HeaderDurationMode)
              }
              className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
            >
              <option value="persistent">Persistent (whole video)</option>
              <option value="firstTwoSeconds">First 2 seconds only</option>
            </select>
          </div>
        </>
      ) : null}
    </InputContainer>
  );
};