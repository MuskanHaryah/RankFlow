"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { defaultRankingListStyle, RankingListStyleSchema } from "../../types/constants";
import { InputContainer } from "./Container";
import { FONT_FAMILY_OPTIONS, FONT_WEIGHT_OPTIONS } from "./ClipUploader";

type RankingListStyle = z.infer<typeof RankingListStyleSchema>;

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const SCALE_STEP = 0.05;

const MIN_VERTICAL_OFFSET = -400;
const MAX_VERTICAL_OFFSET = 400;
// A small step is what makes dragging this feel like nudging the list
// "a little by little" rather than jumping to a new spot.
const VERTICAL_OFFSET_STEP = 5;
const VERTICAL_OFFSET_NUDGE = 10;

const MIN_BORDER_WIDTH = 1;
const MAX_BORDER_WIDTH = 20;

/**
 * Project-level defaults for the ranking list's badge (number/emoji) and
 * title styling — size, font, color, and border. Any individual clip can
 * still override these for just itself (see ClipUploader's
 * RankStyleOverrideEditor); this is the shared baseline every clip uses
 * unless it does that.
 */
export const RankingListStyleEditor: React.FC<{
  onStyleChange?: (style: RankingListStyle) => void;
}> = ({ onStyleChange }) => {
  const [scale, setScale] = useState(defaultRankingListStyle.scale);
  const [badgeScale, setBadgeScale] = useState(
    defaultRankingListStyle.badgeScale,
  );
  const [titleScale, setTitleScale] = useState(
    defaultRankingListStyle.titleScale,
  );
  const [verticalOffset, setVerticalOffset] = useState(
    defaultRankingListStyle.verticalOffset,
  );

  const [badgeColor, setBadgeColor] = useState(
    defaultRankingListStyle.badgeColor,
  );
  const [badgeFontFamily, setBadgeFontFamily] = useState(
    defaultRankingListStyle.badgeFontFamily,
  );
  const [badgeFontWeight, setBadgeFontWeight] = useState(
    defaultRankingListStyle.badgeFontWeight,
  );
  const [badgeBorderEnabled, setBadgeBorderEnabled] = useState(
    defaultRankingListStyle.badgeBorderEnabled,
  );
  const [badgeBorderColor, setBadgeBorderColor] = useState(
    defaultRankingListStyle.badgeBorderColor,
  );
  const [badgeBorderWidth, setBadgeBorderWidth] = useState(
    defaultRankingListStyle.badgeBorderWidth,
  );

  const [titleColor, setTitleColor] = useState(
    defaultRankingListStyle.titleColor,
  );
  const [titleFontFamily, setTitleFontFamily] = useState(
    defaultRankingListStyle.titleFontFamily,
  );
  const [titleFontWeight, setTitleFontWeight] = useState(
    defaultRankingListStyle.titleFontWeight,
  );
  const [titleBorderEnabled, setTitleBorderEnabled] = useState(
    defaultRankingListStyle.titleBorderEnabled,
  );
  const [titleBorderColor, setTitleBorderColor] = useState(
    defaultRankingListStyle.titleBorderColor,
  );
  const [titleBorderWidth, setTitleBorderWidth] = useState(
    defaultRankingListStyle.titleBorderWidth,
  );

  // Same lifted-state pattern as HeaderEditor: this component owns the
  // actual editing state and reports the current value up on every change.
  useEffect(() => {
    onStyleChange?.({
      scale,
      badgeScale,
      titleScale,
      verticalOffset,
      badgeColor,
      badgeFontFamily,
      badgeFontWeight,
      badgeBorderEnabled,
      badgeBorderColor,
      badgeBorderWidth,
      titleColor,
      titleFontFamily,
      titleFontWeight,
      titleBorderEnabled,
      titleBorderColor,
      titleBorderWidth,
    });
  }, [
    scale,
    badgeScale,
    titleScale,
    verticalOffset,
    badgeColor,
    badgeFontFamily,
    badgeFontWeight,
    badgeBorderEnabled,
    badgeBorderColor,
    badgeBorderWidth,
    titleColor,
    titleFontFamily,
    titleFontWeight,
    titleBorderEnabled,
    titleBorderColor,
    titleBorderWidth,
    onStyleChange,
  ]);

  const nudgeVerticalOffset = useCallback((delta: number) => {
    setVerticalOffset((prev) =>
      Math.max(
        MIN_VERTICAL_OFFSET,
        Math.min(MAX_VERTICAL_OFFSET, prev + delta),
      ),
    );
  }, []);

  return (
    <InputContainer>
      <label className="text-sm font-medium">
        Ranking list style (applies to every rank unless a clip overrides it)
      </label>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtitle">
          Size
        </p>
        <div className="field-row">
          <label className="field-row-label">Whole list (numbers + titles)</label>
          <div className="field-row-controls">
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={SCALE_STEP}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-subtitle font-mono-tabular w-12">
              {Math.round(scale * 100)}%
            </span>
          </div>
        </div>
        <div className="field-row">
          <label className="field-row-label">Numbers only</label>
          <div className="field-row-controls">
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={SCALE_STEP}
              value={badgeScale}
              onChange={(e) => setBadgeScale(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-subtitle font-mono-tabular w-12">
              {Math.round(badgeScale * 100)}%
            </span>
          </div>
        </div>
        <div className="field-row">
          <label className="field-row-label">Titles only</label>
          <div className="field-row-controls">
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={SCALE_STEP}
              value={titleScale}
              onChange={(e) => setTitleScale(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-subtitle font-mono-tabular w-12">
              {Math.round(titleScale * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-unfocused-border-color pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtitle">
          Position
        </p>
        <div className="field-row">
          <label className="field-row-label">Move up/down</label>
          <div className="field-row-controls">
            <button
              type="button"
              onClick={() => nudgeVerticalOffset(-VERTICAL_OFFSET_NUDGE)}
              title="Nudge up"
              className="px-2 py-1 text-xs rounded-geist border border-unfocused-border-color text-subtitle hover:border-focused-border-color"
            >
              ▲
            </button>
            <input
              type="range"
              min={MIN_VERTICAL_OFFSET}
              max={MAX_VERTICAL_OFFSET}
              step={VERTICAL_OFFSET_STEP}
              value={verticalOffset}
              onChange={(e) => setVerticalOffset(Number(e.target.value))}
              className="w-40"
            />
            <button
              type="button"
              onClick={() => nudgeVerticalOffset(VERTICAL_OFFSET_NUDGE)}
              title="Nudge down"
              className="px-2 py-1 text-xs rounded-geist border border-unfocused-border-color text-subtitle hover:border-focused-border-color"
            >
              ▼
            </button>
            <span className="text-sm text-subtitle font-mono-tabular w-16">
              {verticalOffset}px
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-unfocused-border-color pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtitle">
          Numbers — default style
        </p>
        <div className="flex flex-wrap items-center gap-2 control-group">
          <input
            type="color"
            value={badgeColor}
            onChange={(e) => setBadgeColor(e.target.value)}
            title="Number color"
            className="w-8 h-8 border border-unfocused-border-color rounded-geist"
          />
          <select
            value={badgeFontFamily}
            onChange={(e) => setBadgeFontFamily(e.target.value)}
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={badgeFontWeight}
            onChange={(e) => setBadgeFontWeight(Number(e.target.value))}
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            {FONT_WEIGHT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={badgeBorderEnabled ? "bordered" : "none"}
            onChange={(e) =>
              setBadgeBorderEnabled(e.target.value === "bordered")
            }
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            <option value="none">No border</option>
            <option value="bordered">Bordered</option>
          </select>
          {badgeBorderEnabled ? (
            <>
              <input
                type="color"
                value={badgeBorderColor}
                onChange={(e) => setBadgeBorderColor(e.target.value)}
                title="Number border color"
                className="w-8 h-8 border border-unfocused-border-color rounded-geist"
              />
              <input
                type="number"
                min={MIN_BORDER_WIDTH}
                max={MAX_BORDER_WIDTH}
                value={badgeBorderWidth}
                onChange={(e) => setBadgeBorderWidth(Number(e.target.value))}
                title="Number border thickness (px)"
                className="w-14 text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-unfocused-border-color pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtitle">
          Titles — default style
        </p>
        <div className="flex flex-wrap items-center gap-2 control-group">
          <input
            type="color"
            value={titleColor}
            onChange={(e) => setTitleColor(e.target.value)}
            title="Title color"
            className="w-8 h-8 border border-unfocused-border-color rounded-geist"
          />
          <select
            value={titleFontFamily}
            onChange={(e) => setTitleFontFamily(e.target.value)}
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={titleFontWeight}
            onChange={(e) => setTitleFontWeight(Number(e.target.value))}
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            {FONT_WEIGHT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={titleBorderEnabled ? "bordered" : "none"}
            onChange={(e) =>
              setTitleBorderEnabled(e.target.value === "bordered")
            }
            className="text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
          >
            <option value="none">No border</option>
            <option value="bordered">Bordered</option>
          </select>
          {titleBorderEnabled ? (
            <>
              <input
                type="color"
                value={titleBorderColor}
                onChange={(e) => setTitleBorderColor(e.target.value)}
                title="Title border color"
                className="w-8 h-8 border border-unfocused-border-color rounded-geist"
              />
              <input
                type="number"
                min={MIN_BORDER_WIDTH}
                max={MAX_BORDER_WIDTH}
                value={titleBorderWidth}
                onChange={(e) => setTitleBorderWidth(Number(e.target.value))}
                title="Title border thickness (px)"
                className="w-14 text-sm bg-background border border-unfocused-border-color rounded-geist px-2 py-1 text-foreground"
              />
            </>
          ) : null}
        </div>
      </div>
    </InputContainer>
  );
};