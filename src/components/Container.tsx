import React from "react";

export const InputContainer: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return (
    <div className="flex flex-col gap-1 rounded-geist border border-unfocused-border-color bg-panel p-geist shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_8px_24px_-16px_rgba(0,0,0,0.6)]">
      {children}
    </div>
  );
};