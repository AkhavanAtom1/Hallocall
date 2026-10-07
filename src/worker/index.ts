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
const AVATARS = new Set(["aurora","ember","ocean","violet","mint","sunset","cosmic","rose","bolt","forest","pearl","lava"]);

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
async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 150_000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$150000$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations)) return false;
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, expected.length * 8);
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0; for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
function cookies(req: Request) {
  const raw = req.headers.get("Cookie") ?? "";
  return Object.fromEntries(raw.split(";").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf("="); return [i >= 0 ? p.slice(0, i) : p, i >= 0 ? decodeURIComponent(p.slice(i + 1)) : ""];
  }));
}
const SESSION_COOKIE = "hallocall_session";

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

async function createSession(env: Env, userId: string) {
  const token = `${uuid()}-${uuid().replaceAll("-", "")}`;
  const ttlDays = Number(env.SESSION_TTL_DAYS || 30);
  const expires = now() + ttlDays * 86_400_000;
  await env.HALLOCALL_DB.prepare(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)`)
    .bind(await sha256(token), userId, now(), expires).run();
  return { token, expires };
}
function sessionCookie(token: string, expires: number, secure = true) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Expires=${new Date(expires).toUTCString()}`;
}
function clearCookie(secure = true) { return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=0`; }

async function uniqueCallCode(env: Env) {
  for (let i = 0; i < 8; i++) {
    const code = randomCode();
    const row = await env.HALLOCALL_DB.prepare(`SELECT id FROM calls WHERE code=?1 LIMIT 1`).bind(code).first();
    if (!row) return code;
  }
  throw new Error("Could not create call code");
}

async function friendshipBetween(env: Env, a: string, b: string) {
  return env.HALLOCALL_DB.prepare(`SELECT * FROM friendships WHERE (requester_id=?1 AND addressee_id=?2) OR (requester_id=?2 AND addressee_id=?1) LIMIT 1`).bind(a,b).first<{ id:string; requester_id:string; addressee_id:string; status:string }>();
}

function callJson(row: { id: string; code: string; name: string; host_id: string; status: string }) {
  return { id: row.id, code: row.code, name: row.name, hostId: row.host_id, status: row.status };
}

async function callDO(env: Env, code: string, req: Request, user: SafeUser) {
  const id = env.CALL_ROOMS.idFromName(code.toUpperCase());
  const stub = env.CALL_ROOMS.get(id);
  const headers = new Headers(req.headers);
  headers.set("x-user-id", user.id);
  headers.set("x-username", user.username);
  headers.set("x-avatar", user.avatar);
  return stub.fetch(new Request(req, { headers }));
}

export class CallRoom {
  private readonly state: DurableObjectState;
  private sockets = new Map<WebSocket, { id: string; username: string; avatar: string; muted: boolean }>();
  private messages: Array<{ id:string; userId:string; username:string; avatar:string; text:string; createdAt:number }> = [];
  private loaded = false;

  constructor(state: DurableObjectState) { this.state = state; }
  private async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    const saved = await this.state.storage.get<typeof this.messages>("messages");
    if (saved) this.messages = saved.slice(-100);
  }
  private snapshot() {
    return Array.from(this.sockets.values()).map((p) => ({ id:p.id, username:p.username, avatar:p.avatar, muted:p.muted }));
  }
  private broadcast(payload: unknown, except?: WebSocket) {
    const text = JSON.stringify(payload);
    for (const ws of this.sockets.keys()) if (ws !== except) { try { ws.send(text); } catch {} }
  }
  async fetch(request: Request) {
    await this.ensureLoaded();
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const id = request.headers.get("x-user-id");
      const username = request.headers.get("x-username");
      const avatar = request.headers.get("x-avatar") || "aurora";
      if (!id || !username) return new Response("Unauthorized", { status: 401 });
      for (const [socket, peer] of this.sockets) {
        if (peer.id === id) { try { socket.close(1000, "Reconnected"); } catch {} this.sockets.delete(socket); }
      }
      if (this.sockets.size >= 2) return new Response("این کال دو نفره است و در حال حاضر ظرفیت آن پر است.", { status: 409 });
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.state.acceptWebSocket(server);
      const session = { id, username, avatar, muted: false };
      this.sockets.set(server, session);
      server.serializeAttachment(session);
      server.send(JSON.stringify({ type:"ready", selfId:id, participants:this.snapshot(), messages:this.messages }));
      this.broadcast({ type:"presence", participants:this.snapshot() });
      return new Response(null, { status:101, webSocket:client } as any);
    }
      if (url.pathname.endsWith("/state")) return json({ participants:this.snapshot(), messages:this.messages });
    if (url.pathname.endsWith("/end")) {
      const hostId = request.headers.get("x-user-id");
      for (const [socket, peer] of this.sockets) {
        if (peer.id !== hostId) { try { socket.send(JSON.stringify({ type:"ended" })); socket.close(1000, "Call ended"); } catch {} }
      }
      this.sockets.clear();
      return json({ ok:true });
    }
    return json({ error:"Not found" }, { status:404 });
  }
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    void this.handleMessage(ws, typeof message === "string" ? message : decoder.decode(message));
  }
  webSocketClose(ws: WebSocket) {
    const session = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (session) this.broadcast({ type:"presence", participants:this.snapshot() });
  }
  webSocketError(ws: WebSocket) {
    this.sockets.delete(ws);
    this.broadcast({ type:"presence", participants:this.snapshot() });
  }
  private async handleMessage(ws: WebSocket, raw: string) {
    const session = this.sockets.get(ws) || ws.deserializeAttachment() as { id:string; username:string; avatar:string; muted:boolean } | null;
    if (!session) return;
    try {
      const msg = JSON.parse(raw) as { type:string; to?:string; payload?:unknown; text?:string; emoji?:string; muted?:boolean };
      if (msg.type === "signal" && msg.to) {
        for (const [socket, peer] of this.sockets) if (peer.id === msg.to) socket.send(JSON.stringify({ type:"signal", from:session.id, payload:msg.payload }));
      } else if (msg.type === "mute") {
        session.muted = !!msg.muted;
        this.sockets.set(ws, session);
        ws.serializeAttachment(session);
        this.broadcast({ type:"presence", participants:this.snapshot() });
      } else if (msg.type === "chat" && typeof msg.text === "string" && msg.text.trim()) {
        const message = { id:uuid(), userId:session.id, username:session.username, avatar:session.avatar, text:msg.text.trim().slice(0,500), createdAt:now() };
        this.messages.push(message); this.messages = this.messages.slice(-100);
        await this.state.storage.put("messages", this.messages);
        this.broadcast({ type:"chat", message });
      } else if (msg.type === "reaction" && typeof msg.emoji === "string") {
        this.broadcast({ type:"reaction", emoji:msg.emoji.slice(0,8), from:session.username });
      } else if (msg.type === "typing") {
        this.broadcast({ type:"typing", userId:session.id, active:!!msg.payload }, ws);
      }
    } catch {}
  }
}

async function api(env: Env, req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (path === "/api/health" && method === "GET") return json({ ok:true, service:"hallocall", time:now() });

  if (path === "/api/auth/register" && method === "POST") {
    const body = await req.json().catch(() => null) as { username?:unknown; password?:unknown; avatar?:unknown } | null;
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const avatar = typeof body?.avatar === "string" && AVATARS.has(body.avatar) ? body.avatar : "aurora";
    if (!USERNAME_RE.test(username)) return json({ error:"نام کاربری باید ۳ تا ۲۰ کاراکتر و فقط شامل حروف انگلیسی، عدد یا _ باشد." }, { status:400 });
    if (password.length < 6) return json({ error:"رمز عبور باید حداقل ۶ کاراکتر باشد." }, { status:400 });
    const exists = await env.HALLOCALL_DB.prepare(`SELECT id FROM users WHERE username_lower=?1`).bind(username.toLowerCase()).first();
    if (exists) return json({ error:"این نام کاربری قبلاً ثبت شده است." }, { status:409 });
    const id = uuid();
    await env.HALLOCALL_DB.prepare(`INSERT INTO users(id,username,username_lower,password_hash,avatar,created_at,last_seen_at) VALUES(?1,?2,?3,?4,?5,?6,?6)`)
      .bind(id,username,username.toLowerCase(),await hashPassword(password),avatar,now()).run();
    const session = await createSession(env,id);
    return json({ user:{id,username,avatar} }, { headers:{ "Set-Cookie":sessionCookie(session.token,session.expires, new URL(req.url).protocol === "https:") } });
  }
  if (path === "/api/auth/login" && method === "POST") {
    const body = await req.json().catch(() => null) as { username?:unknown; password?:unknown } | null;
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,username,password_hash,avatar FROM users WHERE username_lower=?1 LIMIT 1`).bind(username).first<{id:string;username:string;password_hash:string;avatar:string}>();
    if (!row || !(await verifyPassword(password,row.password_hash))) return json({ error:"نام کاربری یا رمز عبور اشتباه است." }, { status:401 });
    const session = await createSession(env,row.id);
    await env.HALLOCALL_DB.prepare(`UPDATE users SET last_seen_at=?1 WHERE id=?2`).bind(now(),row.id).run();
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
    const rows = await env.HALLOCALL_DB.prepare(`SELECT i.id invite_id,c.code,c.name,u.id caller_id,u.username caller_username,u.avatar caller_avatar
      FROM call_invites i JOIN calls c ON c.id=i.call_id JOIN users u ON u.id=i.caller_id WHERE i.callee_id=?1 AND i.status='ringing' AND c.status<>'ended' AND i.created_at>?2 ORDER BY i.created_at DESC LIMIT 8`)
      .bind(auth.user.id,now()-120_000).all<{invite_id:string;code:string;name:string;caller_id:string;caller_username:string;caller_avatar:string}>();
    return json({ calls:rows.results.map(r=>({inviteId:r.invite_id,code:r.code,name:r.name,caller:{id:r.caller_id,username:r.caller_username,avatar:r.caller_avatar}})) });
  }
  if (path === "/api/calls/respond" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { inviteId?:unknown; action?:unknown } | null;
    const id = typeof body?.inviteId === "string" ? body.inviteId : "";
    const action = body?.action === "accept" ? "accepted" : body?.action === "decline" ? "declined" : null;
    if (!id || !action) return json({ error:"درخواست نامعتبر است." }, { status:400 });
    const row = await env.HALLOCALL_DB.prepare(`SELECT i.id,c.code,i.callee_id,i.call_id FROM call_invites i JOIN calls c ON c.id=i.call_id WHERE i.id=?1 LIMIT 1`).bind(id).first<{id:string;code:string;callee_id:string;call_id:string}>();
    if (!row || row.callee_id!==auth.user.id) return json({ error:"تماس پیدا نشد." }, { status:404 });
    await env.HALLOCALL_DB.prepare(`UPDATE call_invites SET status=?1,responded_at=?2 WHERE id=?3`).bind(action,now(),id).run();
    if (action === "accepted") await env.HALLOCALL_DB.prepare(`UPDATE calls SET status='active' WHERE id=?1`).bind(row.call_id).run();
    return json({ ok:true, code:action === "accepted" ? row.code : undefined });
  }
  const joinMatch = path.match(/^\/api\/calls\/([^/]+)\/join$/);
  if (joinMatch && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const code = decodeURIComponent(joinMatch[1]).toUpperCase();
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,code,name,host_id,status FROM calls WHERE code=?1 LIMIT 1`).bind(code).first<{id:string;code:string;name:string;host_id:string;status:string}>();
    if (!row || row.status === "ended") return json({ error:"کال پیدا نشد یا تمام شده است." }, { status:404 });
    if (row.status === "waiting") await env.HALLOCALL_DB.prepare(`UPDATE calls SET status='active' WHERE id=?1`).bind(row.id).run();
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
      console.error(error);
      return json({ error:"خطای داخلی سرور" }, { status:500 });
    }
  }
};
