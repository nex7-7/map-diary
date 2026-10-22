"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

/*
 * Tabs come in two kinds: notebook dividers (card-stock tabs tucked under the page, see
 * .nb-tabs in app/ink.css) and chips.
 */
function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

const tabsListVariants = cva("", {
  variants: {
    variant: {
      notebook: "nb-tabs",
      chips: "flex gap-2 overflow-x-auto [scrollbar-width:none]",
    },
  },
  defaultVariants: {
    variant: "chips",
  },
})

const TabsVariant = React.createContext<"notebook" | "chips">("chips")

function TabsList({
  className,
  variant = "chips",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const v = variant ?? "chips"
  return (
    <TabsVariant.Provider value={v}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={v}
        className={cn(tabsListVariants({ variant: v }), className)}
        {...props}
      />
    </TabsVariant.Provider>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariant)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        variant === "notebook" ? "nb-tab" : "chip",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
