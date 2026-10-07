import { avatarOf, spriteStyle } from "../lib/avatars";
import type { AvatarDefinition } from "../lib/avatars";

/**
 * Renders one tile of the legend sprite. Falls back to the emoji + gradient
 * so a user with a retired avatar still gets a nice circle.
 */
export function AvatarImage({ avatar, className = "" }: { avatar: AvatarDefinition | string; className?: string }) {
  const def = typeof avatar === "string" ? avatarOf(avatar) : avatar;
  const style = spriteStyle(def);
  if (!style) return <span className={`avatar-emoji ${className}`} aria-hidden="true">{def.emoji}</span>;
  return <span className={`avatar-photo ${className}`} role="img" aria-label={def.label} style={style} />;
}
