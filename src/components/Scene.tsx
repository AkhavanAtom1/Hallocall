import { memo } from "react";

/**
 * Static atmosphere behind the UI.
 *
 * Earlier revisions animated four auroras, a moving grid, spark particles and
 * blurred beams. All of that kept the compositor busy the whole time the tab
 * was open — which is exactly what we do NOT want while the user is playing a
 * heavy game in another window. The scene is now a single div with a painted
 * gradient (see `lite.css`): zero animations, zero blur, zero per-frame work.
 */
export const Scene = memo(function Scene({ variant = "app" }: { variant?: "app" | "auth" | "call" }) {
  return <div className={`scene scene-${variant}`} aria-hidden="true" />;
});
