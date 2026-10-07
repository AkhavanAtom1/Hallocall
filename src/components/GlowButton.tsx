import type { ButtonHTMLAttributes, ReactNode } from "react";
import { spotlight } from "./Scene";
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
 * The house button: layered neon shadow, cursor-following spotlight, a shine
 * sweep on hover and a light "floor" glow underneath the element.
 */
export function GlowButton({
  tone = "primary", size = "md", icon, trailingIcon, loading, glow = true,
  className = "", children, onMouseMove, ...rest
}: Props) {
  return (
    <button
      {...rest}
      onMouseMove={(event) => { spotlight(event); onMouseMove?.(event); }}
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
