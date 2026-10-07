import { APP_AVATAR } from "../lib/appIdentity";

/**
 * The app's own profile picture — the minimal HalloCall badge used as the
 * brand mark, the favicon and the official system profile.
 */
export function AppAvatar({ size = 40, label = "HalloCall", className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    <span
      className={`app-avatar ${className}`}
      role="img"
      aria-label={label}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      <img src={APP_AVATAR.src} alt="" draggable={false} />
    </span>
  );
}
