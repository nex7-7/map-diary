import { ICON_PATHS, type IconName } from "./icon-paths";

const SIZES = { s: 14, m: 16, base: 20, l: 22 } as const;

/** A line icon. Decorative unless given a `label`. */
export function Icon({ name, size = "base", label }: { name: IconName; size?: keyof typeof SIZES; label?: string }) {
  const px = SIZES[size];
  return (
    <svg
      className="flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:var(--icon-stroke,1.75)]"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // Static markup from icon-paths.ts, never user data.
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  );
}
