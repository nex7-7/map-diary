import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "claude";

interface Look {
  variant?: ButtonVariant | undefined;
  /** "m" is the compact size used inside cards and rows. */
  size?: "l" | "m" | undefined;
  block?: boolean | undefined;
}

const VARIANTS = { primary: "default", secondary: "outline", ghost: "ghost", danger: "destructive", claude: "claude" } as const;

/** Class names for anything that should look like a button (the shadcn button, in ink). */
export function buttonClass({ variant = "primary", size = "l", block = false }: Look = {}, extra?: string): string {
  return cn(buttonVariants({ variant: VARIANTS[variant], size: size === "m" ? "sm" : "default" }), block && "w-full", extra);
}

export function Button({ variant, size, block, className, type = "button", ...rest }: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={buttonClass({ variant, size, block }, className)} {...rest} />;
}

/** A link that looks like a button. */
export function ButtonLink({ variant, size, block, className, ...rest }: Look & ComponentProps<typeof Link>) {
  return <Link className={buttonClass({ variant, size, block }, className)} {...rest} />;
}
