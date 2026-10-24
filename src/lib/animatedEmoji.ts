import catalog from "./animatedEmoji.json";

/**
 * Animated emoji: the curated pack (see animatedEmoji.json and
 * scripts/fetch-animated-emoji.mjs) plus helpers to recognise emoji in text.
 * Anything outside the pack simply shows as a normal system emoji.
 */
export type PackEmoji = { emoji: string; code: string; name: string };

export const PACK: PackEmoji[] = catalog.emojis;
export const PACK_CDN: string = catalog.cdn;
/** The first few are the quick reactions. */
export const REACTION_PICKS: PackEmoji[] = PACK.slice(0, catalog.reactionPicks);

/** Variation selectors differ between keyboards; compare without them. */
const strip = (value: string) => value.replace(/\uFE0F/g, "");
const byEmoji = new Map(PACK.map((item) => [strip(item.emoji), item] as const));

export function packEntry(emoji: string): PackEmoji | null {
  return byEmoji.get(strip(emoji)) ?? null;
}

/** File code (e.g. "2764_fe0f") of an emoji in the pack, or null. */
export function codeFor(emoji: string): string | null {
  return packEntry(emoji)?.code ?? null;
}

/** Real emoji only (no plain words) — mirrors the server's check. */
export function isReactionEmoji(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 16 && /\p{Extended_Pictographic}/u.test(value);
}

const EMOJI_CLUSTER = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*\uFE0F?$/u;

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  return Array.from(text.matchAll(/(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*\uFE0F?)|./gsu), (match) => match[0]);
}

/**
 * If a chat message is nothing but 1–`max` emoji, returns them (it is then shown
 * as big animated "stickers"); otherwise null.
 */
export function emojiOnly(text: string, max = 3): string[] | null {
  const compact = text.trim();
  if (!compact || compact.length > 48) return null;
  const parts = graphemes(compact).filter((part) => part.trim() !== "");
  if (parts.length < 1 || parts.length > max) return null;
  return parts.every((part) => EMOJI_CLUSTER.test(part)) ? parts : null;
}
