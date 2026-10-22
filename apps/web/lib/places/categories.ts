import type { GlyphName } from "../ui/icon-paths";
import type { BuiltinCategory, Category } from "./types";

interface CategoryStyle {
  label: string;
  emoji: string;
  /** The pencil glyph drawn in list rows and on map pins. */
  glyph: GlyphName;
  /** Pin colour, readable on both light and dark map flavours. */
  color: string;
}

export const CATEGORY_STYLES: Record<BuiltinCategory, CategoryStyle> = {
  restaurant: { label: "Restaurant", emoji: "🍛", glyph: "bowl", color: "#d9480f" },
  "cafe-bar": { label: "Café/Bar", emoji: "☕", glyph: "cup", color: "#9c36b5" },
  movies: { label: "Movies", emoji: "🎬", glyph: "film", color: "#c2255c" },
  recreation: { label: "Recreation", emoji: "🌳", glyph: "arch", color: "#2f9e44" },
  beach: { label: "Beach", emoji: "🏖️", glyph: "umbrella", color: "#0c8599" },
};

const CUSTOM_STYLE: CategoryStyle = { label: "Other", emoji: "📍", glyph: "spot", color: "#5c5f66" };

export function categoryStyle(category: Category): CategoryStyle {
  if (category.startsWith("custom:")) {
    const name = category.slice("custom:".length).replace(/-/g, " ");
    return { ...CUSTOM_STYLE, label: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  return CATEGORY_STYLES[category as BuiltinCategory];
}

export const STATUS_LABELS = { visited: "Visited", want: "Want to" } as const;
