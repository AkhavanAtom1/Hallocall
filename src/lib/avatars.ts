import type { AvatarId } from "./types";

export type AvatarDefinition = {
  id: AvatarId;
  emoji: string;
  label: string;
  gradient: string;
  glow: string;
  src?: string;
  sprite?: readonly [number, number];
};

const SPRITE = "/avatars/football-legends.webp";

export const AVATARS: AvatarDefinition[] = [
  { id:"ronaldo_red", label:"رونالدو • قرمز", emoji:"⚽", gradient:"linear-gradient(145deg,#991b1b,#ef4444)", glow:"rgba(239,68,68,.68)", src:SPRITE, sprite:[0,0] },
  { id:"ronaldo_white", label:"رونالدو • سفید", emoji:"⚽", gradient:"linear-gradient(145deg,#e5e7eb,#64748b)", glow:"rgba(226,232,240,.62)", src:SPRITE, sprite:[1,0] },
  { id:"ronaldo_black", label:"رونالدو • یوونتوس", emoji:"⚽", gradient:"linear-gradient(145deg,#111827,#e5e7eb)", glow:"rgba(226,232,240,.58)", src:SPRITE, sprite:[2,0] },
  { id:"messi_barca_blue", label:"مسی • بارسلونا", emoji:"⚽", gradient:"linear-gradient(145deg,#1d4ed8,#7c3aed)", glow:"rgba(59,130,246,.70)", src:SPRITE, sprite:[3,0] },
  { id:"messi_barca_purple", label:"مسی • بارسلونا", emoji:"⚽", gradient:"linear-gradient(145deg,#6d28d9,#db2777)", glow:"rgba(168,85,247,.68)", src:SPRITE, sprite:[0,1] },
  { id:"ronaldinho_brazil", label:"رونالدینیو • برزیل", emoji:"⚽", gradient:"linear-gradient(145deg,#eab308,#16a34a)", glow:"rgba(250,204,21,.72)", src:SPRITE, sprite:[1,1] },
  { id:"ronaldinho_milan", label:"رونالدینیو • میلان", emoji:"⚽", gradient:"linear-gradient(145deg,#111827,#dc2626)", glow:"rgba(239,68,68,.66)", src:SPRITE, sprite:[2,1] },
  { id:"neymar_brazil", label:"نیمار • برزیل", emoji:"⚽", gradient:"linear-gradient(145deg,#eab308,#16a34a)", glow:"rgba(250,204,21,.68)", src:SPRITE, sprite:[3,1] },
  { id:"neymar_barca", label:"نیمار • بارسلونا", emoji:"⚽", gradient:"linear-gradient(145deg,#4c1d95,#1d4ed8)", glow:"rgba(124,58,237,.70)", src:SPRITE, sprite:[0,2] },
  { id:"dybala_juve", label:"دیبالا • یوونتوس", emoji:"⚽", gradient:"linear-gradient(145deg,#0f172a,#e5e7eb)", glow:"rgba(203,213,225,.60)", src:SPRITE, sprite:[1,2] },
  { id:"ronaldo_red_alt", label:"رونالدو • قرمز", emoji:"⚽", gradient:"linear-gradient(145deg,#7f1d1d,#ef4444)", glow:"rgba(248,113,113,.72)", src:SPRITE, sprite:[2,2] },
  { id:"messi_argentina", label:"مسی • آرژانتین", emoji:"⚽", gradient:"linear-gradient(145deg,#0ea5e9,#dbeafe)", glow:"rgba(56,189,248,.72)", src:SPRITE, sprite:[3,2] },
  { id:"mbappe_france", label:"امباپه • فرانسه", emoji:"⚽", gradient:"linear-gradient(145deg,#172554,#1d4ed8)", glow:"rgba(37,99,235,.72)", src:SPRITE, sprite:[0,3] },
  { id:"van_dijk_netherlands", label:"فن‌دایک • هلند", emoji:"⚽", gradient:"linear-gradient(145deg,#f97316,#fb923c)", glow:"rgba(249,115,22,.76)", src:SPRITE, sprite:[1,3] },
  { id:"haaland_city", label:"هالند • سیتی", emoji:"⚽", gradient:"linear-gradient(145deg,#0284c7,#bae6fd)", glow:"rgba(56,189,248,.74)", src:SPRITE, sprite:[2,3] },
];

const LEGACY_AVATARS: AvatarDefinition[] = [
  { id:"aurora", emoji:"🪐", label:"Aurora", gradient:"linear-gradient(145deg,#7c3aed,#06b6d4)", glow:"rgba(124,58,237,.50)" },
  { id:"ember", emoji:"🔥", label:"Ember", gradient:"linear-gradient(145deg,#f97316,#ef4444)", glow:"rgba(239,68,68,.46)" },
  { id:"ocean", emoji:"🌊", label:"Ocean", gradient:"linear-gradient(145deg,#0ea5e9,#2563eb)", glow:"rgba(14,165,233,.46)" },
  { id:"violet", emoji:"💜", label:"Violet", gradient:"linear-gradient(145deg,#ec4899,#7c3aed)", glow:"rgba(236,72,153,.44)" },
  { id:"mint", emoji:"🍃", label:"Mint", gradient:"linear-gradient(145deg,#10b981,#14b8a6)", glow:"rgba(16,185,129,.44)" },
  { id:"sunset", emoji:"🌅", label:"Sunset", gradient:"linear-gradient(145deg,#f59e0b,#f43f5e)", glow:"rgba(244,63,94,.44)" },
  { id:"cosmic", emoji:"🌌", label:"Cosmic", gradient:"linear-gradient(145deg,#312e81,#0f172a)", glow:"rgba(99,102,241,.48)" },
  { id:"rose", emoji:"🌸", label:"Rose", gradient:"linear-gradient(145deg,#fb7185,#e879f9)", glow:"rgba(232,121,249,.44)" },
  { id:"bolt", emoji:"⚡", label:"Bolt", gradient:"linear-gradient(145deg,#fde047,#f97316)", glow:"rgba(250,204,21,.44)" },
  { id:"forest", emoji:"🌲", label:"Forest", gradient:"linear-gradient(145deg,#166534,#16a34a)", glow:"rgba(34,197,94,.42)" },
  { id:"pearl", emoji:"🫧", label:"Pearl", gradient:"linear-gradient(145deg,#c4b5fd,#93c5fd)", glow:"rgba(147,197,253,.44)" },
  { id:"lava", emoji:"🌋", label:"Lava", gradient:"linear-gradient(145deg,#991b1b,#f97316)", glow:"rgba(249,115,22,.46)" },
];

export const ALL_AVATARS = [...AVATARS, ...LEGACY_AVATARS];

export const avatarOf = (id: string): AvatarDefinition =>
  ALL_AVATARS.find((a) => a.id === id) ?? AVATARS[0];
