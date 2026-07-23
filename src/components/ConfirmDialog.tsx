"use client";

import React, { useEffect } from "react";

/**
 * A themed confirm/cancel modal. Backdrop click and Escape both act as
 * cancel — deleting something should never be the "accidental" action.
 */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-geist border border-unfocused-border-color bg-panel p-geist shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_24px_60px_-24px_rgba(0,0,0,0.7)]"
      >
        <h3
          id="confirm-dialog-title"
          className="text-sm font-semibold text-foreground"
        >
          {title}
        </h3>
        {description ? (
          <p className="mt-2 text-sm leading-relaxed text-subtitle">
            {description}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-geist border border-unfocused-border-color bg-panel-raised px-3 py-1.5 text-sm font-medium text-foreground transition-colors duration-150 hover:border-focused-border-color"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-geist border border-geist-error bg-geist-error px-3 py-1.5 text-sm font-medium text-white transition-opacity duration-150 hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};