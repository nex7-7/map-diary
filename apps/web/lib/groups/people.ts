import type { Diary } from "@map-diary/sync";

/**
 * How a member is shown. Nobody has a display name on the app yet, so other people show as
 * a short, stable label from their account id until names arrive.
 */
export function memberName(diary: Diary, accountId: string): string {
  return accountId === diary.device.accountId ? "You" : `Friend ${accountId.slice(0, 4)}`;
}
