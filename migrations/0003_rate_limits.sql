PRAGMA foreign_keys = ON;

-- Fixed-window counters used to slow down brute-force logins, mass sign-ups and request spam.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Note: call_invites.kind ('quick' | 'join') is added by the Worker itself the first time it runs
-- (SQLite cannot "ADD COLUMN IF NOT EXISTS", so it is not part of a replayable migration).
