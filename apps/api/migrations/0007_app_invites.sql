-- Phase 4: app invites replace open signup after the first (admin) account.
--
-- The admin's device makes a random code and shares it as a link with the code
-- after the '#'. The Worker stores only an id derived from the code, so it never
-- sees the code. An invite works once and for seven days. master_keys holds every
-- master key version wrapped to a keypair derived from the code, as JSON
-- [{ keyVersion, wrappedKey }], so only the friend holding the link can open them.
CREATE TABLE app_invites (
  id                    TEXT PRIMARY KEY,
  created_by_device_id  TEXT NOT NULL REFERENCES devices (id),
  master_keys           TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  used_at               INTEGER,
  used_by_account_id    TEXT REFERENCES accounts (id)
);
CREATE INDEX app_invites_expires ON app_invites (expires_at);
