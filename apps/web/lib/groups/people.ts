/**
 * How a group member is shown: "You", their display name, or a short stable label from their
 * account id until their name has synced.
 */
export function memberName(accountId: string, me: string, names: ReadonlyMap<string, string>): string {
  if (accountId === me) return "You";
  return names.get(accountId) ?? `Friend ${accountId.slice(0, 4)}`;
}
