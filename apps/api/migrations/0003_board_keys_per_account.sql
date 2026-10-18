-- Phase 4: board keys are wrapped to people, not devices.
--
-- Each account has a versioned X25519 keypair derived on the device from the
-- recovery seed. Board keys are sealed to the account's public key once per
-- person, and every device of the account holds the secret half, so a new
-- device sees every board at once and rotating a group key re-wraps for at
-- most a handful of people. Revoking a device (later) moves the account to
-- the next box key version.
ALTER TABLE accounts ADD COLUMN box_public_key BLOB;
ALTER TABLE accounts ADD COLUMN box_key_version INTEGER NOT NULL DEFAULT 1;

-- board_keys was keyed by device. It holds no rows in production (no account,
-- and so no device, existed when this ran), so it is rebuilt rather than
-- migrated.
DROP TABLE board_keys;
CREATE TABLE board_keys (
  board_id             TEXT NOT NULL REFERENCES boards (id),
  key_version          INTEGER NOT NULL,
  account_id           TEXT NOT NULL REFERENCES accounts (id),
  account_key_version  INTEGER NOT NULL,  -- the account box key it is sealed to
  wrapped_key          BLOB NOT NULL,
  created_at           INTEGER NOT NULL,
  PRIMARY KEY (board_id, key_version, account_id)
);
CREATE INDEX board_keys_account ON board_keys (account_id);
