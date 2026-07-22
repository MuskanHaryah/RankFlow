import React, { useMemo } from "react";

export const ProgressBar: React.FC<{
  progress: number;
}> = ({ progress }) => {
  const fill: React.CSSProperties = useMemo(() => {
    return {
      width: `${progress * 100}%`,
    };
  }, [progress]);

  return (
    <div>
      <div className="w-full h-2 rounded-full appearance-none bg-panel-raised border border-unfocused-border-color mt-2.5 mb-6 overflow-hidden">
        <div
          className="bg-accent h-full rounded-full transition-all ease-in-out duration-100"
          style={fill}
        ></div>
      </div>
    </div>
  );
};