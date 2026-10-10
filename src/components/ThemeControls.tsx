import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { COLOR_THEMES, COLOR_THEME_GROUPS, getColorTheme } from "../lib/theme";
import type { ColorThemeId } from "../lib/theme";
import { Icon } from "./Icon";

type ThemeControlsProps = {
  colorTheme: ColorThemeId;
  onColorThemeChange: (theme: ColorThemeId) => void;
  dark: boolean;
  setDark: (dark: boolean) => void;
  compact?: boolean;
};

export function ThemeControls({ colorTheme, onColorThemeChange, dark, setDark, compact = false }: ThemeControlsProps) {
  return (
    <div className={compact ? "theme-controls compact" : "theme-controls"} role="group" aria-label="تنظیمات ظاهری">
      <ThemePicker colorTheme={colorTheme} onChange={onColorThemeChange} compact={compact} />
      <button
        type="button"
        className="theme-mode-toggle"
        onClick={() => setDark(!dark)}
        title={dark ? "رفتن به حالت روشن" : "رفتن به حالت تاریک"}
        aria-label={dark ? "رفتن به حالت روشن" : "رفتن به حالت تاریک"}
      >
        <Icon name={dark ? "sun" : "moon"} size={17} />
        {!compact && <span>{dark ? "روشن" : "تاریک"}</span>}
      </button>
    </div>
  );
}

function ThemePicker({ colorTheme, onChange, compact }: { colorTheme: ColorThemeId; onChange: (theme: ColorThemeId) => void; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = getColorTheme(colorTheme);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []);
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    if (!options.length) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? direction > 0 ? 0 : options.length - 1
        : (currentIndex + direction + options.length) % options.length;
      options[nextIndex].focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      options[event.key === "Home" ? 0 : options.length - 1].focus();
    }
  };

  const choose = (id: ColorThemeId) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="theme-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={compact ? "theme-picker-trigger compact" : "theme-picker-trigger"}
        aria-label={`انتخاب تم رنگی؛ تم فعلی ${selected.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="theme-picker-swatch" style={{ "--theme-swatch": selected.swatch } as CSSProperties} aria-hidden="true" />
        {!compact && <span className="theme-picker-label">{selected.label}</span>}
        <Icon name="palette" size={17} />
      </button>

      {open && (
        <div ref={menuRef} id={menuId} className="theme-menu glass" role="menu" aria-label="انتخاب تم رنگی" onKeyDown={handleMenuKeyDown}>
          <div className="theme-menu-heading">
            <b>تم رنگی</b>
            <span>فضای HalloCall را انتخاب کن</span>
          </div>
          {COLOR_THEME_GROUPS.map((group) => {
            const themes = COLOR_THEMES.filter((theme) => theme.group === group.id);
            if (!themes.length) return null;
            return (
              <div key={group.id} className="theme-group" role="group" aria-label={group.label}>
                <span className="theme-group-label" aria-hidden="true">{group.label}</span>
                {themes.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme.id === colorTheme}
                    className={theme.id === colorTheme ? "theme-option selected" : "theme-option"}
                    onClick={() => choose(theme.id)}
                  >
                    <span className="theme-option-swatch" style={{ "--theme-swatch": theme.swatch } as CSSProperties} aria-hidden="true" />
                    <span className="theme-option-copy">
                      <b>{theme.label}</b>
                      <small>{theme.description}</small>
                    </span>
                    {theme.id === colorTheme && <Icon name="check" size={16} />}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
