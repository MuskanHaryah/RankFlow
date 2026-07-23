import React from "react";

/**
 * A lightweight vertical layout wrapper for the fields inside a Section.
 * Deliberately has no border/background of its own — the Section it sits
 * inside already provides that card chrome, so this just standardizes the
 * gap between fields and keeps each panel's markup free of repeated
 * spacing utility classes.
 */
export const InputContainer: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return <div className="flex flex-col gap-4">{children}</div>;
};