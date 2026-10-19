import { GroupError, MAX_GROUP_MEMBERS } from "@/lib/groups";
import type { GroupErrorCode } from "@map-diary/sync";

const MESSAGES: Record<GroupErrorCode, string> = {
  invalid_link: "That isn't a whole invite link. Ask for the link again and paste all of it.",
  invite_not_found: "That invite has expired or was already used. Ask for a new link.",
  already_member: "You're already in this group.",
  group_full: `This group already has ${MAX_GROUP_MEMBERS} people, the most a group can have.`,
  stale: "The group changed while this was open. Reload and try again.",
  offline: "You're offline. Connect and try again.",
  server: "Something went wrong on the server. Try again in a moment.",
};

export function groupErrorMessage(err: unknown): string {
  return err instanceof GroupError ? MESSAGES[err.code] : MESSAGES.server;
}
