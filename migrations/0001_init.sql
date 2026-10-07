PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT 'aurora',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS users_username_lower_idx ON users(username_lower);
CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users(last_seen_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined')) DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  UNIQUE(requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships(addressee_id, status);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Friend Call',
  status TEXT NOT NULL CHECK(status IN ('waiting','active','ended')) DEFAULT 'waiting',
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE INDEX IF NOT EXISTS calls_host_idx ON calls(host_id, status);

CREATE TABLE IF NOT EXISTS call_invites (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  caller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('ringing','accepted','declined','cancelled','expired')) DEFAULT 'ringing',
  created_at INTEGER NOT NULL,
  responded_at INTEGER
);

CREATE INDEX IF NOT EXISTS call_invites_callee_idx ON call_invites(callee_id, status, created_at);
CREATE INDEX IF NOT EXISTS call_invites_caller_idx ON call_invites(caller_id, status, created_at);
