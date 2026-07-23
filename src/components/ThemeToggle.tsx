"use client";

import React, { useEffect, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "rankflow-theme";

/**
 * A single sliding switch rather than two separate buttons — the thumb
 * itself crossfades between a moon (plus a few twinkling stars in the
 * track) and a sun as the theme flips. All of the actual animation lives
 * in global.css, driven off the `data-theme` attribute this sets on
 * <html>; this component only owns the click handler, persistence, and
 * the aria-checked state for accessibility.
 *
 * The initial theme is applied before hydration by an inline script in
 * layout.tsx (so there's no flash of the wrong theme on load) — this
 * component just reads what that script already set once it mounts.
 */
export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private browsing, blocked cookies) —
      // the toggle still works for the current tab, it just won't persist.
    }
  };

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      role="switch"
      aria-checked={isLight}
      aria-label={
        isLight ? "Switch to dark theme" : "Switch to light theme"
      }
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      className="theme-toggle"
    >
      <span className="theme-toggle-track">
        <span className="theme-toggle-stars" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
        <span className="theme-toggle-thumb">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="theme-toggle-icon is-moon"
          >
            <path
              d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"
              fill="currentColor"
            />
          </svg>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="theme-toggle-icon is-sun"
          >
            <circle cx="12" cy="12" r="4.5" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 2v2.2" />
              <path d="M12 19.8V22" />
              <path d="M4.2 4.2l1.6 1.6" />
              <path d="M18.2 18.2l1.6 1.6" />
              <path d="M2 12h2.2" />
              <path d="M19.8 12H22" />
              <path d="M4.2 19.8l1.6-1.6" />
              <path d="M18.2 5.8l1.6-1.6" />
            </g>
          </svg>
        </span>
      </span>
    </button>
  );
};