"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { defaultMyCompProps, GlobalCropSchema } from "../../types/constants";
import { z } from "zod";

const MAX_INSET = 45;

type GlobalCrop = z.infer<typeof GlobalCropSchema>;

/**
 * Phase 11 (extended) — crops the entire final composited video (every
 * clip, the ranking list, the header — everything), as opposed to
 * ClipUploader's per-clip crop which only affects one clip's own footage.
 *
 * Deliberately no drag-box preview here, unlike the per-clip cropper: the
 * live Player preview in page.tsx already renders Main.tsx with this
 * exact crop applied in real time (Main.tsx is the single source of truth
 * both the export and the preview use), so dragging these sliders already
 * shows the real result directly — a separate mock preview would just be
 * a second, potentially-drifting copy of the same thing.
 */
export type GlobalCropEditorHandle = {
  loadCrop: (crop: GlobalCrop) => void;
};

export const GlobalCropEditor = forwardRef<
  GlobalCropEditorHandle,
  {
    onCropChange?: (crop: GlobalCrop) => void;
  }
>(({ onCropChange }, ref) => {
  const [top, setTop] = useState(defaultMyCompProps.globalCrop.top);
  const [bottom, setBottom] = useState(defaultMyCompProps.globalCrop.bottom);
  const [left, setLeft] = useState(defaultMyCompProps.globalCrop.left);
  const [right, setRight] = useState(defaultMyCompProps.globalCrop.right);

  const isCropped = top > 0 || bottom > 0 || left > 0 || right > 0;

  useEffect(() => {
    onCropChange?.({ top, bottom, left, right });
  }, [top, bottom, left, right, onCropChange]);

  useImperativeHandle(
    ref,
    () => ({
      loadCrop: (crop) => {
        setTop(crop.top);
        setBottom(crop.bottom);
        setLeft(crop.left);
        setRight(crop.right);
      },
    }),
    [],
  );

  // Clamps a single edge to [0, MAX_INSET] and also against its opposite
  // edge so the two never sum past 90 (leaving at least 10% width/height
  // of the final canvas visible) — same invariant as the per-clip crop.
  const setEdge = useCallback(
    (edge: "top" | "bottom" | "left" | "right", value: number) => {
      const clamp = (v: number, opposite: number) =>
        Math.max(0, Math.min(MAX_INSET, Math.min(90 - opposite, v)));
      if (edge === "top") setTop(clamp(value, bottom));
      else if (edge === "bottom") setBottom(clamp(value, top));
      else if (edge === "left") setLeft(clamp(value, right));
      else setRight(clamp(value, left));
    },
    [top, bottom, left, right],
  );

  const resetAll = () => {
    setTop(0);
    setBottom(0);
    setLeft(0);
    setRight(0);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm text-foreground">
          Final video crop (applies to everything — every clip, the ranking
          list, the header)
        </p>
        <p className="mt-1 text-xs text-subtitle">
          Separate from each clip&apos;s own crop above — this crops the
          whole composited result. The preview on the right updates live as
          you drag.
        </p>
      </div>

      <div className="flex items-center justify-between text-[11px] text-subtitle">
        <span>4 independent edges, same as the per-clip cropper</span>
        {isCropped ? (
          <button
            type="button"
            onClick={resetAll}
            className="text-accent hover:underline"
          >
            Reset crop
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:max-w-sm">
        <label className="flex items-center gap-1.5 text-xs text-subtitle">
          Top
          <input
            type="range"
            min={0}
            max={MAX_INSET}
            value={top}
            onChange={(e) => setEdge("top", Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono-tabular w-9">{top.toFixed(0)}%</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-subtitle">
          Bottom
          <input
            type="range"
            min={0}
            max={MAX_INSET}
            value={bottom}
            onChange={(e) => setEdge("bottom", Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono-tabular w-9">{bottom.toFixed(0)}%</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-subtitle">
          Left
          <input
            type="range"
            min={0}
            max={MAX_INSET}
            value={left}
            onChange={(e) => setEdge("left", Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono-tabular w-9">{left.toFixed(0)}%</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-subtitle">
          Right
          <input
            type="range"
            min={0}
            max={MAX_INSET}
            value={right}
            onChange={(e) => setEdge("right", Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono-tabular w-9">{right.toFixed(0)}%</span>
        </label>
      </div>
    </div>
  );
});

GlobalCropEditor.displayName = "GlobalCropEditor";