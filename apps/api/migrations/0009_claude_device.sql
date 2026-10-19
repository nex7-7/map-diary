-- Phase 6: the Claude assistant as a device of kind 'claude'.
--
-- Unlike the person's other devices, a Claude device never holds the account box key
-- (that would open every board the person is in, groups included). Instead the master and
-- Personal board keys, every version, are sealed straight to the Claude device's own X25519
-- key in device_board_keys. The person's other devices add each new version after a
-- rotation on their next sync.
--
-- The Claude device's secret keys are stored here sealed under a key derived from the
-- connector secret, which only the Claude connector holds. The Worker finds the device by
-- secret_hash (also derived from the secret) and can open the keys only while a call that
-- carries the secret runs. Revoking the device deletes both.
CREATE TABLE claude_connectors (
  device_id    TEXT PRIMARY KEY REFERENCES devices (id),
  secret_hash  BLOB NOT NULL UNIQUE,
  nonce        BLOB NOT NULL,
  sealed_keys  BLOB NOT NULL,   -- XChaCha20-Poly1305 under a key derived from the secret
  created_at   INTEGER NOT NULL
);

CREATE TABLE device_board_keys (
  device_id    TEXT NOT NULL REFERENCES devices (id),
  board_id     TEXT NOT NULL REFERENCES boards (id),
  key_version  INTEGER NOT NULL,
  wrapped_key  BLOB NOT NULL,   -- crypto_box_seal to the device's box key
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (device_id, board_id, key_version)
);
