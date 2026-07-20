import { z } from "zod";
import { HeaderSchema, VIDEO_WIDTH } from "../../../types/constants";

type HeaderProps = z.infer<typeof HeaderSchema>;
type HeaderWords = HeaderProps["words"];

/**
 * Matches the lineHeight the header text is actually rendered with in
 * Main.tsx's <Header> component. Kept as a shared constant rather than a
 * literal in two places — if these ever disagreed, the estimated backdrop
 * height would silently stop matching the real rendered text height.
 */
export const HEADER_LINE_HEIGHT = 1.2;

/**
 * Matches <Header>'s own left/right padding (60px each side) in Main.tsx,
 * so the width available for line-wrap estimation is calculated against
 * the same on-canvas area the text actually wraps within.
 */
export const HEADER_HORIZONTAL_PADDING = 60;

/**
 * Matches <Header>'s own top padding (space above the first line) in
 * Main.tsx, so the backdrop starts exactly where the text's box starts.
 */
export const HEADER_TOP_PADDING = 70;

/**
 * Extra breathing room below the lowest line of text before the shade
 * bar ends, so text never sits flush against the bottom edge of its own
 * backdrop.
 */
export const HEADER_BOTTOM_PADDING = 40;

/**
 * Rough average glyph width as a fraction of font size, for a bold (900)
 * sans-serif face. This is a heuristic estimate rather than a real DOM
 * measurement — Root.tsx's calculateMetadata() (used for extendCanvas in
 * part 2) runs before any component mounts, so no ref/getBoundingClientRect
 * is available there, and using a formula everywhere (rather than a real
 * measurement in some places and a formula in others) is what keeps every
 * call site in agreement. It deliberately leans slightly wide, so a
 * backdrop is very rarely too short — at most a little taller than
 * strictly necessary.
 */
const AVG_CHAR_WIDTH_RATIO = 0.62;

/**
 * Splits the flat word list into lines wherever a word is flagged
 * lineBreakAfter — the same manual-line-break logic <Header> in Main.tsx
 * uses to actually render lines.
 */
const splitIntoManualLines = (words: HeaderWords): HeaderWords[] => {
  const lines: HeaderWords[] = [];
  let current: HeaderWords = [];
  for (const headerWord of words) {
    current.push(headerWord);
    if (headerWord.lineBreakAfter) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
};

/**
 * Estimates how many *visual* lines the header will render as, accounting
 * both for manual line breaks and for the browser's natural wrapping when
 * a manual line is too wide for the canvas at the current font size.
 */
export const estimateHeaderLineCount = (
  header: Pick<HeaderProps, "words" | "fontSize">,
  canvasWidth: number = VIDEO_WIDTH,
): number => {
  if (header.words.length === 0) {
    return 0;
  }

  const availableWidth = Math.max(
    canvasWidth - HEADER_HORIZONTAL_PADDING * 2,
    1,
  );
  const avgCharWidth = header.fontSize * AVG_CHAR_WIDTH_RATIO;

  return splitIntoManualLines(header.words).reduce((total, lineWords) => {
    const charCount =
      lineWords.reduce((sum, w) => sum + w.word.length, 0) +
      Math.max(lineWords.length - 1, 0); // spaces between words
    const estimatedLineWidth = charCount * avgCharWidth;
    const wrappedSubLines = Math.max(
      1,
      Math.ceil(estimatedLineWidth / availableWidth),
    );
    return total + wrappedSubLines;
  }, 0);
};

/** Pure text height (no padding), in px, for the given header + canvas width. */
export const estimateHeaderTextHeight = (
  header: Pick<HeaderProps, "words" | "fontSize">,
  canvasWidth: number = VIDEO_WIDTH,
): number => {
  const lineCount = estimateHeaderLineCount(header, canvasWidth);
  return lineCount * header.fontSize * HEADER_LINE_HEIGHT;
};

/**
 * Auto-measured backdrop height: top padding + text height + bottom
 * padding. This is the "never a fixed guessed number" baseline — the
 * manual shade-extension slider (headerBackdropShadeExtraHeight) is added
 * on top of this by the caller, it does not replace it. Returns 0 when
 * there's no header text at all, so callers can skip the backdrop
 * entirely.
 */
export const estimateHeaderBackdropHeight = (
  header: Pick<HeaderProps, "words" | "fontSize">,
  canvasWidth: number = VIDEO_WIDTH,
): number => {
  if (header.words.length === 0) {
    return 0;
  }
  const textHeight = estimateHeaderTextHeight(header, canvasWidth);
  return Math.round(HEADER_TOP_PADDING + textHeight + HEADER_BOTTOM_PADDING);
};

/**
 * Final shade-bar height actually rendered: the auto-measured height plus
 * the person's manual "extend downward" amount, floored at 0 so a
 * negative slider value (shouldn't happen given the UI's min, but kept
 * defensive) can never invert the bar. Returns 0 whenever there's no
 * header text, matching estimateHeaderBackdropHeight.
 */
export const getShadeBackdropHeight = (
  header: Pick<
    HeaderProps,
    "words" | "fontSize" | "headerBackdropShadeExtraHeight"
  >,
  canvasWidth: number = VIDEO_WIDTH,
): number => {
  const autoHeight = estimateHeaderBackdropHeight(header, canvasWidth);
  if (autoHeight === 0) {
    return 0;
  }
  return Math.max(0, autoHeight + header.headerBackdropShadeExtraHeight);
};