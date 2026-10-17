PRAGMA foreign_keys = ON;

-- "Recent calls": which accounts have been in which call (used to offer "join again").
CREATE TABLE IF NOT EXISTS call_members (
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_joined_at INTEGER NOT NULL,
  last_joined_at INTEGER NOT NULL,
  PRIMARY KEY (call_id, user_id)
);

CREATE INDEX IF NOT EXISTS call_members_user_idx ON call_members(user_id, last_joined_at);
