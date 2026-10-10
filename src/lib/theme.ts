export type ColorThemeId =
  | "special"
  | "sunny" | "candy" | "tropical" | "carnival" | "spring"
  | "violet" | "ocean" | "rose" | "emerald" | "sunset";

export type ColorThemeGroupId = "special" | "cheerful" | "classic";

export type ColorTheme = {
  id: ColorThemeId;
  group: ColorThemeGroupId;
  label: string;
  description: string;
  swatch: string;
};

export const COLOR_THEME_STORAGE_KEY = "hallocall-color-theme";

/** First visit (or a cleared/unknown saved value) lands on «مخصوص». */
export const DEFAULT_COLOR_THEME: ColorThemeId = "special";

export const COLOR_THEME_GROUPS: readonly { id: ColorThemeGroupId; label: string }[] = [
  { id: "special", label: "اختصاصی" },
  { id: "cheerful", label: "شاد و پرنور" },
  { id: "classic", label: "کلاسیک" },
] as const;

/**
 * Palettes keep the primary, secondary, tertiary and warm "lights" in step.
 * The palette values live in `src/theme.css`; this list drives the picker.
 * «مخصوص» is HalloCall's signature blend (violet, aqua, rose, gold) and the
 * only palette whose colors drift slowly over time (see `specialPalette.ts`).
 */
export const COLOR_THEMES: readonly ColorTheme[] = [
  {
    id: "special",
    group: "special",
    label: "مخصوص",
    description: "ترکیب اختصاصی بنفش، فیروزه‌ای، صورتی و طلایی؛ رنگ‌ها آرام‌آرام جابه‌جا می‌شوند",
    swatch: "linear-gradient(120deg, #8b5cf6 0%, #22d3ee 38%, #f472b6 72%, #fbbf24 100%)",
  },
  {
    id: "sunny",
    group: "cheerful",
    label: "آفتابی",
    description: "کهربایی و زرد آفتابی با صورتی مرجانی",
    swatch: "linear-gradient(135deg, #f59e0b 0%, #fb7185 100%)",
  },
  {
    id: "candy",
    group: "cheerful",
    label: "آبنباتی",
    description: "صورتی آبنباتی، آبی آسمانی و نعنایی",
    swatch: "linear-gradient(135deg, #f472b6 0%, #38bdf8 100%)",
  },
  {
    id: "tropical",
    group: "cheerful",
    label: "استوایی",
    description: "فیروزه‌ای گرم، سبز لیمویی و مرجانی",
    swatch: "linear-gradient(135deg, #14b8a6 0%, #a3e635 100%)",
  },
  {
    id: "carnival",
    group: "cheerful",
    label: "کارناوال",
    description: "فوشیا پرانرژی، فیروزه‌ای و زرد جشن",
    swatch: "linear-gradient(135deg, #d946ef 0%, #facc15 100%)",
  },
  {
    id: "spring",
    group: "cheerful",
    label: "بهاری",
    description: "سبز تازه، صورتی گلبهی و آبی روشن",
    swatch: "linear-gradient(135deg, #4ade80 0%, #f9a8d4 100%)",
  },
  {
    id: "violet",
    group: "classic",
    label: "بنفش نئونی",
    description: "بنفش و فیروزه‌ای؛ امضای کلاسیک HalloCall",
    swatch: "linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%)",
  },
  {
    id: "ocean",
    group: "classic",
    label: "اقیانوسی",
    description: "آبی عمیق و سبزآبی آرام",
    swatch: "linear-gradient(135deg, #0ea5e9 0%, #14b8a6 100%)",
  },
  {
    id: "rose",
    group: "classic",
    label: "رز نئونی",
    description: "صورتی درخشان و بنفش مخملی",
    swatch: "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)",
  },
  {
    id: "emerald",
    group: "classic",
    label: "زمردی",
    description: "سبز زمردی و فیروزه‌ای روشن",
    swatch: "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
  },
  {
    id: "sunset",
    group: "classic",
    label: "غروب",
    description: "کهربایی گرم با قرمز مرجانی",
    swatch: "linear-gradient(135deg, #f97316 0%, #f43f5e 100%)",
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
