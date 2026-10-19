import {
  PASSPHRASE_MIN_LENGTH,
  PairingError,
  SetupError,
  type PairingErrorCode,
  type SetupErrorCode,
} from "@map-diary/sync";

const MESSAGES: Record<SetupErrorCode, string> = {
  passphrase_too_short: `Use at least ${PASSPHRASE_MIN_LENGTH} characters. A short sentence works well.`,
  wrong_passphrase: "That passphrase didn't match. Check it and try again.",
  invalid_recovery_phrase: "That recovery phrase has a typo. Check each group of four.",
  unknown_recovery_phrase: "No account uses that recovery phrase.",
  registration_closed: "This diary is already set up. Sign in with your passphrase instead.",
  passphrase_in_use: "Choose a different passphrase.",
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
