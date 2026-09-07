-- A link to the recurring call for these 1:1s, so the meeting can be opened from the tool.
--
-- It lives on the person rather than on the meeting because a 1:1 normally has a permanent
-- room, and retyping it every time would be a chore. A per-occurrence override would be a
-- separate column on meeting; nothing needs it yet.
--
-- Not part of a shared snapshot: it is an internal convenience, and the mentee already has
-- the link from the calendar invite.

ALTER TABLE person ADD COLUMN meeting_url TEXT;
