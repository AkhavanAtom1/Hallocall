import { avatarOf } from "../lib/avatars";
import type { AvatarDefinition } from "../lib/avatars";

/**
 * One circular profile portrait.
 *
 * Rendered as a real <img> (not a CSS background) so the browser can lazy-load
 * the gallery: with 40+ portraits the list view stays light even on a phone.
 * Falls back to the emoji + gradient badge for retired legacy avatars.
 */
export function AvatarImage({
  avatar, className = "", priority = false,
}: {
  avatar: AvatarDefinition | string;
  className?: string;
  /** Set for above-the-fold portraits (brand header, call tiles). */
  priority?: boolean;
}) {
  const def = typeof avatar === "string" ? avatarOf(avatar) : avatar;
  if (!def.src) return <span className={`avatar-emoji ${className}`} aria-hidden="true">{def.emoji}</span>;
  return (
    <span className={`avatar-photo ${className}`} role="img" aria-label={def.label}>
      <img
        src={def.src}
        alt=""
        width={512}
        height={512}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
