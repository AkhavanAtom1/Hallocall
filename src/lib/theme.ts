export type ColorThemeId = "violet" | "ocean" | "rose" | "emerald" | "sunset" | "special";

export type ColorTheme = {
  id: ColorThemeId;
  label: string;
  description: string;
  swatch: string;
};

export const COLOR_THEME_STORAGE_KEY = "hallocall-color-theme";
export const DEFAULT_COLOR_THEME: ColorThemeId = "violet";

/**
 * Color palettes keep the interface's primary, secondary and ambient lighting
 * in step. "Special" is HalloCall's signature blend: violet, aqua, rose and gold.
 */
export const COLOR_THEMES: readonly ColorTheme[] = [
  {
    id: "violet",
    label: "بنفش نئونی",
    description: "بنفش و فیروزه‌ای؛ امضای کلاسیک HalloCall",
    swatch: "linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%)",
  },
  {
    id: "ocean",
    label: "اقیانوسی",
    description: "آبی عمیق و سبزآبی آرام",
    swatch: "linear-gradient(135deg, #0ea5e9 0%, #14b8a6 100%)",
  },
  {
    id: "rose",
    label: "رز نئونی",
    description: "صورتی درخشان و بنفش مخملی",
    swatch: "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)",
  },
  {
    id: "emerald",
    label: "زمردی",
    description: "سبز زمردی و فیروزه‌ای روشن",
    swatch: "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
  },
  {
    id: "sunset",
    label: "غروب",
    description: "کهربایی گرم با قرمز مرجانی",
    swatch: "linear-gradient(135deg, #f97316 0%, #f43f5e 100%)",
  },
  {
    id: "special",
    label: "مخصوص",
    description: "ترکیب اختصاصی بنفش، فیروزه‌ای، صورتی و طلایی",
    swatch: "linear-gradient(120deg, #8b5cf6 0%, #22d3ee 38%, #f472b6 72%, #fbbf24 100%)",
  },
] as const;

const COLOR_THEME_IDS = new Set<string>(COLOR_THEMES.map((theme) => theme.id));

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === "string" && COLOR_THEME_IDS.has(value);
}

export function readSavedColorTheme(): ColorThemeId {
  try {
    const saved = localStorage.getItem(COLOR_THEME_STORAGE_KEY);
    return isColorThemeId(saved) ? saved : DEFAULT_COLOR_THEME;
  } catch {
    return DEFAULT_COLOR_THEME;
  }
}

export function getColorTheme(id: ColorThemeId) {
  return COLOR_THEMES.find((theme) => theme.id === id) ?? COLOR_THEMES[0];
}
