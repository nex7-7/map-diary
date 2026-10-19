-- Phase 4: revoking a device moves the account to the next box key version.
--
-- The device that revokes derives the new account box keypair from the recovery
-- seed and seals its secret half to each remaining device's own X25519 key. Each
-- device collects its copy here when it sees the account's version move on. The
-- revoked device gets none, so it cannot open board keys wrapped from then on.
CREATE TABLE device_account_keys (
  device_id            TEXT NOT NULL REFERENCES devices (id),
  account_key_version  INTEGER NOT NULL,
  sealed_key           BLOB NOT NULL,  -- crypto_box_seal to the device's box key
  created_at           INTEGER NOT NULL,
  PRIMARY KEY (device_id, account_key_version)
);
