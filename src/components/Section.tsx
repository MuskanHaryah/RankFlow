import React from "react";

/**
 * Purely presentational — adds a small labeled heading above a control
 * panel so the left column reads as clearly separated sections instead of
 * one long stack of identical-looking cards. Doesn't wrap the child in
 * anything that affects layout/behavior; each panel below still owns its
 * own InputContainer, its own state, and its own onChange wiring exactly
 * as before.
 */
export const Section: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtitle">
        <span
          className="h-[3px] w-[3px] rounded-full bg-accent"
          aria-hidden="true"
        />
        {label}
      </h2>
      {children}
    </section>
  );
};