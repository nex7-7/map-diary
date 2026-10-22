"use client";

import type { CSSProperties, ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface NotebookTab {
  id: string;
  label: string;
  /** The divider's card-stock colour. */
  tint: string;
  /** Shown on the chosen divider, such as how many places are on it. */
  count?: number | undefined;
}

/**
 * A spiral notebook: a kraft cover behind, a divider tab per board tucked under the front
 * page, slivers of the dividers on the right edge, and the page itself with a dot grid and a
 * faint red margin. Rows on the page should keep clear of the margin (about 48px).
 */
export function Notebook({
  label,
  tabs,
  value,
  onValueChange,
  className,
  pageClassName,
  children,
}: {
  label: string;
  tabs: readonly NotebookTab[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
  pageClassName?: string;
  children: ReactNode;
}) {
  const current = tabs.find((t) => t.id === value) ?? tabs[0];
  return (
    <Tabs value={current?.id ?? ""} onValueChange={onValueChange} className={cn("nb min-h-0", className)} style={{ "--tint": current?.tint } as CSSProperties}>
      <div className="nb-cover" aria-hidden />
      <TabsList variant="notebook" aria-label={label}>
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} style={{ "--t": t.tint } as CSSProperties}>
            {t.label}
            {t.id === current?.id && t.count !== undefined && <span className="n">{t.count}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="nb-slivers" aria-hidden>
        {tabs.slice(0, 6).map((t) => (
          <span key={t.id} style={{ "--t": t.tint } as CSSProperties} />
        ))}
      </div>
      <div className="nb-spiral" aria-hidden />
      <TabsContent value={current?.id ?? ""} forceMount className={cn("nb-page dot-grid", pageClassName)}>
        {children}
      </TabsContent>
    </Tabs>
  );
}

/** Divider tints for boards: All is yellow, Personal grey, Public blue, groups take turns. */
export function boardTint(kind: "all" | "personal" | "master" | "group", groupIndex = 0): string {
  if (kind === "all") return "var(--tint-all)";
  if (kind === "personal") return "var(--tint-personal)";
  if (kind === "master") return "var(--tint-public)";
  return groupIndex % 2 === 0 ? "var(--tint-group)" : "var(--tint-group-2)";
}
