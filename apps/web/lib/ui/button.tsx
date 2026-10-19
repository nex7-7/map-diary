import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import s from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "claude";

interface Look {
  variant?: ButtonVariant | undefined;
  /** "m" is the compact size used inside cards and rows. */
  size?: "l" | "m" | undefined;
  block?: boolean | undefined;
}

/** Class names for anything that should look like a button. */
export function buttonClass({ variant = "primary", size = "l", block = false }: Look = {}, extra?: string): string {
  return [s.button, variant !== "primary" && s[variant], size === "m" && s.m, block && s.block, extra].filter(Boolean).join(" ");
}

export function Button({ variant, size, block, className, type = "button", ...rest }: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={buttonClass({ variant, size, block }, className)} {...rest} />;
}

/** A link that looks like a button. */
export function ButtonLink({ variant, size, block, className, ...rest }: Look & ComponentProps<typeof Link>) {
  return <Link className={buttonClass({ variant, size, block }, className)} {...rest} />;
}
