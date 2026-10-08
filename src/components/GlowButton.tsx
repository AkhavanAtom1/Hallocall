import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";

export type ButtonTone = "primary" | "cyan" | "mint" | "rose" | "amber" | "ghost" | "quiet";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  size?: "sm" | "md" | "lg";
  icon?: string;
  trailingIcon?: string;
  loading?: ReactNode;
  glow?: boolean;
};

/**
 * The house button: layered neon shadow and a soft "floor" glow.
 * Deliberately calm — no light sweep / shine animation on hover, only a
 * gentle lift and shadow response.
 */
export function GlowButton({
  tone = "primary", size = "md", icon, trailingIcon, loading, glow = true,
  className = "", children, ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={`glow-btn tone-${tone} size-${size} ${glow ? "has-glow" : "no-glow"} ${rest.disabled ? "is-disabled" : ""} ${className}`}
    >
      <span className="btn-floor" aria-hidden="true" />
      <span className="btn-content">
        {loading ?? (icon ? <Icon name={icon} size={size === "lg" ? 20 : 18} /> : null)}
        {children}
        {trailingIcon ? <Icon name={trailingIcon} size={size === "lg" ? 20 : 17} /> : null}
      </span>
    </button>
  );
}
