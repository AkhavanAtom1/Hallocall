/**
 * Slow colour drift for the default «مخصوص» palette.
 *
 * The app's lite budget forbids CSS keyframe loops, so this runs as a single
 * low-frequency timer (≈1.6 updates/s) that rewrites the four house-light
 * variables on <html>. Everything else in theme.css derives from those
 * variables, so the whole interface breathes together. Properties:
 *
 *  - the stops are all HalloCall colours (violet/aqua/rose/gold family), so the
 *    brand stays recognisable while it moves;
 *  - colours are interpolated in HSL with the hue on the shortest arc, which
 *    avoids the grey mid-tones an RGB lerp produces between violet and gold;
 *  - ticks are skipped while the tab is hidden, and the drift is disabled with
 *    prefers-reduced-motion (the first stop stays on screen).
 */

type Rgb = [number, number, number];
type Hsl = [number, number, number];

/** Each stop: [primary, secondary, tertiary, warm]. */
const STOPS: readonly (readonly [string, string, string, string])[] = [
  ["#8b5cf6", "#22d3ee", "#f472b6", "#fbbf24"], // violet · aqua · rose · gold (signature)
  ["#6366f1", "#2dd4bf", "#fb7185", "#f59e0b"], // indigo · teal · coral · amber
  ["#a855f7", "#38bdf8", "#f0abfc", "#fde047"], // purple · sky · orchid · lemon
];

/** Time spent travelling from one stop to the next. Whole cycle ≈ 42 s. */
const SEGMENT_MS = 14_000;
const TICK_MS = 600;

const ROLE_KEYS = ["primary", "secondary", "tertiary", "warm"] as const;

function hexToRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHsl([r, g, b]: Rgb): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: Hsl): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const hn = h / 360;
  return [hue(hn + 1 / 3), hue(hn), hue(hn - 1 / 3)].map((v) => Math.round(v * 255)) as Rgb;
}

function lerpHsl(a: Hsl, b: Hsl, t: number): Hsl {
  let dh = b[0] - a[0];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [(a[0] + dh * t + 360) % 360, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function mix(rgb: Rgb, target: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(rgb[i] + (target[i] - rgb[i]) * amount)) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const csv = (rgb: Rgb) => rgb.join(", ");
const hex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Colour for every role at a given position on the loop (0 ≤ t < STOPS.length). */
function paletteAt(t: number) {
  const index = Math.floor(t) % STOPS.length;
  const fraction = t - Math.floor(t);
  const eased = fraction * fraction * (3 - 2 * fraction); // smoothstep: gentle start and stop
  const next = (index + 1) % STOPS.length;
  return ROLE_KEYS.map((_, role) => {
    const from = rgbToHsl(hexToRgb(STOPS[index][role]));
    const to = rgbToHsl(hexToRgb(STOPS[next][role]));
    return hslToRgb(lerpHsl(from, to, eased));
  }) as [Rgb, Rgb, Rgb, Rgb];
}

/** Every custom property the drift owns. Removed again when another palette is chosen. */
export const SPECIAL_PALETTE_PROPERTIES = [
  "--theme-primary", "--theme-primary-rgb", "--theme-primary-bright", "--theme-primary-bright-rgb",
  "--theme-secondary", "--theme-secondary-rgb", "--theme-secondary-bright", "--theme-secondary-bright-rgb",
  "--theme-tertiary", "--theme-tertiary-rgb",
  "--theme-warm", "--theme-warm-rgb",
  "--theme-button-start", "--theme-button-end", "--theme-button-mid", "--theme-button-warm",
] as const;

function applyFrame(root: HTMLElement, t: number) {
  const [primary, secondary, tertiary, warm] = paletteAt(t);
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  set("--theme-primary", hex(primary));
  set("--theme-primary-rgb", csv(primary));
  set("--theme-primary-bright", hex(mix(primary, WHITE, 0.4)));
  set("--theme-primary-bright-rgb", csv(mix(primary, WHITE, 0.4)));

  set("--theme-secondary", hex(secondary));
  set("--theme-secondary-rgb", csv(secondary));
  set("--theme-secondary-bright", hex(mix(secondary, WHITE, 0.4)));
  set("--theme-secondary-bright-rgb", csv(mix(secondary, WHITE, 0.4)));

  set("--theme-tertiary", hex(tertiary));
  set("--theme-tertiary-rgb", csv(tertiary));
  set("--theme-warm", hex(warm));
  set("--theme-warm-rgb", csv(warm));

  // Darker siblings keep white button labels readable at every point of the cycle.
  set("--theme-button-start", hex(mix(primary, BLACK, 0.22)));
  set("--theme-button-end", hex(mix(secondary, BLACK, 0.4)));
  set("--theme-button-mid", hex(mix(tertiary, BLACK, 0.3)));
  set("--theme-button-warm", hex(mix(warm, BLACK, 0.3)));
}

/**
 * Starts the drift on `root` and returns a cleanup that stops it and removes
 * the inline overrides. Safe to call again after a theme switch.
 */
export function startSpecialPalette(root: HTMLElement): () => void {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now();

  applyFrame(root, 0);
  if (reduced) {
    return () => clearSpecialPalette(root);
  }

  const timer = window.setInterval(() => {
    if (document.hidden) return;
    const elapsed = performance.now() - startedAt;
    applyFrame(root, (elapsed / SEGMENT_MS) % STOPS.length);
  }, TICK_MS);

  return () => {
    window.clearInterval(timer);
    clearSpecialPalette(root);
  };
}

function clearSpecialPalette(root: HTMLElement) {
  for (const name of SPECIAL_PALETTE_PROPERTIES) root.style.removeProperty(name);
}
