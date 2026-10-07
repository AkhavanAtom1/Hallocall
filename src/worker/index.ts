export interface Env {
  HALLOCALL_DB: D1Database;
  CALL_ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  SESSION_TTL_DAYS: string;
  ONLINE_WINDOW_SECONDS: string;
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

type SafeUser = { id: string; username: string; avatar: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const AVATARS = new Set([
  "ronaldo_red","ronaldo_white","ronaldo_black","messi_barca_blue","messi_barca_purple",
  "ronaldinho_brazil","ronaldinho_milan","neymar_brazil","neymar_barca","dybala_juve",
  "ronaldo_red_alt","messi_argentina","mbappe_france","van_dijk_netherlands","haaland_city",
  "aurora","ember","ocean","violet","mint","sunset","cosmic","rose","bolt","forest","pearl","lava"
]);

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) } });
}
function now() { return Date.now(); }
function uuid() { return crypto.randomUUID(); }
function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(7); crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
function bytesToB64(bytes: Uint8Array) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function b64ToBytes(value: string) { const raw = atob(value); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToB64(new Uint8Array(hash));
}
async function hashPassword(proof: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode("hallocall-server-salt:v3:" + bytesToB64(salt) + ":" + proof),
  );
  return `sha256$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(digest))}`;
}

async function verifyPassword(proof: string, stored: string) {
  const parts = stored.split("$");
  if (parts[0] === "sha256" && parts.length === 3) {
    const expected = b64ToBytes(parts[2]);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode("hallocall-server-salt:v3:" + parts[1] + ":" + proof),
    );
    const actual = new Uint8Array(digest);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  }

  // Compatibility for accounts created by the previous PBKDF2 format.
  if (parts[0] !== "pbkdf2" || parts.length !== 4) return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1 || iterations > 100_000) return false;
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const key = await crypto.subtle.importKey("raw", encoder.encode(proof), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, expected.length * 8);
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function cookies(req: Request) {
  const raw = req.headers.get("Cookie") ?? "";
  return Object.fromEntries(raw.split(";").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf("="); return [i >= 0 ? p.slice(0, i) : p, i >= 0 ? decodeURIComponent(p.slice(i + 1)) : ""];
  }));
}
const SESSION_COOKIE = "hallocall_session";
const MAX_CALL_PARTICIPANTS = 8;

type SessionRecord = {
  token: string;
  tokenHash: string;
  userId: string;
  createdAt: number;
  expires: number;
};

function sessionTtlMs(env: Env) {
  const configured = Number(env.SESSION_TTL_DAYS);
  const days = Number.isFinite(configured) ? Math.min(365, Math.max(1, configured)) : 30;
  return days * 24 * 60 * 60 * 1000;
}

async function buildSession(env: Env, userId: string): Promise<SessionRecord> {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = bytesToB64(tokenBytes);
  const createdAt = now();
  return {
    token,
    tokenHash: await sha256(token),
    userId,
    createdAt,
    expires: createdAt + sessionTtlMs(env),
  };
}

async function createSession(env: Env, userId: string) {
  const session = await buildSession(env, userId);
  await env.HALLOCALL_DB.prepare(
    `INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?1,?2,?3,?4)`
  ).bind(session.tokenHash, session.userId, session.createdAt, session.expires).run();
  return session;
}

function sessionCookie(token: string, expires: number, secure: boolean) {
  const maxAge = Math.max(1, Math.floor((expires - now()) / 1000));
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${new Date(expires).toUTCString()}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function clearCookie(secure: boolean) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

async function friendshipBetween(env: Env, firstUserId: string, secondUserId: string) {
  if (!firstUserId || !secondUserId || firstUserId === secondUserId) return null;
  return env.HALLOCALL_DB.prepare(
    `SELECT id, requester_id, addressee_id, status, created_at
     FROM friendships
     WHERE (requester_id=?1 AND addressee_id=?2)
        OR (requester_id=?2 AND addressee_id=?1)
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(firstUserId, secondUserId).first<{
    id:string;
    requester_id:string;
    addressee_id:string;
    status:"pending"|"accepted"|"declined";
    created_at:number;
  }>();
}

async function uniqueCallCode(env: Env) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode();
    const existing = await env.HALLOCALL_DB.prepare(
      `SELECT id FROM calls WHERE code=?1 LIMIT 1`
    ).bind(code).first();
    if (!existing) return code;
  }
  throw new Error("Unable to allocate a unique call code.");
}

function callJson(row: { id:string; code:string; name:string; host_id:string; status:string }) {
  const status = row.status === "active" ? "active" : row.status === "ended" ? "ended" : "waiting";
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    hostId: row.host_id,
    status,
  };
}

async function currentUser(env: Env, req: Request): Promise<SafeUser | null> {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.HALLOCALL_DB.prepare(
    `SELECT u.id, u.username, u.avatar, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?1 LIMIT 1`
  ).bind(tokenHash).first<{ id: string; username: string; avatar: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at <= now()) {
    await env.HALLOCALL_DB.prepare(`DELETE FROM sessions WHERE token_hash=?1`).bind(tokenHash).run();
    return null;
  }
  return { id: row.id, username: row.username, avatar: row.avatar };
}
async function requireUser(env: Env, req: Request) {
  const user = await currentUser(env, req);
  if (!user) return { response: json({ error: "ابتدا وارد حساب شوید." }, { status: 401 }) } as const;
  await env.HALLOCALL_DB.prepare(`UPDATE users SET last_seen_at=?1 WHERE id=?2`).bind(now(), user.id).run();
  return { user } as const;
}
function safeUser(row: { id: string; username: string; avatar: string }): SafeUser { return { id: row.id, username: row.username, avatar: row.avatar }; }

export class CallRoom {
  private state: DurableObjectState;
  private sockets = new Map<WebSocket, { id:string; username:string; avatar:string; muted:boolean }>();
  private messages: Array<{ id:string; userId:string; username:string; avatar:string; text:string; createdAt:number }> = [];
  private loaded = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    const saved = await this.state.storage.get<typeof this.messages>("messages");
    if (saved) this.messages = saved.slice(-100);
  }

  private snapshot() {
    return Array.from(this.sockets.values()).map((p) => ({
      id:p.id,
      username:p.username,
      avatar:p.avatar,
      muted:p.muted,
    }));
  }

  private broadcast(payload: unknown, except?: WebSocket) {
    const text = JSON.stringify(payload);
    for (const ws of this.sockets.keys()) {
      if (ws === except) continue;
      try {
        ws.send(text);
      } catch {}
    }
  }

  async fetch(request: Request) {
    await this.ensureLoaded();
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const id = request.headers.get("x-user-id");
      const username = request.headers.get("x-username");
      const avatar = request.headers.get("x-avatar") || "ronaldo_red";
      if (!id || !username) return new Response("Unauthorized", { status:401 });

      for (const [socket, peer] of this.sockets) {
        if (peer.id === id) {
          try { socket.close(1000, "Reconnected"); } catch {}
          this.sockets.delete(socket);
        }
      }

      if (this.sockets.size >= MAX_CALL_PARTICIPANTS) {
        return new Response("این کال به حداکثر ظرفیت ۸ نفر رسیده است.", { status:409 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);

      const session = { id, username, avatar, muted:false };
      this.sockets.set(server, session);
      server.serializeAttachment(session);

      server.send(JSON.stringify({
        type:"ready",
        selfId:id,
        participants:this.snapshot(),
        messages:this.messages,
      }));
      this.broadcast({ type:"presence", participants:this.snapshot() });

      return new Response(null, { status:101, webSocket:client } as any);
    }

    if (url.pathname.endsWith("/state")) {
      return json({ participants:this.snapshot(), messages:this.messages });
    }

    if (url.pathname.endsWith("/end")) {
      const hostId = request.headers.get("x-user-id");
      for (const [socket, peer] of this.sockets) {
        if (peer.id !== hostId) {
          try { socket.send(JSON.stringify({ type:"ended" })); } catch {}
          try { socket.close(1000, "Call ended"); } catch {}
        }
      }
      this.sockets.clear();
      return json({ ok:true });
    }

    return json({ error:"Not found" }, { status:404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const raw = typeof message === "string" ? message : decoder.decode(message);
    const session = this.sockets.get(ws) ?? ws.deserializeAttachment() as { id:string; username:string; avatar:string; muted:boolean } | null;
    if (!session) return;

    try {
      const msg = JSON.parse(raw) as {
        type:string;
        to?:string;
        payload?:unknown;
        text?:string;
        emoji?:string;
        muted?:boolean;
      };

      if (msg.type === "signal" && msg.to) {
        for (const [socket, peer] of this.sockets) {
          if (peer.id === msg.to) {
            try {
              socket.send(JSON.stringify({ type:"signal", from:session.id, payload:msg.payload }));
            } catch {}
          }
        }
        return;
      }

      if (msg.type === "mute") {
        session.muted = !!msg.muted;
        this.sockets.set(ws, session);
        ws.serializeAttachment(session);
        this.broadcast({ type:"presence", participants:this.snapshot() });
        return;
      }

      if (msg.type === "chat" && typeof msg.text === "string" && msg.text.trim()) {
        const messageRecord = {
          id:uuid(),
          userId:session.id,
          username:session.username,
          avatar:session.avatar,
          text:msg.text.trim().slice(0,500),
          createdAt:now(),
        };
        this.messages.push(messageRecord);
        this.messages = this.messages.slice(-100);
        await this.state.storage.put("messages", this.messages);
        this.broadcast({ type:"chat", message:messageRecord });
        return;
      }

      if (msg.type === "reaction" && typeof msg.emoji === "string") {
        this.broadcast({
          type:"reaction",
          emoji:msg.emoji.slice(0,8),
          from:session.username,
        });
        return;
      }

      if (msg.type === "typing") {
        this.broadcast(
          { type:"typing", userId:session.id, active:!!msg.payload },
          ws,
        );
      }
    } catch (error) {
      console.error("CallRoom websocket message error:", error);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const session = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (session) this.broadcast({ type:"presence", participants:this.snapshot() });
  }

  async webSocketError(ws: WebSocket) {
    this.sockets.delete(ws);
    this.broadcast({ type:"presence", participants:this.snapshot() });
  }
}

function callDO(env: Env, code:string, req:Request, user:SafeUser) {
  const id = env.CALL_ROOMS.idFromName(code);
  const headers = new Headers(req.headers);
  headers.set("x-user-id", user.id);
  headers.set("x-username", user.username);
  headers.set("x-avatar", user.avatar);
  return env.CALL_ROOMS.get(id).fetch(new Request(req, { headers }));
}

async function ensureAuthDatabase(env: Env) {
  await env.HALLOCALL_DB.batch([
    env.HALLOCALL_DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT 'ronaldo_red',
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS users_username_lower_idx ON users(username_lower)`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users(last_seen_at)`),
    env.HALLOCALL_DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)`),
    env.HALLOCALL_DB.prepare(`CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined')) DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      responded_at INTEGER,
      UNIQUE(requester_id, addressee_id)
    )`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships(requester_id, status)`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships(addressee_id, status)`),
    env.HALLOCALL_DB.prepare(`CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Friend Call',
      status TEXT NOT NULL CHECK(status IN ('waiting','active','ended')) DEFAULT 'waiting',
      created_at INTEGER NOT NULL,
      ended_at INTEGER
    )`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS calls_host_idx ON calls(host_id, status)`),
    env.HALLOCALL_DB.prepare(`CREATE TABLE IF NOT EXISTS call_invites (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      caller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      callee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('ringing','accepted','declined','cancelled','expired')) DEFAULT 'ringing',
      created_at INTEGER NOT NULL,
      responded_at INTEGER
    )`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS call_invites_callee_idx ON call_invites(callee_id, status, created_at)`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS call_invites_caller_idx ON call_invites(caller_id, status, created_at)`),
  ]);
}

async function api(env: Env, req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (path === "/api/health" && method === "GET") {
    if (!env.HALLOCALL_DB) return json({ ok:false, service:"hallocall", database:"missing", schema:"unavailable", time:now(), version:"auth-v5" }, { status:503 });
    try {
      await env.HALLOCALL_DB.prepare("SELECT 1 AS ok").first();
      const tables = await env.HALLOCALL_DB.prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name IN ('users','sessions','friendships','calls','call_invites')
         ORDER BY name`
      ).all<{name:string}>();
      const names = new Set(tables.results.map((row) => row.name));
      const required = ["users","sessions","friendships","calls","call_invites"];
      const missing = required.filter((name) => !names.has(name));
      if (missing.length) {
        await ensureAuthDatabase(env);
      }
      return json({ ok:true, service:"hallocall", database:"connected", schema:"ready", repaired:missing.length>0, time:now(), version:"auth-v5" });
    } catch (error) {
      console.error("D1 health check failed:", error);
      return json({ ok:false, service:"hallocall", database:"error", schema:"error", code:"D1_HEALTH_FAILED", detail:error instanceof Error ? error.message : "unknown", time:now(), version:"auth-v5" }, { status:503 });
    }
  }
  if (!env.HALLOCALL_DB) return json({ error:"اتصال D1 برای این Worker تنظیم نشده است." }, { status:503 });

  if (path === "/api/auth/register" && method === "POST") {
    await ensureAuthDatabase(env);
    const body = await req.json().catch(() => null) as { username?:unknown; passwordProof?:unknown; avatar?:unknown } | null;
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const passwordProofValue = typeof body?.passwordProof === "string" ? body.passwordProof : "";
    const avatar = typeof body?.avatar === "string" && AVATARS.has(body.avatar) ? body.avatar : "ronaldo_red";
    if (!USERNAME_RE.test(username)) return json({ error:"نام کاربری باید ۳ تا ۲۰ کاراکتر و فقط شامل حروف انگلیسی، عدد یا _ باشد." }, { status:400 });
    if (!/^[A-Za-z0-9+/]{43}=$/.test(passwordProofValue)) return json({ error:"اثبات رمز عبور نامعتبر است. صفحه را تازه‌سازی و دوباره تلاش کن." }, { status:400 });
    const exists = await env.HALLOCALL_DB.prepare(`SELECT id FROM users WHERE username_lower=?1`).bind(username.toLowerCase()).first();
    if (exists) return json({ error:"این نام کاربری قبلاً ثبت شده است." }, { status:409 });
    const id = uuid();
    const createdAt = now();
    const passwordHash = await hashPassword(passwordProofValue);
    const session = await buildSession(env, id);
    try {
      await env.HALLOCALL_DB.batch([
        env.HALLOCALL_DB.prepare(`INSERT INTO users(id,username,username_lower,password_hash,avatar,created_at,last_seen_at) VALUES(?1,?2,?3,?4,?5,?6,?6)`)
          .bind(id,username,username.toLowerCase(),passwordHash,avatar,createdAt),
        env.HALLOCALL_DB.prepare(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?1,?2,?3,?4)`)
          .bind(session.tokenHash,id,session.createdAt,session.expires),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/UNIQUE.*username_lower|username_lower.*UNIQUE/i.test(message)) {
        return json({ error:"این نام کاربری قبلاً ثبت شده است." }, { status:409 });
      }
      throw error;
    }
    return json({ user:{id,username,avatar} }, { headers:{ "Set-Cookie":sessionCookie(session.token,session.expires, new URL(req.url).protocol === "https:") } });
  }
  if (path === "/api/auth/login" && method === "POST") {
    await ensureAuthDatabase(env);
    const body = await req.json().catch(() => null) as { username?:unknown; passwordProof?:unknown } | null;
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const passwordProofValue = typeof body?.passwordProof === "string" ? body.passwordProof : "";
    if (!/^[A-Za-z0-9+/]{43}=$/.test(passwordProofValue)) return json({ error:"اثبات رمز عبور نامعتبر است. صفحه را تازه‌سازی و دوباره تلاش کن." }, { status:400 });
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,username,password_hash,avatar FROM users WHERE username_lower=?1 LIMIT 1`).bind(username).first<{id:string;username:string;password_hash:string;avatar:string}>();
    if (!row || !(await verifyPassword(passwordProofValue,row.password_hash))) return json({ error:"نام کاربری یا رمز عبور اشتباه است." }, { status:401 });
    const session = await buildSession(env, row.id);
    await env.HALLOCALL_DB.batch([
      env.HALLOCALL_DB.prepare(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?1,?2,?3,?4)`)
        .bind(session.tokenHash,row.id,session.createdAt,session.expires),
      env.HALLOCALL_DB.prepare(`UPDATE users SET last_seen_at=?1 WHERE id=?2`)
        .bind(now(),row.id),
    ]);
    return json({ user:{id:row.id,username:row.username,avatar:row.avatar} }, { headers:{ "Set-Cookie":sessionCookie(session.token,session.expires, new URL(req.url).protocol === "https:") } });
  }
  if (path === "/api/auth/logout" && method === "POST") {
    const token = cookies(req)[SESSION_COOKIE]; if (token) await env.HALLOCALL_DB.prepare(`DELETE FROM sessions WHERE token_hash=?1`).bind(await sha256(token)).run();
    return json({ ok:true }, { headers:{ "Set-Cookie":clearCookie(new URL(req.url).protocol === "https:") } });
  }
  if (path === "/api/auth/me" && method === "GET") return json({ user:await currentUser(env,req) });

  if (path === "/api/profile" && method === "PATCH") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { avatar?:unknown } | null;
    const avatar = typeof body?.avatar === "string" && AVATARS.has(body.avatar) ? body.avatar : null;
    if (!avatar) return json({ error:"آواتار نامعتبر است." }, { status:400 });
    await env.HALLOCALL_DB.prepare(`UPDATE users SET avatar=?1 WHERE id=?2`).bind(avatar,auth.user.id).run();
    return json({ user:{...auth.user,avatar} });
  }

  if (path === "/api/presence" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    return json({ ok:true });
  }
  if (path === "/api/users/search" && method === "GET") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 2) return json({ users:[] });
    const pattern = `%${q}%`;
    const rows = await env.HALLOCALL_DB.prepare(`SELECT id,username,avatar FROM users WHERE username_lower LIKE ?1 AND id<>?2 ORDER BY username_lower LIMIT 12`).bind(pattern,auth.user.id).all<{id:string;username:string;avatar:string}>();
    return json({ users:rows.results.map(safeUser) });
  }

  if (path === "/api/friends" && method === "GET") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const windowSeconds = Number(env.ONLINE_WINDOW_SECONDS || 20);
    const rows = await env.HALLOCALL_DB.prepare(`
      SELECT f.id friendship_id, f.requester_id, f.addressee_id, f.status, u.id, u.username, u.avatar, u.last_seen_at
      FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id=?1 THEN f.addressee_id ELSE f.requester_id END
      WHERE (f.requester_id=?1 OR f.addressee_id=?1) AND f.status='accepted'
      ORDER BY u.username_lower
    `).bind(auth.user.id).all<{friendship_id:string;requester_id:string;addressee_id:string;status:string;id:string;username:string;avatar:string;last_seen_at:number}>();
    const reqRows = await env.HALLOCALL_DB.prepare(`
      SELECT f.id friendship_id, f.requester_id, f.addressee_id, f.status, u.id, u.username, u.avatar
      FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id=?1 THEN f.addressee_id ELSE f.requester_id END
      WHERE (f.requester_id=?1 OR f.addressee_id=?1) AND f.status='pending' ORDER BY f.created_at DESC
    `).bind(auth.user.id).all<{friendship_id:string;requester_id:string;addressee_id:string;status:string;id:string;username:string;avatar:string}>();
    const friends = rows.results.map((r) => ({ ...safeUser(r), friendshipId:r.friendship_id, online: now()-r.last_seen_at < windowSeconds*1000, direction:"friend" as const }));
    const requests = reqRows.results.map((r) => ({ ...safeUser(r), friendshipId:r.friendship_id, direction:r.addressee_id===auth.user.id?"incoming":"outgoing", status:"pending" as const }));
    return json({ friends, requests });
  }
  if (path === "/api/friends/request" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { userId?:unknown } | null;
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!userId || userId===auth.user.id) return json({ error:"کاربر نامعتبر است." }, { status:400 });
    const target = await env.HALLOCALL_DB.prepare(`SELECT id FROM users WHERE id=?1`).bind(userId).first();
    if (!target) return json({ error:"کاربر پیدا نشد." }, { status:404 });
    const existing = await friendshipBetween(env,auth.user.id,userId);
    if (existing?.status === "accepted") return json({ error:"این کاربر از قبل دوست شماست." }, { status:409 });
    if (existing?.status === "pending") return json({ error:"درخواست دوستی از قبل ارسال شده است." }, { status:409 });
    if (existing) await env.HALLOCALL_DB.prepare(`DELETE FROM friendships WHERE id=?1`).bind(existing.id).run();
    await env.HALLOCALL_DB.prepare(`INSERT INTO friendships(id,requester_id,addressee_id,status,created_at) VALUES(?1,?2,?3,'pending',?4)`).bind(uuid(),auth.user.id,userId,now()).run();
    return json({ ok:true });
  }
  if (path === "/api/friends/respond" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { friendshipId?:unknown; action?:unknown } | null;
    const id = typeof body?.friendshipId === "string" ? body.friendshipId : "";
    const action = body?.action === "accept" ? "accepted" : body?.action === "decline" ? "declined" : null;
    if (!id || !action) return json({ error:"درخواست نامعتبر است." }, { status:400 });
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,addressee_id,status FROM friendships WHERE id=?1`).bind(id).first<{id:string;addressee_id:string;status:string}>();
    if (!row || row.addressee_id!==auth.user.id || row.status!=="pending") return json({ error:"درخواست پیدا نشد." }, { status:404 });
    await env.HALLOCALL_DB.prepare(`UPDATE friendships SET status=?1, responded_at=?2 WHERE id=?3`).bind(action,now(),id).run();
    return json({ ok:true });
  }
  if (path === "/api/friends/remove" && method === "DELETE") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { friendshipId?:unknown } | null;
    const id = typeof body?.friendshipId === "string" ? body.friendshipId : "";
    await env.HALLOCALL_DB.prepare(`DELETE FROM friendships WHERE id=?1 AND (requester_id=?2 OR addressee_id=?2)`).bind(id,auth.user.id).run();
    return json({ ok:true });
  }

  if (path === "/api/calls" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { name?:unknown } | null;
    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0,64) : "Friend Call";
    const code = await uniqueCallCode(env); const id = uuid();
    await env.HALLOCALL_DB.prepare(`INSERT INTO calls(id,code,host_id,name,status,created_at) VALUES(?1,?2,?3,?4,'waiting',?5)`).bind(id,code,auth.user.id,name,now()).run();
    return json({ call:{id,code,name,hostId:auth.user.id,status:"waiting"} });
  }
  const callMatch = path.match(/^\/api\/calls\/([^/]+)$/);
  if (callMatch && method === "GET") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const code = decodeURIComponent(callMatch[1]).toUpperCase();
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,code,name,host_id,status FROM calls WHERE code=?1 LIMIT 1`).bind(code).first<{id:string;code:string;name:string;host_id:string;status:string}>();
    if (!row || row.status === "ended") return json({ error:"این کال دیگر فعال نیست." }, { status:404 });
    return json({ call:callJson(row) });
  }
  if (path === "/api/calls/invite" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { friendId?:unknown } | null;
    const friendId = typeof body?.friendId === "string" ? body.friendId : "";
    const friendship = await friendshipBetween(env,auth.user.id,friendId);
    if (!friendship || friendship.status!=="accepted") return json({ error:"این کاربر دوست شما نیست." }, { status:403 });
    const friend = await env.HALLOCALL_DB.prepare(`SELECT id,username,avatar FROM users WHERE id=?1`).bind(friendId).first<{id:string;username:string;avatar:string}>();
    if (!friend) return json({ error:"کاربر پیدا نشد." }, { status:404 });
    const recentInvite = await env.HALLOCALL_DB.prepare(`SELECT i.id FROM call_invites i WHERE i.caller_id=?1 AND i.callee_id=?2 AND i.status='ringing' AND i.created_at>?3 LIMIT 1`)
      .bind(auth.user.id,friendId,now()-30_000).first();
    if (recentInvite) return json({ error:"برای این دوست همین الان یک تماس در حال زنگ‌خوردن وجود دارد." }, { status:409 });
    const code = await uniqueCallCode(env); const callId = uuid(); const inviteId = uuid();
    const name = `Call با ${friend.username}`;
    await env.HALLOCALL_DB.batch([
      env.HALLOCALL_DB.prepare(`INSERT INTO calls(id,code,host_id,name,status,created_at) VALUES(?1,?2,?3,?4,'waiting',?5)`).bind(callId,code,auth.user.id,name,now()),
      env.HALLOCALL_DB.prepare(`INSERT INTO call_invites(id,call_id,caller_id,callee_id,status,created_at) VALUES(?1,?2,?3,?4,'ringing',?5)`).bind(inviteId,callId,auth.user.id,friendId,now()),
    ]);
    return json({ inviteId, call:{id:callId,code,name,hostId:auth.user.id,status:"waiting"} });
  }
  if (path === "/api/calls/incoming" && method === "GET") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const cutoff = now() - 120_000;
    await env.HALLOCALL_DB.prepare(`UPDATE call_invites SET status='expired',responded_at=?1 WHERE callee_id=?2 AND status='ringing' AND created_at<=?3`)
      .bind(now(),auth.user.id,cutoff).run();
    const rows = await env.HALLOCALL_DB.prepare(`SELECT i.id invite_id,c.code,c.name,u.id caller_id,u.username caller_username,u.avatar caller_avatar
      FROM call_invites i JOIN calls c ON c.id=i.call_id JOIN users u ON u.id=i.caller_id WHERE i.callee_id=?1 AND i.status='ringing' AND c.status<>'ended' AND i.created_at>?2 ORDER BY i.created_at DESC LIMIT 8`)
      .bind(auth.user.id,cutoff).all<{invite_id:string;code:string;name:string;caller_id:string;caller_username:string;caller_avatar:string}>();
    return json({ calls:rows.results.map(r=>({inviteId:r.invite_id,code:r.code,name:r.name,caller:{id:r.caller_id,username:r.caller_username,avatar:r.caller_avatar}})) });
  }
  if (path === "/api/calls/respond" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { inviteId?:unknown; action?:unknown } | null;
    const id = typeof body?.inviteId === "string" ? body.inviteId : "";
    const action = body?.action === "accept" ? "accepted" : body?.action === "decline" ? "declined" : null;
    if (!id || !action) return json({ error:"درخواست نامعتبر است." }, { status:400 });
    const row = await env.HALLOCALL_DB.prepare(`SELECT i.id,c.code,c.status call_status,i.callee_id,i.call_id,i.status invite_status FROM call_invites i JOIN calls c ON c.id=i.call_id WHERE i.id=?1 LIMIT 1`).bind(id).first<{id:string;code:string;call_status:string;callee_id:string;call_id:string;invite_status:string}>();
    if (!row || row.callee_id!==auth.user.id || row.invite_status!=="ringing" || row.call_status==="ended") return json({ error:"این تماس دیگر در دسترس نیست." }, { status:409 });
    await env.HALLOCALL_DB.prepare(`UPDATE call_invites SET status=?1,responded_at=?2 WHERE id=?3 AND status='ringing'`).bind(action,now(),id).run();
    if (action === "accepted") {
      const t = now();
      await env.HALLOCALL_DB.batch([
        env.HALLOCALL_DB.prepare(`UPDATE calls SET status='active' WHERE id=?1 AND status<>'ended'`).bind(row.call_id),
        env.HALLOCALL_DB.prepare(`UPDATE call_invites SET status='expired',responded_at=?1 WHERE callee_id=?2 AND status='ringing' AND id<>?3`).bind(t,auth.user.id,id),
      ]);
    } else {
      await env.HALLOCALL_DB.prepare(`UPDATE calls SET status='ended',ended_at=?1 WHERE id=?2 AND status='waiting'`).bind(now(),row.call_id).run();
    }
    return json({ ok:true, code:action === "accepted" ? row.code : undefined });
  }
  const joinMatch = path.match(/^\/api\/calls\/([^/]+)\/join$/);
  if (joinMatch && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const code = decodeURIComponent(joinMatch[1]).toUpperCase();
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,code,name,host_id,status FROM calls WHERE code=?1 LIMIT 1`).bind(code).first<{id:string;code:string;name:string;host_id:string;status:string}>();
    if (!row || row.status === "ended") return json({ error:"کال پیدا نشد یا تمام شده است." }, { status:404 });
    const roomId = env.CALL_ROOMS.idFromName(code);
    const roomHeaders = new Headers({ "x-user-id":auth.user.id, "x-username":auth.user.username, "x-avatar":auth.user.avatar });
    try {
      const stateRes = await env.CALL_ROOMS.get(roomId).fetch(new Request("https://call-room.local/state", { headers:roomHeaders }));
      if (stateRes.ok) {
        const state = await stateRes.json() as { participants?:Array<{id:string}> };
        const participants = state.participants ?? [];
        if (participants.length >= MAX_CALL_PARTICIPANTS && !participants.some(p=>p.id===auth.user.id)) {
          return json({ error:"این کال در حال حاضر پر است. حداکثر ظرفیت این تماس ۸ نفر است." }, { status:409 });
        }
      }
    } catch {}
    if (row.status === "waiting") await env.HALLOCALL_DB.prepare(`UPDATE calls SET status='active' WHERE id=?1 AND status='waiting'`).bind(row.id).run();
    return json({ ok:true, call:callJson({...row,status:"active"}) });
  }
  const leaveMatch = path.match(/^\/api\/calls\/([^/]+)\/leave$/);
  if (leaveMatch && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const code = decodeURIComponent(leaveMatch[1]).toUpperCase();
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,host_id FROM calls WHERE code=?1 LIMIT 1`).bind(code).first<{id:string;host_id:string}>();
    if (row && row.host_id===auth.user.id) {
      await env.HALLOCALL_DB.prepare(`UPDATE calls SET status='ended',ended_at=?1 WHERE id=?2`).bind(now(),row.id).run();
      const id = env.CALL_ROOMS.idFromName(code);
      const headers = new Headers({ "x-user-id": auth.user.id });
      try { await env.CALL_ROOMS.get(id).fetch(new Request("https://call-room.local/end", { headers })); } catch {}
    }
    return json({ ok:true });
  }

  if (path === "/api/webrtc/ice" && method === "GET") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
      try {
        const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method:"POST", headers:{ Authorization:`Bearer ${env.TURN_API_TOKEN}`, "Content-Type":"application/json" }, body:JSON.stringify({ttl:86_400})
        });
        if (res.ok) return new Response(await res.text(), { status:200, headers:{"content-type":"application/json"} });
      } catch {}
    }
    return json({ iceServers:[{urls:"stun:stun.cloudflare.com:3478"},{urls:"stun:stun.l.google.com:19302"}] });
  }

  return json({ error:"Not found" }, { status:404 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(env,req);
      if (url.pathname.startsWith("/ws/call/")) {
        const user = await currentUser(env,req);
        if (!user) return new Response("Unauthorized", {status:401});
        const code = decodeURIComponent(url.pathname.split("/").pop() || "").toUpperCase();
        const row = await env.HALLOCALL_DB.prepare(`SELECT id FROM calls WHERE code=?1 AND status<>'ended' LIMIT 1`).bind(code).first();
        if (!row) return new Response("Call not found", {status:404});
        return callDO(env,code,req,user);
      }
      return env.ASSETS.fetch(req);
    } catch (error) {
      console.error("HalloCall request failed:", error);
      const message = error instanceof Error ? error.message : "unknown";
      if (/D1|SQLITE|database/i.test(message)) {
        return json({ error:"خطا در دیتابیس سرور. اتصال D1 را بررسی می‌کنیم." }, { status:503 });
      }
      return json({ error:"خطای داخلی سرور" }, { status:500 });
    }
  }
};
