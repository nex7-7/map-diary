import {
  InviteError,
  PASSPHRASE_MIN_LENGTH,
  PairingError,
  RevokeError,
  SetupError,
  type InviteErrorCode,
  type PairingErrorCode,
  type RevokeErrorCode,
  type SetupErrorCode,
} from "@map-diary/sync";

const MESSAGES: Record<SetupErrorCode, string> = {
  passphrase_too_short: `Use at least ${PASSPHRASE_MIN_LENGTH} characters. A short sentence works well.`,
  wrong_passphrase: "That passphrase didn't match. Check it and try again.",
  invalid_recovery_phrase: "That recovery phrase has a typo. Check each group of four.",
  unknown_recovery_phrase: "No account uses that recovery phrase.",
  registration_closed: "This diary is already set up. You need an invite link from Snehil to join, or sign in if you already have.",
  passphrase_in_use: "Choose a different passphrase.",
  bad_invite: "That invite code has a typo. It is twenty letters and digits, like 7K3QM-9XT2B-QW4RT-ZP0HK.",
  invite_invalid: "That invite has expired or was already used. Ask for a new one.",
  invite_stale: "That invite is out of date because the diary's keys changed since it was made. Ask for a new one.",
  wrong_account: "That recovery phrase belongs to a different account.",
  offline: "You're offline. Connect and try again.",
  server: "Something went wrong on the server. Try again in a moment.",
};

export function errorMessage(err: unknown): string {
  return err instanceof SetupError ? MESSAGES[err.code] : MESSAGES.server;
}

/** iOS Safari evicts storage of sites that are not installed to the Home Screen. */
export function needsHomeScreenInstall(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

const PAIRING_MESSAGES: Record<PairingErrorCode, string> = {
  bad_code: "That code has a typo. It is ten letters and digits, like 7K3QM-9XT2B.",
  expired: "That code has expired or was already used. Make a new one on your other device.",
  tampered: "The device that answered didn't come from your code, so it wasn't added. Make a new code and try again.",
  offline: "You're offline. Connect and try again.",
  server: "Something went wrong on the server. Try again in a moment.",
};

export function pairingErrorMessage(err: unknown): string {
  return err instanceof PairingError ? PAIRING_MESSAGES[err.code] : PAIRING_MESSAGES.server;
}

const REVOKE_MESSAGES: Record<RevokeErrorCode, string> = {
  wrong_passphrase: "That passphrase didn't match. Check it and try again.",
  invalid_recovery_phrase: "That recovery phrase has a typo. Check each group of four.",
  wrong_account: "That recovery phrase belongs to a different account.",
  stale: "Your devices changed while this was open. Try again.",
  offline: "You're offline. Connect and try again.",
  server: "Something went wrong on the server. Try again in a moment.",
};

export function revokeErrorMessage(err: unknown): string {
  return err instanceof RevokeError ? REVOKE_MESSAGES[err.code] : REVOKE_MESSAGES.server;
}

const INVITE_MESSAGES: Record<InviteErrorCode, string> = {
  too_many: "There are already ten open invites. Cancel one first.",
  no_master: "The Public board isn't set up on this device yet. Open the diary, let it sync, then try again.",
  stale: "The diary's keys just changed. Open the diary, let it sync, then try again.",
  not_found: "That's already gone. Reload to see the latest.",
  forbidden: "Only the admin can do that.",
  offline: "You're offline. Connect and try again.",
  server: "Something went wrong on the server. Try again in a moment.",
};

export function inviteErrorMessage(err: unknown): string {
  return err instanceof InviteError ? INVITE_MESSAGES[err.code] : INVITE_MESSAGES.server;
}
