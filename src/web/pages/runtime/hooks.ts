import { useEffect, useState } from "react";
import { RUNTIME_CHART_FRAME_MS } from "./constants";

export function useRuntimeNow() {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let frameId: number | null = null;
    let previousFrameMs = 0;

    const tick = (frameMs: number) => {
      if (frameMs - previousFrameMs >= RUNTIME_CHART_FRAME_MS) {
        previousFrameMs = frameMs;
        setNowMs(Date.now());
      }
      frameId = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (frameId !== null) {
        return;
      }
      previousFrameMs = 0;
      frameId = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frameId === null) {
        return;
      }
      window.cancelAnimationFrame(frameId);
      frameId = null;
    };

    const syncVisibleTime = () => {
      if (document.visibilityState === "visible") {
        setNowMs(Date.now());
        start();
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", syncVisibleTime);
    syncVisibleTime();
    return () => {
      document.removeEventListener("visibilitychange", syncVisibleTime);
      stop();
    };
  }, []);

  return nowMs;
}
