"use client";

import { useState } from "react";
import { z } from "zod";
import { CompositionProps } from "../../types/constants";
import { AlignEnd } from "./AlignEnd";
import { Button } from "./Button";
import { InputContainer } from "./Container";
import { ErrorComp } from "./Error";
import { Spacing } from "./Spacing";

type EnqueueState =
  | { status: "idle" }
  | { status: "enqueuing" }
  | { status: "queued" }
  | { status: "error"; message: string };

/**
 * Phase 16 — this button now only *enqueues* a render (a near-instant
 * request) rather than blocking on the whole render the way it used to.
 * The actual render happens in the background (see
 * src/server/renderQueue.ts and the RenderQueuePanel this feeds into) —
 * you can click this again for another project immediately, without
 * waiting for the previous render to finish; it'll simply wait its turn
 * in the queue.
 */
export const RenderControls: React.FC<{
  inputProps: z.infer<typeof CompositionProps>;
}> = ({ inputProps }) => {
  const [state, setState] = useState<EnqueueState>({ status: "idle" });

  const allClipsUploaded =
    inputProps.clips.length > 0 &&
    inputProps.clips.every((clip) => !clip.src.startsWith("blob:"));

  const handleRender = async () => {
    setState({ status: "enqueuing" });

    try {
      const response = await fetch("/api/render-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputProps }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not queue the render.");
      }

      setState({ status: "queued" });
      // Back to idle shortly after — "queued" is a brief confirmation, not
      // a status this button should keep showing forever (that's what the
      // Render Queue panel below is for).
      setTimeout(() => setState({ status: "idle" }), 2500);
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not queue the render.",
      });
    }
  };

  return (
    <InputContainer>
      <AlignEnd>
        <Button
          disabled={state.status === "enqueuing" || !allClipsUploaded}
          loading={state.status === "enqueuing"}
          onClick={handleRender}
        >
          {state.status === "enqueuing" ? "Adding to queue…" : "Render video (local)"}
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
      {state.status === "queued" ? (
        <p className="text-sm text-foreground mt-2">
          Added to the render queue below — you can keep editing (or switch
          to a different project) while it renders.
        </p>
      ) : null}
      <Spacing></Spacing>
    </InputContainer>
  );
};