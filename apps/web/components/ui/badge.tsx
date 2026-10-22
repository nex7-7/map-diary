import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
 * Little marks on paper: rubber stamps for boards and states (grit-masked, slightly askew),
 * die-cut stickers for tags, and an inked label for NEW.
 */
const badgeVariants = cva(
  "w-fit shrink-0 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        personal: "board personal",
        public: "board public",
        group: "board group",
        claude: "board claude",
        ok: "board ok",
        warn: "board warn",
        sticker: "sticker",
        label: "label-ink text-[9px] font-bold tracking-[0.1em]",
      },
    },
    defaultVariants: {
      variant: "personal",
    },
  }
)

function Badge({
  className,
  variant = "personal",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
