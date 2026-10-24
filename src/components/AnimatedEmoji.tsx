import { createContext, useContext, useEffect, useRef, useState } from "react";
import { PACK, PACK_CDN, packEntry } from "../lib/animatedEmoji";

type Stage = "local" | "cdn" | "none";

/** Lets the call page turn all animated emoji into plain emoji (data/battery saver). */
export const EmojiMotion = createContext(true);

/** What worked (or not) for each emoji, so a failed file is never requested twice. */
const resolved = new Map<string, Stage>();

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/**
 * One emoji. Shows the animated version when it exists — first from this site
 * (`/emoji/<code>.webp`, downloaded at build time), then from Google's CDN —
 * and the normal system emoji otherwise (also while loading, for people who
 * prefer reduced motion, and offline).
 */
export function AnimatedEmoji({ emoji, size = 32, still = false, lazy = false, className = "" }: {
  emoji: string;
  size?: number;
  still?: boolean;
  lazy?: boolean;
  className?: string;
}) {
  const entry = packEntry(emoji);
  const reduced = usePrefersReducedMotion();
  const allowed = useContext(EmojiMotion);
  const code = entry?.code ?? "";
  const [stage, setStage] = useState<Stage>(() => (entry ? resolved.get(entry.code) ?? "local" : "none"));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setStage(code ? resolved.get(code) ?? "local" : "none");
    setLoaded(false);
  }, [code]);

  const animated = !!entry && allowed && !reduced && !still && stage !== "none";
  const src = stage === "local" ? `/emoji/${code}.webp` : `${PACK_CDN}/${code}/512.webp`;

  return (
    <span className={`emoji-wrap ${className}`.trim()} style={{ width: size, height: size, fontSize: Math.round(size * 0.82) }} role="img" aria-label={emoji}>
      {(!animated || !loaded) && <span className="emoji-glyph" aria-hidden="true">{emoji}</span>}
      {animated && (
        <img
          key={stage}
          className={loaded ? "emoji-anim ready" : "emoji-anim"}
          src={src}
          alt=""
          width={size}
          height={size}
          decoding="async"
          loading={lazy ? "lazy" : "eager"}
          draggable={false}
          onLoad={() => { resolved.set(code, stage); setLoaded(true); }}
          onError={() => {
            const next: Stage = stage === "local" ? "cdn" : "none";
            resolved.set(code, next);
            setLoaded(false);
            setStage(next);
          }}
        />
      )}
    </span>
  );
}

/** The emoji grid used for reactions and in the chat box. */
export function EmojiPicker({ onPick, label = "انتخاب ایموجی", limit }: { onPick: (emoji: string) => void; label?: string; limit?: number }) {
  const items = limit ? PACK.slice(0, limit) : PACK;
  return (
    <div className="emoji-grid" role="group" aria-label={label}>
      {items.map((item) => (
        <button key={item.code} type="button" className="emoji-cell" aria-label={`${item.emoji} ${item.name}`} title={item.name} onClick={() => onPick(item.emoji)}>
          <AnimatedEmoji emoji={item.emoji} size={38} lazy />
        </button>
      ))}
    </div>
  );
}

/**
 * A reaction that pops up above its sender's avatar, grows, drifts upward and
 * fades. It uses the Web Animations API on purpose: the app's "lite" stylesheet
 * switches every CSS animation off, which is exactly why reactions used to look
 * like a tiny static emoji next to the toolbar ("nothing happens").
 */
export function ReactionBurst({ emoji, offset, orphan = false }: { emoji: string; offset: number; orphan?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== "function") return;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frames: Keyframe[] = reduced
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: "translate(-50%, 14px) scale(.3)" },
          { opacity: 1, transform: "translate(-50%, -14px) scale(1.2)", offset: 0.16 },
          { opacity: 1, transform: "translate(-50%, -46px) scale(1)", offset: 0.7 },
          { opacity: 0, transform: "translate(-50%, -104px) scale(.9)" },
        ];
    const animation = element.animate(frames, { duration: 2400, easing: "ease-out", fill: "forwards" });
    return () => animation.cancel();
  }, []);
  return (
    <span ref={ref} className={orphan ? "reaction-burst orphan" : "reaction-burst"} style={{ left: `calc(50% + ${offset}px)` }} aria-hidden="true">
      <AnimatedEmoji emoji={emoji} size={orphan ? 84 : 64} />
    </span>
  );
}
