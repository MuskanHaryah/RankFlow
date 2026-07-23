import React, { forwardRef } from "react";
import { cn } from "../lib/utils";
import { Spacing } from "./Spacing";
import { Spinner } from "./Spinner";

const ButtonForward: React.ForwardRefRenderFunction<
  HTMLButtonElement,
  {
    onClick?: () => void;
    disabled?: boolean;
    children: React.ReactNode;
    loading?: boolean;
    secondary?: boolean;
    compact?: boolean;
  }
> = ({ onClick, disabled, children, loading, secondary, compact }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        "border rounded-geist px-geist-half font-geist font-medium transition-all duration-150 ease-in-out inline-flex items-center appearance-none text-sm cursor-pointer disabled:cursor-not-allowed disabled:bg-button-disabled-color disabled:text-disabled-text-color disabled:border-unfocused-border-color focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
        compact ? "h-9" : "h-10",
        secondary
          ? "bg-panel-raised text-foreground border-unfocused-border-color hover:border-focused-border-color"
          : "bg-accent text-accent-contrast border-accent hover:bg-accent-strong hover:border-accent-strong",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {loading && (
        <>
          <Spinner size={20}></Spinner>
          <Spacing></Spacing>
        </>
      )}
      {children}
    </button>
  );
};

export const Button = forwardRef(ButtonForward);