import React from "react";

/**
 * The organizing unit for the whole left column: a labeled, collapsible
 * panel built on native <details>/<summary> (free keyboard support, no
 * extra JS state to wire up). Collapsing sections you're not touching
 * right now is what keeps a page with this many controls from reading as
 * one long undifferentiated stack.
 *
 * Purely presentational — doesn't wrap children in anything that affects
 * their own layout/behavior; each panel still owns its own state and
 * onChange wiring exactly as before.
 */
export const Section: React.FC<{
  label: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ label, description, defaultOpen = true, children }) => {
  return (
    <details className="section-details" open={defaultOpen}>
      <summary className="section-summary">
        <svg
          className="section-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 1.5L7.5 5L3 8.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="flex flex-col">
          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
            {label}
          </span>
          {description ? (
            <span className="text-xs text-subtitle">{description}</span>
          ) : null}
        </span>
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
};