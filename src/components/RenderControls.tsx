"use client";

import { useState } from "react";
import { z } from "zod";
import { CompositionProps } from "../../types/constants";
import { AlignEnd } from "./AlignEnd";
import { Button } from "./Button";
import { InputContainer } from "./Container";
import { ErrorComp } from "./Error";
import { Spacing } from "./Spacing";

type RenderState =
  | { status: "idle" }
  | { status: "rendering" }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

export const RenderControls: React.FC<{
  inputProps: z.infer<typeof CompositionProps>;
}> = ({ inputProps }) => {
  const [state, setState] = useState<RenderState>({ status: "idle" });

  const allClipsUploaded =
    inputProps.clips.length > 0 &&
    inputProps.clips.every((clip) => !clip.src.startsWith("blob:"));

  const handleRender = async () => {
    setState({ status: "rendering" });

    try {
      const response = await fetch("/api/render-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputProps }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Render failed.");
      }

      setState({ status: "done", url: data.url });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Render failed.",
      });
    }
  };

  return (
    <InputContainer>
      <AlignEnd>
        <Button
          disabled={state.status === "rendering" || !allClipsUploaded}
          loading={state.status === "rendering"}
          onClick={handleRender}
        >
          {state.status === "rendering"
            ? "Rendering… (this can take a few minutes)"
            : "Render video (local)"}
        </Button>
      </AlignEnd>
      {!allClipsUploaded && inputProps.clips.length > 0 ? (
        <p className="text-sm text-subtitle mt-2">
          Waiting for every clip to finish uploading to the server before you
          can render.
        </p>
      ) : null}
      {state.status === "error" ? (
        <ErrorComp message={state.message}></ErrorComp>
      ) : null}
      {state.status === "done" ? (
        <p className="text-sm text-foreground mt-2">
          Done!{" "}
          <a
            className="underline"
            href={state.url}
            target="_blank"
            rel="noreferrer"
          >
            Open your rendered video
          </a>
        </p>
      ) : null}
      <Spacing></Spacing>
    </InputContainer>
  );
};