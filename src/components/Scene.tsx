import { memo } from "react";
import type { CSSProperties, MouseEvent } from "react";

/** Deterministic pseudo random so the spark field never reshuffles between renders. */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const SPARKS = Array.from({ length: 30 }, (_, i) => ({
  left: `${(rand(i, 1) * 100).toFixed(2)}%`,
  top: `${(rand(i, 2) * 100).toFixed(2)}%`,
  width: `${(1.4 + rand(i, 3) * 2.4).toFixed(2)}px`,
  animationDelay: `${(rand(i, 4) * 8).toFixed(2)}s`,
  animationDuration: `${(5 + rand(i, 5) * 7).toFixed(2)}s`,
}));

/**
 * Layered atmosphere: aurora lights, stadium beams, grid, sparks, film grain.
 * Pure decoration — never intercepts pointer events.
 */
export const Scene = memo(function Scene({ variant = "app" }: { variant?: "app" | "auth" | "call" }) {
  return (
    <div className={`scene scene-${variant}`} aria-hidden="true">
      <span className="scene-aurora aur-a" />
      <span className="scene-aurora aur-b" />
      <span className="scene-aurora aur-c" />
      <span className="scene-aurora aur-d" />
      <span className="scene-beams" />
      <span className="scene-grid" />
      <span className="scene-sparks">
        {SPARKS.map((spark, i) => <i key={i} style={spark as CSSProperties} />)}
      </span>
      <span className="scene-noise" />
      <span className="scene-vignette" />
    </div>
  );
});

/** Paints --mx/--my so CSS can put a moving spotlight under any element. */
export function spotlight(event: MouseEvent<HTMLElement>) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  el.style.setProperty("--my", `${event.clientY - rect.top}px`);
}
