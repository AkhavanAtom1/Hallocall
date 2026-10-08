import { memo } from "react";
import type { MouseEvent } from "react";

/** Fixed, deterministic "star field" so the atmosphere never shifts between renders. */
const SPARKS = [
  { top: "12%", left: "8%", w: 3, d: 7.2, delay: 0 },
  { top: "22%", left: "21%", w: 2, d: 6.1, delay: 1.4 },
  { top: "9%", left: "38%", w: 2, d: 8.4, delay: 2.6 },
  { top: "17%", left: "57%", w: 3, d: 6.8, delay: .8 },
  { top: "7%", left: "73%", w: 2, d: 7.6, delay: 3.4 },
  { top: "26%", left: "88%", w: 2, d: 6.4, delay: 1.9 },
  { top: "44%", left: "94%", w: 3, d: 8.1, delay: .4 },
  { top: "58%", left: "83%", w: 2, d: 7.0, delay: 2.2 },
  { top: "71%", left: "91%", w: 2, d: 6.6, delay: 3.0 },
  { top: "64%", left: "6%", w: 2, d: 7.8, delay: 1.1 },
  { top: "78%", left: "15%", w: 3, d: 6.9, delay: 2.8 },
  { top: "86%", left: "34%", w: 2, d: 8.0, delay: .6 },
  { top: "81%", left: "55%", w: 2, d: 6.3, delay: 3.6 },
  { top: "90%", left: "72%", w: 2, d: 7.4, delay: 1.6 },
];

/**
 * Layered atmosphere behind the UI: four slow auroras in the house palette
 * (violet / cyan / pink / amber), a faint perspective grid, twinkling sparks,
 * film noise and a vignette. All layers are GPU-cheap transforms/opacity and
 * are fully disabled by `prefers-reduced-motion` (see refinement.css).
 */
export const Scene = memo(function Scene({ variant = "app" }: { variant?: "app" | "auth" | "call" }) {
  return (
    <div className={`scene scene-${variant}`} aria-hidden="true">
      <span className="scene-aurora aur-a" />
      <span className="scene-aurora aur-b" />
      <span className="scene-aurora aur-c" />
      <span className="scene-aurora aur-d" />
      {variant !== "call" && <span className="scene-grid" />}
      {variant !== "call" && <span className="scene-beams" />}
      <span className="scene-sparks">
        {SPARKS.map((s, i) => (
          <i
            key={i}
            style={{
              top: s.top,
              left: s.left,
              width: s.w,
              animationDuration: `${s.d}s`,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
      </span>
      <span className="scene-noise" />
      <span className="scene-vignette" />
    </div>
  );
});

/** Paints --mx/--my for the optional, low-key card highlight. */
export function spotlight(event: MouseEvent<HTMLElement>) {
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  element.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  element.style.setProperty("--my", `${event.clientY - rect.top}px`);
}
