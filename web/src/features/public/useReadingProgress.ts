import { type RefObject, useEffect, useState } from "react";

type ReadingState = { contentKey: string; progress: number; activeHeadingID: string };

export function useReadingProgress(bodyRef: RefObject<HTMLElement | null>, contentKey: string) {
  const [state, setState] = useState<ReadingState>({ contentKey: "", progress: 0, activeHeadingID: "" });

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const headings = Array.from(body.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]"));
    let frame: number | null = null;

    const measure = () => {
      frame = null;
      const bounds = body.getBoundingClientRect();
      // Match the existing anchor offset, including the compact mobile contents bar.
      const readingLine = Number.parseFloat(getComputedStyle(body).scrollMarginTop) || 104;
      const visibleHeight = Math.max(1, window.innerHeight - readingLine);
      const scrollableHeight = bounds.height - visibleHeight;
      const ratio = bounds.height <= 0 ? 0 : scrollableHeight <= 0
        ? Number(bounds.bottom <= window.innerHeight)
        : (readingLine - bounds.top) / scrollableHeight;
      const progress = Math.round(Math.min(1, Math.max(0, ratio)) * 100);

      let activeHeadingID = "";
      if (bounds.height > 0 && bounds.top < window.innerHeight && bounds.bottom > readingLine) {
        for (const heading of headings) {
          const headingTop = heading.getBoundingClientRect().top;
          if (headingTop <= readingLine + 1 || (!activeHeadingID && headingTop < window.innerHeight)) {
            activeHeadingID = heading.id;
          }
        }
      }

      setState((current) => current.contentKey === contentKey && current.progress === progress && current.activeHeadingID === activeHeadingID
        ? current
        : { contentKey, progress, activeHeadingID });
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(body);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    body.addEventListener("load", schedule, true);
    schedule();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      body.removeEventListener("load", schedule, true);
    };
  }, [bodyRef, contentKey]);

  return state.contentKey === contentKey ? state : { progress: 0, activeHeadingID: "" };
}
