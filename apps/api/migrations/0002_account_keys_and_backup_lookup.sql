-- Phase 2: device authorisation and passphrase sign-in.
--
-- Each account has a long-term Ed25519 key that lives only inside the
-- passphrase key backup. It signs each new device's public keys, which is how
-- the server knows a device belongs to the account. NULL is allowed only
-- because SQLite cannot add a NOT NULL column without a default; the Worker
-- always sets it.
ALTER TABLE accounts ADD COLUMN sign_public_key BLOB;

-- A new device knows only the passphrase, so it fetches the backup by a
-- lookup id derived from the passphrase on the device (Argon2id), never by
-- account id. key_backups held no rows before this migration (no endpoint
-- wrote to it), so it is rebuilt rather than altered.
DROP TABLE key_backups;
CREATE TABLE key_backups (
  account_id   TEXT PRIMARY KEY REFERENCES accounts (id),
  lookup       BLOB NOT NULL UNIQUE,
  v            INTEGER NOT NULL,
  kdf          TEXT NOT NULL,
  kdf_salt     BLOB NOT NULL,
  kdf_ops      INTEGER NOT NULL,
  kdf_mem      INTEGER NOT NULL,
  nonce        BLOB NOT NULL,
  ciphertext   BLOB NOT NULL,
  updated_at   INTEGER NOT NULL
);
