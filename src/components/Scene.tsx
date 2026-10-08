import { memo } from "react";
import type { MouseEvent } from "react";

/** A light, static atmosphere layer kept intentionally quiet behind the UI. */
export const Scene = memo(function Scene({ variant = "app" }: { variant?: "app" | "auth" | "call" }) {
  return (
    <div className={`scene scene-${variant}`} aria-hidden="true">
      <span className="scene-aurora aur-a" />
      <span className="scene-aurora aur-b" />
      <span className="scene-vignette" />
    </div>
  );
});

/** Paints --mx/--my for the optional, low-key button/card highlight. */
export function spotlight(event: MouseEvent<HTMLElement>) {
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  element.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  element.style.setProperty("--my", `${event.clientY - rect.top}px`);
}
