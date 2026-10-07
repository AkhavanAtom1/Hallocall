import type { AvatarId } from "./types";
import catalogJson from "./avatars.catalog.json";

/**
 * The single source of truth for every profile avatar.
 * `src/lib/avatars.catalog.json` is shared with `scripts/compose-avatars.mjs`,
 * so the sprite sheet and the UI can never drift apart.
 */
type CatalogAvatar = {
  id: string;
  no: number;
  file: string;
  cat: string;
  name: string;
  tag: string;
  jersey: string;
  mono: string;
  accent: string;
  accent2: string;
};

type Catalog = {
  sprite: { cols: number; rows: number; tile: number; file: string };
  categories: { id: string; icon: string; fa: string; en: string; hint: string }[];
  avatars: CatalogAvatar[];
};

const catalog = catalogJson as unknown as Catalog;

export const SPRITE_SRC = catalog.sprite.file;
export const SPRITE_COLS = catalog.sprite.cols;
export const SPRITE_ROWS = catalog.sprite.rows;
export const AVATAR_CATEGORIES = catalog.categories;

export type AvatarDefinition = {
  id: AvatarId;
  no: number;
  /** "رونالدو • قرمز • شماره ۷" style label used for aria/title. */
  label: string;
  name: string;
  tag: string;
  category: string;
  /** Short latin caption printed on the avatar chip. */
  jersey: string;
  accent: string;
  accent2: string;
  gradient: string;
  glow: string;
  ring: string;
  emoji: string;
  src?: string;
  /** Column / row inside the sprite sheet. */
  sprite?: readonly [number, number];
};

function rgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const CATEGORY_EMOJI: Record<string, string> = { football: "⚽", elden: "🌿", souls: "⚔️", bonus: "🔥" };

export const AVATARS: AvatarDefinition[] = catalog.avatars.map((entry, index) => ({
  id: entry.id as AvatarId,
  no: entry.no,
  label: `${entry.name} • ${entry.tag}`,
  name: entry.name,
  tag: entry.tag,
  jersey: entry.jersey,
  category: entry.cat,
  accent: entry.accent,
  accent2: entry.accent2,
  gradient: `linear-gradient(150deg,${entry.accent2},${entry.accent})`,
  glow: rgba(entry.accent, 0.62),
  ring: rgba(entry.accent, 0.9),
  emoji: CATEGORY_EMOJI[entry.cat] ?? "◈",
  src: SPRITE_SRC,
  sprite: [index % SPRITE_COLS, Math.floor(index / SPRITE_COLS)] as const,
}));

/** Legacy gradient avatars: kept so old accounts still render, no longer selectable. */
const LEGACY_AVATARS: AvatarDefinition[] = [
  { id: "aurora", emoji: "🪐", label: "Aurora", name: "Aurora", tag: "کلاسیک", jersey: "AURORA", category: "legacy", accent: "#7c3aed", accent2: "#06b6d4", gradient: "linear-gradient(150deg,#7c3aed,#06b6d4)", glow: "rgba(124,58,237,.50)", ring: "rgba(124,58,237,.9)" },
  { id: "ember", emoji: "🔥", label: "Ember", name: "Ember", tag: "کلاسیک", jersey: "EMBER", category: "legacy", accent: "#f97316", accent2: "#ef4444", gradient: "linear-gradient(150deg,#f97316,#ef4444)", glow: "rgba(239,68,68,.46)", ring: "rgba(239,68,68,.9)" },
  { id: "ocean", emoji: "🌊", label: "Ocean", name: "Ocean", tag: "کلاسیک", jersey: "OCEAN", category: "legacy", accent: "#0ea5e9", accent2: "#2563eb", gradient: "linear-gradient(150deg,#0ea5e9,#2563eb)", glow: "rgba(14,165,233,.46)", ring: "rgba(14,165,233,.9)" },
  { id: "violet", emoji: "💜", label: "Violet", name: "Violet", tag: "کلاسیک", jersey: "VIOLET", category: "legacy", accent: "#ec4899", accent2: "#7c3aed", gradient: "linear-gradient(150deg,#ec4899,#7c3aed)", glow: "rgba(236,72,153,.44)", ring: "rgba(236,72,153,.9)" },
  { id: "mint", emoji: "🍃", label: "Mint", name: "Mint", tag: "کلاسیک", jersey: "MINT", category: "legacy", accent: "#10b981", accent2: "#14b8a6", gradient: "linear-gradient(150deg,#10b981,#14b8a6)", glow: "rgba(16,185,129,.44)", ring: "rgba(16,185,129,.9)" },
  { id: "sunset", emoji: "🌅", label: "Sunset", name: "Sunset", tag: "کلاسیک", jersey: "SUNSET", category: "legacy", accent: "#f59e0b", accent2: "#f43f5e", gradient: "linear-gradient(150deg,#f59e0b,#f43f5e)", glow: "rgba(244,63,94,.44)", ring: "rgba(244,63,94,.9)" },
  { id: "cosmic", emoji: "🌌", label: "Cosmic", name: "Cosmic", tag: "کلاسیک", jersey: "COSMIC", category: "legacy", accent: "#312e81", accent2: "#0f172a", gradient: "linear-gradient(150deg,#312e81,#0f172a)", glow: "rgba(99,102,241,.48)", ring: "rgba(99,102,241,.9)" },
  { id: "rose", emoji: "🌸", label: "Rose", name: "Rose", tag: "کلاسیک", jersey: "ROSE", category: "legacy", accent: "#fb7185", accent2: "#e879f9", gradient: "linear-gradient(150deg,#fb7185,#e879f9)", glow: "rgba(232,121,249,.44)", ring: "rgba(232,121,249,.9)" },
  { id: "bolt", emoji: "⚡", label: "Bolt", name: "Bolt", tag: "کلاسیک", jersey: "BOLT", category: "legacy", accent: "#fde047", accent2: "#f97316", gradient: "linear-gradient(150deg,#fde047,#f97316)", glow: "rgba(250,204,21,.44)", ring: "rgba(250,204,21,.9)" },
  { id: "forest", emoji: "🌲", label: "Forest", name: "Forest", tag: "کلاسیک", jersey: "FOREST", category: "legacy", accent: "#166534", accent2: "#16a34a", gradient: "linear-gradient(150deg,#166534,#16a34a)", glow: "rgba(34,197,94,.42)", ring: "rgba(34,197,94,.9)" },
  { id: "pearl", emoji: "🫧", label: "Pearl", name: "Pearl", tag: "کلاسیک", jersey: "PEARL", category: "legacy", accent: "#c4b5fd", accent2: "#93c5fd", gradient: "linear-gradient(150deg,#c4b5fd,#93c5fd)", glow: "rgba(147,197,253,.44)", ring: "rgba(147,197,253,.9)" },
  { id: "lava", emoji: "🌋", label: "Lava", name: "Lava", tag: "کلاسیک", jersey: "LAVA", category: "legacy", accent: "#991b1b", accent2: "#f97316", gradient: "linear-gradient(150deg,#991b1b,#f97316)", glow: "rgba(249,115,22,.46)", ring: "rgba(249,115,22,.9)" },
] as AvatarDefinition[];

export const ALL_AVATARS = [...AVATARS, ...LEGACY_AVATARS];

export const DEFAULT_AVATAR = AVATARS[0].id;

export const avatarOf = (id: string): AvatarDefinition =>
  ALL_AVATARS.find((a) => a.id === id) ?? AVATARS[0];

/** CSS background geometry for a sprite tile, used by <AvatarImage />. */
export function spriteStyle(avatar: AvatarDefinition) {
  if (!avatar.src) return undefined;
  if (!avatar.sprite) {
    return { backgroundImage: `url(${avatar.src})`, backgroundSize: "cover", backgroundPosition: "center" } as const;
  }
  const [x, y] = avatar.sprite;
  return {
    backgroundImage: `url(${avatar.src})`,
    backgroundSize: `${SPRITE_COLS * 100}% ${SPRITE_ROWS * 100}%`,
    backgroundPosition: `${(x / (SPRITE_COLS - 1)) * 100}% ${(y / (SPRITE_ROWS - 1)) * 100}%`,
  } as const;
}
