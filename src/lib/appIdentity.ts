import type { AvatarDefinition } from "./avatars";

/**
 * HalloCall has a profile of its own: a minimal circular badge (outlined diamond
 * + a solid core, flanked by two voice arcs) rendered in the app's violet→cyan
 * light. It is the favicon, the brand mark in every header and the "official"
 * profile shown at the bottom of the gallery.
 */
export const APP_AVATAR = {
  id: "hallocall",
  src: "/avatars/hallocall.webp",
  name: "HalloCall",
  tag: "پروفایل رسمی برنامه",
  label: "HalloCall • پروفایل رسمی",
  accent: "#8b5cf6",
  glow: "rgba(139,92,246,.62)",
} as const;

/** Same shape as an avatar definition so the generic <AvatarImage> styling works. */
export const APP_AVATAR_DEF = {
  id: APP_AVATAR.id,
  no: 0,
  label: APP_AVATAR.label,
  name: APP_AVATAR.name,
  tag: APP_AVATAR.tag,
  category: "official",
  jersey: "HALLOCALL",
  accent: APP_AVATAR.accent,
  accent2: "#06b6d4",
  gradient: "linear-gradient(150deg,#1b1030,#0a2233)",
  glow: APP_AVATAR.glow,
  ring: "rgba(139,92,246,.9)",
  emoji: "◈",
  src: APP_AVATAR.src,
} as unknown as AvatarDefinition;
