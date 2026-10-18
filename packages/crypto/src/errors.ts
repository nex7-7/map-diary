export type CryptoErrorCode =
  | "bad_signature"
  | "no_board_key"
  | "decrypt_failed"
  | "bad_payload"
  | "bad_backup"
  | "unsupported_version"
  | "invalid_input";

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = "CryptoError";
    this.code = code;
  }
}
