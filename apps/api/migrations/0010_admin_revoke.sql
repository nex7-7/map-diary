-- The admin panel can sign out any device on the app. The server refuses the device at once,
-- but only its owner can move their account to new keys (those are derived from their
-- recovery seed), so the device is marked here until one of the owner's remaining devices
-- finishes the revoke from the Devices screen with the passphrase or recovery phrase.
ALTER TABLE devices ADD COLUMN rekey_due_at INTEGER;
