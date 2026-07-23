import React from "react";

export const ErrorComp: React.FC<{
  message: string;
}> = ({ message }) => {
  return (
    <div className="flex items-start gap-1.5 rounded-geist border border-geist-error/30 bg-geist-error/10 px-geist-half py-2 text-sm text-geist-error font-geist">
      <svg
        fill="none"
        shapeRendering="geometricPrecision"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        className="h-4 w-4 mt-0.5 shrink-0"
      >
        <circle cx="12" cy="12" r="10" fill="var(--panel-raised)"></circle>
        <path d="M12 8v4" stroke="currentColor"></path>
        <path d="M12 16h.01" stroke="currentColor"></path>
      </svg>
      <span>
        <strong>Error:</strong> {message}
      </span>
    </div>
  );
};