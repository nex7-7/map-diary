import type { SignatureDish } from "./types";

/** The small heading over a wallet bleeder: how its price was picked. */
export function dishCaption(dish: SignatureDish): string {
  if (dish.rule === "popular") return "Wallet bleeder · most popular";
  if (dish.rule && dish.dishes && dish.dishes.length > 1) return `Wallet bleeder · median of ${dish.dishes.length}`;
  if (dish.rule) return "Wallet bleeder";
  return "Wallet bleeder · signature dish";
}

/** The dishes a median was taken over, cheapest first; none for a single dish. */
export function dishBasis(dish: SignatureDish): { name: string; priceInr: number }[] {
  if (dish.rule === "popular" || !dish.dishes || dish.dishes.length < 2) return [];
  return [...dish.dishes].sort((a, b) => a.priceInr - b.priceInr);
}
