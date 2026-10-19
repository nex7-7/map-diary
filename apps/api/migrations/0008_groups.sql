-- Phase 5: groups, group invites, and leaving or removing a member.
--
-- A group is a board of kind 'group'. Its name is in a 'group' envelope on the board
-- itself, so the server never sees it. Group invites use the existing invites table.

-- When a member leaves, the leaver must not pick the next key, so the board is marked and
-- a remaining member's device rotates it on its next sync.
ALTER TABLE boards ADD COLUMN rotation_due_at INTEGER;

-- When someone leaves or is removed, their envelopes leave that group's board. An envelope
-- posted only there is deleted. One also posted to other boards stays there, but its row
-- for the group is marked removed rather than deleted: the author's signature covers the
-- full list of boards, so the row is still sent for verification, while nobody receives
-- the envelope through that board any more.
ALTER TABLE envelope_boards ADD COLUMN removed_at INTEGER;

CREATE INDEX invites_board ON invites (board_id);
