import { useState } from "react";
import type { CSSProperties } from "react";
import { AVATAR_CATEGORIES, AVATARS, avatarOf, faNum } from "../lib/avatars";
import { AvatarImage } from "./AvatarImage";
import { Icon } from "./Icon";

const catCount = (id: string) => AVATARS.filter((avatar) => avatar.category === id).length;

/**
 * The profile gallery is driven by the central image catalog and grouped into
 * collections. Used in the auth card (compact) and in the profile sheet (gallery).
 */
export function AvatarPicker({
  value, onChange, variant = "gallery",
}: {
  value: string;
  onChange: (id: string) => void;
  variant?: "compact" | "gallery";
}) {
  const [category, setCategory] = useState("all");
  const [peek, setPeek] = useState<string | null>(null);
  const compact = variant === "compact";
  const filtered = category === "all" ? AVATARS : AVATARS.filter((avatar) => avatar.category === category);
  // Compact lives inside the auth card: a few portraits from every collection
  // so the page never renders 40+ files and heroes/elden/souls stay visible.
  const list = !compact
    ? filtered
    : category === "all"
      ? AVATAR_CATEGORIES.flatMap((cat) => AVATARS.filter((avatar) => avatar.category === cat.id).slice(0, 2))
      : filtered.slice(0, 12);
  const described = avatarOf(peek ?? value);

  return (
    <div className={`avatar-picker ${variant === "compact" ? "is-compact" : "is-gallery"}`}>
      <div className="picker-head">
        <div className="field-label">
          <span>آواتار پروفایل</span>
          <small>{AVATARS.length} پروفایل آماده • {AVATAR_CATEGORIES.length} کالکشن</small>
        </div>
        <div className="chip-row" role="group" aria-label="فیلتر دسته‌بندی آواتارها">
          <button type="button" aria-pressed={category === "all"} className={category === "all" ? "cat-chip on" : "cat-chip"} onClick={() => setCategory("all")}>
            ✨ همه <b>{AVATARS.length}</b>
          </button>
          {AVATAR_CATEGORIES.map((cat) => {
            const count = catCount(cat.id);
            if (!count) return null;
            return (
              <button
                key={cat.id} type="button" aria-pressed={category === cat.id}
                className={category === cat.id ? "cat-chip on" : "cat-chip"} onClick={() => setCategory(cat.id)}
                title={cat.hint}
              >
                <span>{cat.icon}</span> {cat.fa} <b>{count}</b>
              </button>
            );
          })}
        </div>
      </div>

      <div className="avatar-grid" onMouseLeave={() => setPeek(null)}>
        {list.map((avatar) => {
          const selected = avatar.id === value;
          return (
            <button
              type="button" key={avatar.id} title={avatar.label} aria-label={avatar.label} aria-pressed={selected}
              className={selected ? "avatar-choice selected" : "avatar-choice"}
              style={{ "--accent": avatar.accent, "--accent-glow": avatar.glow, "--accent-soft": avatar.ring } as CSSProperties}
              onMouseEnter={() => setPeek(avatar.id)} onFocus={() => setPeek(avatar.id)} onClick={() => onChange(avatar.id)}
            >
              <span className="choice-halo" aria-hidden="true" />
              <span className="choice-face"><AvatarImage avatar={avatar} /></span>
              <span className="choice-name">{avatar.name}</span>
              {selected && <span className="choice-check" aria-hidden="true"><Icon name="check" size={12} stroke={2.6} /></span>}
            </button>
          );
        })}
      </div>

      <div className="picker-foot">
        <span className="foot-chip" style={{ "--accent": described.accent } as CSSProperties}>{described.emoji}</span>
        <div>
          <b>{described.name}</b>
          <span>{described.tag}</span>
        </div>
        <small>{compact ? `${faNum(AVATARS.length)} پروفایل در «گالری پروفایل‌ها»` : "برای دیدن بقیه، روی کالکشن‌ها بزن"}</small>
      </div>
    </div>
  );
}
