-- Phase 4: linking a new device from one already signed in.
--
-- The old device shows a link whose secret (after the '#') never reaches the
-- server. The row is filed under an id derived from that secret. The new
-- device's public keys, a MAC over them under a key derived from the secret,
-- and finally the account keys sealed to the new device are all opaque to
-- the Worker. Rows last ten minutes; the cron trigger removes stale ones.
CREATE TABLE pairings (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL REFERENCES accounts (id),
  created_by_device_id  TEXT NOT NULL REFERENCES devices (id),
  -- Filled in when the new device joins.
  device_id             TEXT,
  kind                  TEXT CHECK (kind IN ('web', 'android', 'claude')),
  sign_public_key       BLOB,
  box_public_key        BLOB,
  join_mac              BLOB,
  -- Filled in when the old device approves: account keys sealed to the new device.
  sealed_transfer       BLOB,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  joined_at             INTEGER,
  approved_at           INTEGER
);
CREATE INDEX pairings_account ON pairings (account_id);
CREATE INDEX pairings_expiry ON pairings (expires_at);
