-- Phase 1: envelope schema.
--
-- The server is blind: nothing here holds plaintext opinions, place facts or
-- keys. Every BLOB column is ciphertext, a public key, a signature or a keyed
-- hash produced on a device. What the server can see is the metadata the
-- architecture accepts as a known leak: ids, types, authors, boards,
-- timestamps and signatures.
--
-- Timestamps are integer milliseconds since the Unix epoch.

-- A person on the app. Display names and profiles live inside envelopes.
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  is_admin    INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER
);

-- Each device is a separate member with its own keys (browser, Android app,
-- Claude connector), so any one can be revoked alone.
CREATE TABLE devices (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES accounts (id),
  kind             TEXT NOT NULL CHECK (kind IN ('web', 'android', 'claude')),
  sign_public_key  BLOB NOT NULL,   -- Ed25519
  box_public_key   BLOB NOT NULL,   -- X25519
  created_at       INTEGER NOT NULL,
  last_seen_at     INTEGER,
  revoked_at       INTEGER
);
CREATE INDEX devices_account ON devices (account_id);

-- A board is an audience with its own symmetric key. Group names and other
-- group details are encrypted in a 'group' envelope on the board itself.
CREATE TABLE boards (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('master', 'group', 'personal')),
  owner_account_id   TEXT REFERENCES accounts (id),  -- set for personal boards only
  key_version        INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  CHECK ((kind = 'personal') = (owner_account_id IS NOT NULL))
);
CREATE UNIQUE INDEX boards_one_master ON boards (kind) WHERE kind = 'master';
CREATE UNIQUE INDEX boards_one_personal ON boards (owner_account_id) WHERE kind = 'personal';

CREATE TABLE board_members (
  board_id    TEXT NOT NULL REFERENCES boards (id),
  account_id  TEXT NOT NULL REFERENCES accounts (id),
  joined_at   INTEGER NOT NULL,
  PRIMARY KEY (board_id, account_id)
);
CREATE INDEX board_members_account ON board_members (account_id);

-- A board key, sealed to one device's X25519 public key. Rotation adds a new
-- key_version and re-wraps it for the remaining devices.
CREATE TABLE board_keys (
  board_id     TEXT NOT NULL REFERENCES boards (id),
  key_version  INTEGER NOT NULL,
  device_id    TEXT NOT NULL REFERENCES devices (id),
  wrapped_key  BLOB NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (board_id, key_version, device_id)
);
CREATE INDEX board_keys_device ON board_keys (device_id);

-- One row per envelope, matching the wire format in
-- packages/crypto/src/envelope.ts (binary fields are stored as raw bytes, not
-- base64url). Each item is encrypted once with a random content key (see
-- envelope_boards). Every envelope has exactly one author, so sync is
-- last-write-wins per envelope on updated_at.
--
-- type is validated by the Worker rather than a CHECK, so new types do not
-- need a table rebuild.
--
-- seq is a server-assigned, strictly increasing change number used as the
-- sync cursor; every insert, update or tombstone gets a new one.
-- A deleted envelope keeps its row with ciphertext cleared, so other devices
-- learn on their next sync to drop their cached copy.
CREATE TABLE envelopes (
  id                 TEXT PRIMARY KEY,
  v                  INTEGER NOT NULL,
  type               TEXT NOT NULL,
  author_id          TEXT NOT NULL REFERENCES accounts (id),
  device_id          TEXT NOT NULL REFERENCES devices (id),
  place_id           TEXT,   -- the place an opinion attaches to; NULL otherwise
  created_at         INTEGER NOT NULL,   -- client clock
  updated_at         INTEGER NOT NULL,   -- client clock; last write wins
  nonce              BLOB,
  ciphertext         BLOB,   -- XChaCha20-Poly1305 under the content key; NULL once deleted
  signature          BLOB NOT NULL,  -- Ed25519 by device_id over every other field
  server_updated_at  INTEGER NOT NULL,
  deleted_at         INTEGER,
  seq                INTEGER NOT NULL UNIQUE,
  CHECK ((deleted_at IS NULL) = (ciphertext IS NOT NULL AND nonce IS NOT NULL))
);
CREATE INDEX envelopes_place ON envelopes (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX envelopes_author ON envelopes (author_id);

-- The envelope's content key, wrapped once per chosen board under that
-- board's key at key_version.
CREATE TABLE envelope_boards (
  envelope_id  TEXT NOT NULL REFERENCES envelopes (id),
  board_id     TEXT NOT NULL REFERENCES boards (id),
  key_version  INTEGER NOT NULL,
  nonce        BLOB NOT NULL,
  wrapped_key  BLOB NOT NULL,
  seq          INTEGER NOT NULL,  -- copy of envelopes.seq for per-board sync
  PRIMARY KEY (envelope_id, board_id)
);
CREATE INDEX envelope_boards_sync ON envelope_boards (board_id, seq);

-- Duplicate places are blocked by a keyed hash of the normalised source link,
-- computed on the device with a key the server never sees.
CREATE TABLE place_link_hashes (
  link_hash   BLOB PRIMARY KEY,
  place_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Encrypted key backup for multi-device sign-in and recovery. The key is
-- derived on the device from the passphrase with Argon2id.
CREATE TABLE key_backups (
  account_id   TEXT PRIMARY KEY REFERENCES accounts (id),
  kdf_salt     BLOB NOT NULL,
  kdf_ops      INTEGER NOT NULL,
  kdf_mem      INTEGER NOT NULL,
  nonce        BLOB NOT NULL,
  ciphertext   BLOB NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Group invites. The invite secret stays after the '#' and never reaches the
-- server; the server stores only a hash to look the invite up and the keys
-- encrypted under a key derived from the secret.
CREATE TABLE invites (
  id                    TEXT PRIMARY KEY,
  board_id              TEXT NOT NULL REFERENCES boards (id),
  created_by_device_id  TEXT NOT NULL REFERENCES devices (id),
  secret_hash           BLOB NOT NULL UNIQUE,
  nonce                 BLOB NOT NULL,
  sealed_keys           BLOB NOT NULL,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  used_at               INTEGER,
  used_by_account_id    TEXT REFERENCES accounts (id)
);

-- Anonymous resolver jobs. The resolver sees only the link or name; no account
-- is attached. The Worker encrypts the result to the job's one-time public
-- key and drops the plaintext query; only the sealed result waits for the
-- device. A cron trigger expires stale jobs.
CREATE TABLE resolver_jobs (
  id                 TEXT PRIMARY KEY,
  query              TEXT,            -- cleared once resolved
  reply_public_key   BLOB NOT NULL,   -- one-time X25519 key
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'resolved', 'failed')),
  sealed_result      BLOB,
  attempts           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  CHECK ((status = 'resolved') = (sealed_result IS NOT NULL))
);
CREATE INDEX resolver_jobs_status ON resolver_jobs (status, created_at);
CREATE INDEX resolver_jobs_expiry ON resolver_jobs (expires_at);
