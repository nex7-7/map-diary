import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
 * Ink & Paper buttons: a 2px ink outline sitting on a hard ink shadow, which squishes flat
 * when pressed. The main action is inked in vermilion like a seal.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 border-2 border-ink font-sans font-bold whitespace-nowrap no-underline transition-[transform,box-shadow,background-color] duration-200 ease-spring outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 enabled:active:translate-y-[3px] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-seal text-cream shadow-[0_4px_0_var(--ink)] hover:bg-[#b5322b] active:translate-y-[3px] active:shadow-[0_1px_0_var(--ink)]",
        ink: "bg-ink text-page shadow-[0_4px_0_var(--seal)] active:translate-y-[3px] active:shadow-[0_1px_0_var(--seal)]",
        outline: "page text-ink shadow-[0_4px_0_var(--ink)] hover:bg-paper-deep active:translate-y-[3px] active:shadow-[0_1px_0_var(--ink)]",
        secondary: "page text-ink shadow-[0_4px_0_var(--ink)] hover:bg-paper-deep active:translate-y-[3px] active:shadow-[0_1px_0_var(--ink)]",
        destructive:
          "page border-seal-deep text-seal-deep shadow-[0_4px_0_var(--seal-deep)] hover:bg-seal-wash active:translate-y-[3px] active:shadow-[0_1px_0_var(--seal-deep)]",
        claude: "bg-clay text-cream shadow-[0_4px_0_var(--ink)] active:translate-y-[3px] active:shadow-[0_1px_0_var(--ink)]",
        ghost: "border-transparent bg-transparent text-ink-2 shadow-none hover:bg-paper-deep/70 hover:text-ink active:translate-y-0",
        link: "h-auto border-0 bg-transparent p-0 font-semibold text-ink underline decoration-seal/60 decoration-wavy decoration-[1.2px] underline-offset-4 shadow-none hover:text-seal active:translate-y-0",
      },
      size: {
        default: "h-12 rounded-[14px] px-5 text-[15px] has-[>svg]:px-4",
        sm: "h-9 gap-1.5 rounded-[11px] border-[1.5px] px-3.5 text-[13px] has-[>svg]:px-3",
        lg: "h-[52px] rounded-[16px] px-6 text-base",
        icon: "size-11 rounded-full",
        "icon-sm": "size-9 rounded-full border-[1.5px]",
      },
    },
    compoundVariants: [
      // Small buttons sit on a shallower shadow.
      { size: ["sm", "icon-sm"], variant: ["default", "outline", "secondary", "claude"], className: "shadow-[0_3px_0_var(--ink)]" },
      { size: ["sm", "icon-sm"], variant: "destructive", className: "shadow-[0_3px_0_var(--seal-deep)]" },
      { size: ["sm", "icon-sm"], variant: "ink", className: "shadow-[0_3px_0_var(--seal)]" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
