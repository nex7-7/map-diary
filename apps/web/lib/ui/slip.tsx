import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A taped paper slip for "this place is already known": a link added twice, a name that
 * matches a place on the map, a new branch of a chain. One look in the Add sheet and the Inbox.
 */
export function Slip({ kicker, children, className }: { kicker: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("slip relative mt-2 flex flex-col gap-1.5 rounded-xl border-[1.5px] border-[#b8a077] bg-[#fbf3d0] px-3.5 pt-[18px] pb-2 text-[14px] leading-[1.45] text-ink", className)}>
      <span className="tape -top-[9px] left-[22px] [transform:rotate(-4deg)]" aria-hidden="true" />
      <p className="m-0 text-[10.5px] font-semibold tracking-[0.16em] text-[#6a5530] uppercase">{kicker}</p>
      {children}
    </div>
  );
}
