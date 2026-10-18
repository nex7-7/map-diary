import type { BuiltinCategory, Category } from "./types";

interface CategoryStyle {
  label: string;
  emoji: string;
  /** Pin colour, readable on both light and dark map flavours. */
  color: string;
}

export const CATEGORY_STYLES: Record<BuiltinCategory, CategoryStyle> = {
  restaurant: { label: "Restaurant", emoji: "🍛", color: "#d9480f" },
  "cafe-bar": { label: "Café/Bar", emoji: "☕", color: "#9c36b5" },
  movies: { label: "Movies", emoji: "🎬", color: "#c2255c" },
  recreation: { label: "Recreation", emoji: "🌳", color: "#2f9e44" },
  beach: { label: "Beach", emoji: "🏖️", color: "#0c8599" },
};

const CUSTOM_STYLE: CategoryStyle = { label: "Other", emoji: "📍", color: "#5c5f66" };

export function categoryStyle(category: Category): CategoryStyle {
  if (category.startsWith("custom:")) {
    const name = category.slice("custom:".length).replace(/-/g, " ");
    return { ...CUSTOM_STYLE, label: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  return CATEGORY_STYLES[category as BuiltinCategory];
}

export const STATUS_LABELS = { visited: "Visited", want: "Want to" } as const;
