import type { AvatarId } from "./types";

export const AVATARS: Array<{ id: AvatarId; emoji: string; label: string; gradient: string; glow: string }> = [
  { id: "aurora", emoji: "🪐", label: "Aurora", gradient: "linear-gradient(145deg,#7c3aed,#06b6d4)", glow: "rgba(124,58,237,.50)" },
  { id: "ember", emoji: "🔥", label: "Ember", gradient: "linear-gradient(145deg,#f97316,#ef4444)", glow: "rgba(239,68,68,.46)" },
  { id: "ocean", emoji: "🌊", label: "Ocean", gradient: "linear-gradient(145deg,#0ea5e9,#2563eb)", glow: "rgba(14,165,233,.46)" },
  { id: "violet", emoji: "💜", label: "Violet", gradient: "linear-gradient(145deg,#ec4899,#7c3aed)", glow: "rgba(236,72,153,.44)" },
  { id: "mint", emoji: "🍃", label: "Mint", gradient: "linear-gradient(145deg,#10b981,#14b8a6)", glow: "rgba(16,185,129,.44)" },
  { id: "sunset", emoji: "🌅", label: "Sunset", gradient: "linear-gradient(145deg,#f59e0b,#f43f5e)", glow: "rgba(244,63,94,.44)" },
  { id: "cosmic", emoji: "🌌", label: "Cosmic", gradient: "linear-gradient(145deg,#312e81,#0f172a)", glow: "rgba(99,102,241,.48)" },
  { id: "rose", emoji: "🌸", label: "Rose", gradient: "linear-gradient(145deg,#fb7185,#e879f9)", glow: "rgba(232,121,249,.44)" },
  { id: "bolt", emoji: "⚡", label: "Bolt", gradient: "linear-gradient(145deg,#fde047,#f97316)", glow: "rgba(250,204,21,.44)" },
  { id: "forest", emoji: "🌲", label: "Forest", gradient: "linear-gradient(145deg,#166534,#16a34a)", glow: "rgba(34,197,94,.42)" },
  { id: "pearl", emoji: "🫧", label: "Pearl", gradient: "linear-gradient(145deg,#c4b5fd,#93c5fd)", glow: "rgba(147,197,253,.44)" },
  { id: "lava", emoji: "🌋", label: "Lava", gradient: "linear-gradient(145deg,#991b1b,#f97316)", glow: "rgba(249,115,22,.46)" },
];

export const avatarOf = (id: string) => AVATARS.find((a) => a.id === id) ?? AVATARS[0];
