-- Phase 4: app invites replace open signup after the first (admin) account.
--
-- The admin's device makes a random code and shares it as a link with the code
-- after the '#'. The Worker stores only an id derived from the code, so it never
-- sees the code. An invite works once and for seven days. sealed_keys will carry
-- keys sealed under a key derived from the code (the master key, once sharing
-- exists); it is empty until then.
CREATE TABLE app_invites (
  id                    TEXT PRIMARY KEY,
  created_by_device_id  TEXT NOT NULL REFERENCES devices (id),
  sealed_keys           BLOB,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  used_at               INTEGER,
  used_by_account_id    TEXT REFERENCES accounts (id)
);
CREATE INDEX app_invites_expires ON app_invites (expires_at);
