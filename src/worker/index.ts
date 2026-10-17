import { CALL_CODE_LENGTH, MAX_CALL_PARTICIPANTS } from "../lib/call";
import { SELECTABLE_AVATAR_IDS } from "../lib/types";

export interface Env {
  HALLOCALL_DB: D1Database;
  CALL_ROOMS: DurableObjectNamespace;
  /** One Durable Object per user: pushes "something changed" to that user's open tabs. */
  USER_HUBS: DurableObjectNamespace;
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
const SELECTABLE_AVATARS = new Set<string>(SELECTABLE_AVATAR_IDS);

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) } });
}
function now() { return Date.now(); }
function uuid() { return crypto.randomUUID(); }
function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(CALL_CODE_LENGTH); crypto.getRandomValues(bytes);
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
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf("=");
    const key = i >= 0 ? trimmed.slice(0, i) : trimmed;
    const rawVal = i >= 0 ? trimmed.slice(i + 1) : "";
    try { out[key] = decodeURIComponent(rawVal); }
    catch { out[key] = rawVal; }
  }
  return out;
}

function likeContains(value: string) {
  return `%${value.replace(/([\\%_])/g, "\\$1")}%`;
}

const SESSION_COOKIE = "hallocall_session";

const PRESENCE_WRITE_INTERVAL_MS = 10_000;

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
    maxParticipants: MAX_CALL_PARTICIPANTS,
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
type AuthResult = { response: Response } | { user: SafeUser };

async function requireUser(env: Env, req: Request): Promise<AuthResult> {
  const user = await currentUser(env, req);
  if (!user) return { response: json({ error: "ابتدا وارد حساب شوید." }, { status: 401 }) };
  /* Presence is written at most every 10 s. The UI polls every 1.5 s, so an
     unthrottled write per request would hammer D1 for nothing; the 20 s online
     window still sees a fresh timestamp well within its limit. */
  const current = now();
  await env.HALLOCALL_DB.prepare(`UPDATE users SET last_seen_at=?1 WHERE id=?2 AND last_seen_at<?3`)
    .bind(current, user.id, current - PRESENCE_WRITE_INTERVAL_MS).run();
  return { user };
}
function safeUser(row: { id: string; username: string; avatar: string }): SafeUser { return { id: row.id, username: row.username, avatar: row.avatar }; }

/** Per-socket state kept in the WebSocket attachment (survives DO hibernation). */
type RoomPeer = {
  id: string;
  username: string;
  avatar: string;
  muted: boolean;
  /** True while this person is sharing their screen (one sharer per room). */
  sharing?: boolean;
  /** Time the hand was raised (0 = hand down); also gives the speaking queue its order. */
  hand?: number;
  /** True while this person records the call locally (everyone is told). */
  rec?: boolean;
  /** Page-session id chosen by the browser; peers bind WebRTC connections to it. */
  sid?: string;
  joinedAt?: number;
  lastActive?: number;
  /** Set on a socket that was replaced by a newer connection of the same user. */
  superseded?: boolean;
};

/** Room-level state that must survive hibernation (stored under "meta"). */
type RoomMeta = {
  hostId: string;
  locked: boolean;
  /** People the host removed; they cannot come back into this call. */
  banned: string[];
  /** Everyone who has been in the room (they may re-enter a locked room after a drop). */
  members: string[];
  boardOpen: boolean;
  boardDrawers: "all" | "host";
  /** Who may share their screen. */
  shareMode: "all" | "host";
  /** Shared countdown started by the host. */
  timer: { id: string; label: string; durationMs: number; endsAt: number } | null;
  /** The current quick poll (one at a time). Votes are keyed by user id. */
  poll: RoomPoll | null;
};

type RoomPoll = { id: string; question: string; options: string[]; votes: Record<string, number>; open: boolean; createdAt: number };

type BoardStroke = { id: string; uid: string; tool: "pen" | "highlight" | "eraser"; color: string; size: number; pts: number[] };

/** Clients ping every 15 s; a pinging client silent for this long is dead. */
const STALE_AFTER_MS = 75_000;
const SWEEP_EVERY_MS = 30_000;
const ACTIVITY_WRITE_INTERVAL_MS = 10_000;
const BOARD_MAX_STROKES = 600;
const BOARD_MAX_NUMBERS = 60_000;
const STROKE_MAX_NUMBERS = 2_400;
const BOARD_FRAGMENT_MAX_NUMBERS = 400;
const BOARD_CHUNK_CHARS = 90_000;
const BOARD_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MEMBERS_MAX = 200;

function defaultMeta(): RoomMeta {
  return { hostId: "", locked: false, banned: [], members: [], boardOpen: false, boardDrawers: "all", shareMode: "all", timer: null, poll: null };
}

const TIMER_MIN_SECONDS = 10;
const TIMER_MAX_SECONDS = 6 * 3600;
const POLL_MAX_OPTIONS = 6;
const CAPTION_MAX_CHARS = 280;
const CAPTION_MAX_PER_SECOND = 8;

export class CallRoom {
  private state: DurableObjectState;
  private messages: Array<{ id:string; userId:string; username:string; avatar:string; text:string; createdAt:number }> = [];
  private meta: RoomMeta = defaultMeta();
  private board: BoardStroke[] = [];
  private boardIndex = new Map<string, BoardStroke>();
  private boardChunks = 0;
  /** Caption rate limiting (in memory only; losing it on hibernation is harmless). */
  private captionWindow = new Map<string, { at: number; count: number }>();
  private loaded = false;
  private loading: Promise<void> | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    /* Keep-alive without waking the object: the browser sends "ping", the
       runtime answers "pong" itself. Without this, idle mobile networks drop
       the socket and the person silently falls out of the call. */
    try { state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch {}
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    this.loading ??= (async () => {
      const saved = await this.state.storage.get<typeof this.messages>("messages");
      if (saved) this.messages = saved.slice(-100);
      const meta = await this.state.storage.get<Partial<RoomMeta>>("meta");
      if (meta && typeof meta === "object") {
        this.meta = {
          ...defaultMeta(),
          ...meta,
          banned: Array.isArray(meta.banned) ? meta.banned.slice(0, MEMBERS_MAX) : [],
          members: Array.isArray(meta.members) ? meta.members.slice(0, MEMBERS_MAX) : [],
          shareMode: meta.shareMode === "host" ? "host" : "all",
          timer: meta.timer && typeof meta.timer === "object" ? meta.timer : null,
          poll: meta.poll && typeof meta.poll === "object" ? meta.poll : null,
        };
      }
      const count = await this.state.storage.get<number>("board:n");
      if (typeof count === "number" && count > 0 && count < 64) {
        const keys = Array.from({ length: count }, (_, index) => `board:${index}`);
        const chunks = await this.state.storage.get<BoardStroke[]>(keys);
        const strokes: BoardStroke[] = [];
        for (const key of keys) {
          const chunk = chunks.get(key);
          if (Array.isArray(chunk)) strokes.push(...chunk);
        }
        this.board = strokes;
        this.boardChunks = count;
        this.rebuildBoardIndex();
      }
      this.loaded = true;
    })();
    await this.loading;
  }

  private async saveMeta() {
    await this.state.storage.put("meta", this.meta);
  }

  private rebuildBoardIndex() {
    this.boardIndex = new Map(this.board.map((stroke) => [stroke.id, stroke]));
  }

  private boardNumbers() {
    let total = 0;
    for (const stroke of this.board) total += stroke.pts.length;
    return total;
  }

  /** The board is stored in a few ≤ ~90 KB chunks so no single value gets too large. */
  private async persistBoard() {
    const chunks: BoardStroke[][] = [];
    let current: BoardStroke[] = [];
    let size = 0;
    for (const stroke of this.board) {
      const length = stroke.pts.length * 5 + 90;
      if (size + length > BOARD_CHUNK_CHARS && current.length) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(stroke);
      size += length;
    }
    if (current.length) chunks.push(current);
    const entries: Record<string, unknown> = { "board:n": chunks.length };
    chunks.forEach((chunk, index) => { entries[`board:${index}`] = chunk; });
    await this.state.storage.put(entries);
    if (this.boardChunks > chunks.length) {
      const stale = Array.from({ length: this.boardChunks - chunks.length }, (_, index) => `board:${chunks.length + index}`);
      await this.state.storage.delete(stale);
    }
    this.boardChunks = chunks.length;
  }

  private peerOf(socket: WebSocket): RoomPeer | null {
    try {
      return (socket.deserializeAttachment() as RoomPeer | null) ?? null;
    } catch {
      return null;
    }
  }

  /** Accepted WebSockets are the source of truth: in-memory maps disappear when
   * the Durable Object hibernates, while serialized attachments survive.
   *
   * Exactly ONE live socket per user is returned (the newest). Replaced and
   * closing sockets are ignored even if the runtime has not finished their
   * close handshake yet — that lingering window is what used to show the same
   * person twice and inflate the participant count. */
  private connectedSockets(except?: WebSocket) {
    const newest = new Map<string, readonly [WebSocket, RoomPeer]>();
    for (const socket of this.state.getWebSockets()) {
      if (except && socket === except) continue;
      if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) continue;
      const peer = this.peerOf(socket);
      if (!peer || peer.superseded || !peer.id) continue;
      const current = newest.get(peer.id);
      if (!current || (peer.joinedAt ?? 0) >= (current[1].joinedAt ?? 0)) newest.set(peer.id, [socket, peer] as const);
    }
    return Array.from(newest.values());
  }

  private snapshot(except?: WebSocket) {
    return this.connectedSockets(except).map(([, peer]) => ({
      id:peer.id,
      username:peer.username,
      avatar:peer.avatar,
      muted:!!peer.muted,
      sharing:!!peer.sharing,
      hand:peer.hand ?? 0,
      rec:!!peer.rec,
      sid:peer.sid ?? "",
      joinedAt:peer.joinedAt ?? 0,
    }));
  }

  private roomInfo() {
    const timer = this.meta.timer;
    const current = now();
    /* The timer travels as "time left", so people whose clocks are wrong still agree. */
    const activeTimer = timer && timer.endsAt + 60_000 > current
      ? { id: timer.id, label: timer.label, durationMs: timer.durationMs, remainingMs: Math.max(0, timer.endsAt - current) }
      : null;
    return {
      hostId: this.meta.hostId,
      locked: this.meta.locked,
      board: { open: this.meta.boardOpen, drawers: this.meta.boardDrawers },
      shareMode: this.meta.shareMode,
      timer: activeTimer,
    };
  }

  /** Poll as one person sees it: counts for everybody, plus their own vote. */
  private pollView(userId: string) {
    const poll = this.meta.poll;
    if (!poll) return null;
    const counts = poll.options.map(() => 0);
    for (const choice of Object.values(poll.votes)) if (counts[choice] !== undefined) counts[choice] += 1;
    return {
      id: poll.id,
      question: poll.question,
      options: poll.options.map((text, index) => ({ text, count: counts[index] })),
      open: poll.open,
      total: Object.keys(poll.votes).length,
      myVote: poll.votes[userId] ?? null,
    };
  }

  private broadcastPoll() {
    for (const [socket, peer] of this.connectedSockets()) {
      try { socket.send(JSON.stringify({ type:"poll", poll:this.pollView(peer.id) })); } catch {}
    }
  }

  private presence(except?: WebSocket) {
    return { type:"presence", participants:this.snapshot(except), room:this.roomInfo() };
  }

  private broadcast(payload: unknown, except?: WebSocket) {
    const text = JSON.stringify(payload);
    for (const [socket] of this.connectedSockets()) {
      if (socket === except) continue;
      try {
        socket.send(text);
      } catch {}
    }
  }

  private isHost(peer: RoomPeer) {
    return !!this.meta.hostId && peer.id === this.meta.hostId;
  }

  private async scheduleSweep() {
    try {
      const current = await this.state.storage.getAlarm();
      if (current === null) await this.state.storage.setAlarm(now() + SWEEP_EVERY_MS);
    } catch {}
  }

  async fetch(request: Request) {
    await this.ensureLoaded();
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const id = request.headers.get("x-user-id");
      const username = request.headers.get("x-username");
      const avatar = request.headers.get("x-avatar") || "ronaldo_red";
      if (!id || !username) return new Response("Unauthorized", { status:401 });

      /* The Worker passes the host from the database on every connect, so the
         room always agrees with D1 even after a host change. */
      const hostHeader = request.headers.get("x-host-id") ?? "";
      let metaChanged = false;
      if (hostHeader && hostHeader !== this.meta.hostId) { this.meta.hostId = hostHeader; metaChanged = true; }

      if (this.meta.banned.includes(id) && id !== this.meta.hostId) {
        if (metaChanged) await this.saveMeta();
        return new Response("میزبان شما را از این تماس حذف کرده است.", { status:403 });
      }
      const isMember = this.meta.members.includes(id) || id === this.meta.hostId;
      if (this.meta.locked && !isMember) {
        if (metaChanged) await this.saveMeta();
        return new Response("میزبان این تماس را قفل کرده است.", { status:423 });
      }

      /* Empty for older cached clients that predate heartbeat/session ids; those
         are never evicted by the stale sweep because they do not ping. */
      const sid = (url.searchParams.get("sid") ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
      const joinedAt = now();

      /* One live connection per user: the newest wins. Old sockets are flagged
         BEFORE closing so they vanish from every snapshot immediately. */
      for (const socket of this.state.getWebSockets()) {
        const peer = this.peerOf(socket);
        if (!peer || peer.id !== id || peer.superseded) continue;
        peer.superseded = true;
        try { socket.serializeAttachment(peer); } catch {}
        /* A different page session (second tab/device) took over: tell the old
           one to stop instead of reconnecting, otherwise the two fight forever. */
        if (peer.sid && peer.sid !== sid) {
          try { socket.send(JSON.stringify({ type:"replaced" })); } catch {}
        }
        try { socket.close(4001, "Replaced"); } catch {}
      }

      const occupied = this.connectedSockets().length;
      if (occupied >= MAX_CALL_PARTICIPANTS) {
        if (metaChanged) await this.saveMeta();
        return new Response(`این کال به حداکثر ظرفیت ${MAX_CALL_PARTICIPANTS} نفر رسیده است.`, { status:409 });
      }

      if (!this.meta.members.includes(id)) {
        this.meta.members.push(id);
        if (this.meta.members.length > MEMBERS_MAX) this.meta.members = this.meta.members.slice(-MEMBERS_MAX);
        metaChanged = true;
      }
      if (metaChanged) await this.saveMeta();

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);

      const session: RoomPeer = { id, username, avatar, muted:false, sharing:false, hand:0, rec:false, sid, joinedAt, lastActive:joinedAt };
      server.serializeAttachment(session);

      server.send(JSON.stringify({
        type:"ready",
        selfId:id,
        participants:this.snapshot(),
        room:this.roomInfo(),
        messages:this.messages,
      }));
      if (this.board.length) server.send(JSON.stringify({ type:"board-sync", strokes:this.board }));
      if (this.meta.poll) server.send(JSON.stringify({ type:"poll", poll:this.pollView(id) }));
      this.broadcast(this.presence(), server);
      await this.scheduleSweep();

      return new Response(null, { status:101, webSocket:client } as any);
    }

    if (url.pathname.endsWith("/state")) {
      return json({
        participants:this.snapshot(),
        messages:this.messages,
        hostId:this.meta.hostId,
        locked:this.meta.locked,
        members:this.meta.members,
        banned:this.meta.banned,
      });
    }

    if (url.pathname.endsWith("/host") && request.method === "POST") {
      const body = await request.json().catch(() => null) as { hostId?: unknown } | null;
      const hostId = typeof body?.hostId === "string" ? body.hostId : "";
      if (!hostId) return json({ error:"hostId required" }, { status:400 });
      this.meta.hostId = hostId;
      /* A new host can always come back into a locked room. */
      if (!this.meta.members.includes(hostId)) this.meta.members.push(hostId);
      this.meta.banned = this.meta.banned.filter((banned) => banned !== hostId);
      await this.saveMeta();
      this.broadcast(this.presence());
      return json({ ok:true });
    }

    if (url.pathname.endsWith("/end")) {
      for (const socket of this.state.getWebSockets()) {
        try { socket.send(JSON.stringify({ type:"ended" })); } catch {}
        try { socket.close(1000, "Call ended"); } catch {}
      }
      return json({ ok:true });
    }

    return json({ error:"Not found" }, { status:404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.ensureLoaded();
    const raw = typeof message === "string" ? message : decoder.decode(message);
    if (raw.length > 64_000) {
      try { ws.close(1009, "Message too large"); } catch {}
      return;
    }
    const session = this.peerOf(ws);
    if (!session || session.superseded) return;

    try {
      const msg = JSON.parse(raw) as {
        type:string;
        to?:string;
        payload?:unknown;
        text?:string;
        emoji?:string;
        muted?:boolean;
        active?:boolean;
        up?:boolean;
        on?:boolean;
        all?:boolean;
        locked?:boolean;
        open?:boolean;
        drawers?:string;
        id?:string;
        tool?:string;
        color?:string;
        size?:number;
        pts?:unknown;
        end?:boolean;
        mode?:string;
        seconds?:number;
        label?:string;
        question?:string;
        options?:unknown;
        option?:number;
        final?:boolean;
      };

      const current = now();
      if (current - (session.lastActive ?? 0) > ACTIVITY_WRITE_INTERVAL_MS) {
        session.lastActive = current;
        try { ws.serializeAttachment(session); } catch {}
      }

      if (msg.type === "signal" && msg.to) {
        for (const [socket, peer] of this.connectedSockets()) {
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
        ws.serializeAttachment(session);
        this.broadcast(this.presence());
        return;
      }

      if (msg.type === "hand") {
        const up = !!msg.up;
        if (!!session.hand === up) return;
        session.hand = up ? current : 0;
        ws.serializeAttachment(session);
        this.broadcast(this.presence());
        return;
      }

      if (msg.type === "rec") {
        const on = !!msg.on;
        if (!!session.rec === on) return;
        session.rec = on;
        ws.serializeAttachment(session);
        this.broadcast(this.presence());
        return;
      }

      if (msg.type === "screen") {
        const wantsToShare = !!msg.active;
        if (wantsToShare && this.meta.shareMode === "host" && !this.isHost(session)) {
          try { ws.send(JSON.stringify({ type:"denied", action:"screen" })); } catch {}
          return;
        }
        if (wantsToShare) {
          /* One presenter at a time keeps the mesh upload budget sane. */
          const other = this.connectedSockets().find(([, peer]) => peer.id !== session.id && peer.sharing);
          if (other) {
            try { ws.send(JSON.stringify({ type:"screen-denied", by:other[1].username })); } catch {}
            return;
          }
        }
        if (!!session.sharing === wantsToShare) return;
        session.sharing = wantsToShare;
        ws.serializeAttachment(session);
        this.broadcast(this.presence());
        return;
      }

      /* ── host-only controls ── */
      if (msg.type === "hand-lower" || msg.type === "mute-request" || msg.type === "kick" || msg.type === "lock" || msg.type === "board-open" || msg.type === "board-clear"
        || msg.type === "share-mode" || msg.type === "timer-start" || msg.type === "timer-stop" || msg.type === "poll-create" || msg.type === "poll-close" || msg.type === "poll-dismiss") {
        if (!this.isHost(session)) {
          try { ws.send(JSON.stringify({ type:"denied", action:msg.type })); } catch {}
          return;
        }

        if (msg.type === "hand-lower" && typeof msg.to === "string") {
          for (const [socket, peer] of this.connectedSockets()) {
            if (peer.id === msg.to && peer.hand) {
              peer.hand = 0;
              try { socket.serializeAttachment(peer); } catch {}
              try { socket.send(JSON.stringify({ type:"hand-lowered", by:session.username })); } catch {}
            }
          }
          this.broadcast(this.presence());
          return;
        }

        if (msg.type === "mute-request") {
          for (const [socket, peer] of this.connectedSockets()) {
            if (peer.id === session.id) continue;
            if (!msg.all && peer.id !== msg.to) continue;
            try { socket.send(JSON.stringify({ type:"mute-request", by:session.username })); } catch {}
          }
          return;
        }

        if (msg.type === "kick" && typeof msg.to === "string" && msg.to !== session.id) {
          const target = msg.to;
          if (!this.meta.banned.includes(target)) {
            this.meta.banned.push(target);
            if (this.meta.banned.length > MEMBERS_MAX) this.meta.banned = this.meta.banned.slice(-MEMBERS_MAX);
            await this.saveMeta();
          }
          for (const socket of this.state.getWebSockets()) {
            const peer = this.peerOf(socket);
            if (!peer || peer.id !== target || peer.superseded) continue;
            peer.superseded = true;
            try { socket.serializeAttachment(peer); } catch {}
            try { socket.send(JSON.stringify({ type:"kicked", by:session.username })); } catch {}
            try { socket.close(4003, "Removed by host"); } catch {}
          }
          this.broadcast(this.presence());
          return;
        }

        if (msg.type === "lock") {
          this.meta.locked = !!msg.locked;
          await this.saveMeta();
          this.broadcast(this.presence());
          return;
        }

        if (msg.type === "board-open") {
          this.meta.boardOpen = !!msg.open;
          if (msg.drawers === "all" || msg.drawers === "host") this.meta.boardDrawers = msg.drawers;
          await this.saveMeta();
          this.broadcast(this.presence());
          return;
        }

        if (msg.type === "board-clear") {
          this.board = [];
          this.boardIndex.clear();
          await this.persistBoard();
          this.broadcast({ type:"board-clear" });
          return;
        }

        if (msg.type === "share-mode") {
          this.meta.shareMode = msg.mode === "host" ? "host" : "all";
          await this.saveMeta();
          if (this.meta.shareMode === "host") {
            /* Anyone currently presenting (other than the host) is stopped. */
            for (const [socket, peer] of this.connectedSockets()) {
              if (!peer.sharing || this.isHost(peer)) continue;
              peer.sharing = false;
              try { socket.serializeAttachment(peer); } catch {}
              try { socket.send(JSON.stringify({ type:"screen-stopped", reason:"host-only" })); } catch {}
            }
          }
          this.broadcast(this.presence());
          return;
        }

        if (msg.type === "timer-start") {
          const seconds = Math.round(Number(msg.seconds));
          if (!Number.isFinite(seconds) || seconds < TIMER_MIN_SECONDS || seconds > TIMER_MAX_SECONDS) return;
          const label = typeof msg.label === "string" ? msg.label.trim().slice(0, 40) : "";
          this.meta.timer = { id: uuid(), label, durationMs: seconds * 1000, endsAt: now() + seconds * 1000 };
          await this.saveMeta();
          this.broadcast(this.presence());
          return;
        }

        if (msg.type === "timer-stop") {
          if (!this.meta.timer) return;
          this.meta.timer = null;
          await this.saveMeta();
          this.broadcast(this.presence());
          return;
        }

        if (msg.type === "poll-create") {
          const question = typeof msg.question === "string" ? msg.question.trim().slice(0, 140) : "";
          const options = Array.isArray(msg.options)
            ? (msg.options as unknown[]).filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 60)).filter(Boolean).slice(0, POLL_MAX_OPTIONS)
            : [];
          if (!question || options.length < 2) return;
          this.meta.poll = { id: uuid(), question, options, votes: {}, open: true, createdAt: now() };
          await this.saveMeta();
          this.broadcastPoll();
          return;
        }

        if (msg.type === "poll-close") {
          if (!this.meta.poll || !this.meta.poll.open) return;
          this.meta.poll.open = false;
          await this.saveMeta();
          this.broadcastPoll();
          return;
        }

        if (msg.type === "poll-dismiss") {
          if (!this.meta.poll) return;
          this.meta.poll = null;
          await this.saveMeta();
          this.broadcast({ type:"poll", poll:null });
          return;
        }
        return;
      }

      if (msg.type === "poll-vote") {
        const poll = this.meta.poll;
        const choice = Math.round(Number(msg.option));
        if (!poll || !poll.open || msg.id !== poll.id || !Number.isInteger(choice) || choice < 0 || choice >= poll.options.length) return;
        poll.votes[session.id] = choice;
        await this.saveMeta();
        this.broadcastPoll();
        return;
      }

      /* Live captions: short, never stored, rate-limited per speaker. */
      if (msg.type === "caption") {
        const text = typeof msg.text === "string" ? msg.text.trim().slice(0, CAPTION_MAX_CHARS) : "";
        if (!text) return;
        const slot = this.captionWindow.get(session.id);
        if (!slot || current - slot.at >= 1000) this.captionWindow.set(session.id, { at: current, count: 1 });
        else if (++slot.count > CAPTION_MAX_PER_SECOND) return;
        this.broadcast({ type:"caption", uid:session.id, name:session.username, text, final:!!msg.final }, ws);
        return;
      }

      /* ── whiteboard ── */
      if (msg.type === "board-stroke") {
        if (this.meta.boardDrawers === "host" && !this.isHost(session)) return;
        const strokeId = typeof msg.id === "string" && msg.id.length > 0 && msg.id.length <= 40 ? msg.id : "";
        if (!strokeId) return;
        const tool = msg.tool === "highlight" || msg.tool === "eraser" ? msg.tool : "pen";
        const color = typeof msg.color === "string" && BOARD_COLOR_RE.test(msg.color) ? msg.color : "#111827";
        const size = Math.min(60, Math.max(1, Math.round(Number(msg.size) || 4)));
        let incoming = Array.isArray(msg.pts)
          ? (msg.pts as unknown[]).filter((value): value is number => typeof value === "number" && Number.isFinite(value))
              .slice(0, BOARD_FRAGMENT_MAX_NUMBERS)
              .map((value) => Math.max(0, Math.min(1000, Math.round(value))))
          : [];
        if (incoming.length % 2) incoming = incoming.slice(0, incoming.length - 1);

        let stroke = this.boardIndex.get(strokeId);
        if (stroke && stroke.uid !== session.id) return;
        if (!stroke) {
          if (!incoming.length) return;
          stroke = { id:strokeId, uid:session.id, tool, color, size, pts:[] };
          this.board.push(stroke);
          this.boardIndex.set(strokeId, stroke);
        }
        const room = Math.max(0, STROKE_MAX_NUMBERS - stroke.pts.length);
        const accepted = incoming.slice(0, room - (room % 2));
        if (accepted.length) stroke.pts.push(...accepted);

        /* Keep the board bounded: drop the oldest strokes first. */
        const removed: string[] = [];
        let total = this.boardNumbers();
        while (this.board.length > BOARD_MAX_STROKES || total > BOARD_MAX_NUMBERS) {
          const oldest = this.board.shift();
          if (!oldest) break;
          total -= oldest.pts.length;
          this.boardIndex.delete(oldest.id);
          removed.push(oldest.id);
        }
        for (const removedId of removed) this.broadcast({ type:"board-remove", id:removedId });

        this.broadcast({ type:"board-stroke", uid:session.id, id:strokeId, tool:stroke.tool, color:stroke.color, size:stroke.size, pts:accepted, end:!!msg.end }, ws);
        if (msg.end || removed.length) await this.persistBoard();
        return;
      }

      if (msg.type === "board-undo") {
        for (let i = this.board.length - 1; i >= 0; i--) {
          if (this.board[i].uid !== session.id) continue;
          const [removedStroke] = this.board.splice(i, 1);
          this.boardIndex.delete(removedStroke.id);
          this.broadcast({ type:"board-remove", id:removedStroke.id });
          await this.persistBoard();
          break;
        }
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

  async webSocketClose(ws: WebSocket, code?: number, reason?: string) {
    const peer = this.peerOf(ws);
    const safeCode = typeof code === "number" && code >= 1000 && code <= 4999 && ![1005, 1006, 1015].includes(code) ? code : 1000;
    try { ws.close(safeCode, (reason ?? "").slice(0, 100)); } catch {}
    /* A replaced socket was already removed from the list when its successor
       connected; announcing again would only cause a redundant refresh. */
    if (peer && !peer.superseded) this.broadcast(this.presence(ws), ws);
  }

  async webSocketError(ws: WebSocket) {
    const peer = this.peerOf(ws);
    if (peer && !peer.superseded) this.broadcast(this.presence(ws), ws);
  }

  /** Periodic sweep: evicts "ghost" participants whose connection died without
   * a close frame (network loss, closed laptop lid, killed app). */
  async alarm() {
    const sockets = this.state.getWebSockets();
    if (!sockets.length) return;

    const stampOf = (this.state as unknown as { getWebSocketAutoResponseTimestamp?: (socket: WebSocket) => Date | null }).getWebSocketAutoResponseTimestamp;
    const current = now();
    let evicted = false;

    if (typeof stampOf === "function") {
      for (const socket of sockets) {
        const peer = this.peerOf(socket);
        /* Only clients that speak the heartbeat protocol (they send a sid) are
           expected to ping; older cached bundles are never evicted. */
        if (!peer || peer.superseded || !peer.sid) continue;
        let stamp = 0;
        try { stamp = stampOf.call(this.state, socket)?.getTime() ?? 0; } catch {}
        const last = Math.max(peer.joinedAt ?? 0, peer.lastActive ?? 0, stamp);
        if (current - last <= STALE_AFTER_MS) continue;
        peer.superseded = true;
        try { socket.serializeAttachment(peer); } catch {}
        try { socket.close(4000, "Stale connection"); } catch {}
        evicted = true;
      }
    }

    if (evicted) this.broadcast(this.presence());
    if (this.state.getWebSockets().length) {
      try { await this.state.storage.setAlarm(current + SWEEP_EVERY_MS); } catch {}
    }
  }
}

/**
 * One Durable Object per user. The browser keeps a WebSocket to it; the Worker
 * pokes it ("a friend request arrived", "someone is calling you") and every open
 * tab of that user refreshes immediately instead of waiting for the next poll.
 * Nothing is stored: it only relays "something changed" hints, the real data is
 * always re-read through the normal authenticated API.
 */
export class UserHub {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    try { state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch {}
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const userId = request.headers.get("x-user-id");
      if (!userId) return new Response("Unauthorized", { status:401 });
      /* A handful of tabs is normal; beyond that the oldest connections go. */
      const open = this.state.getWebSockets();
      while (open.length >= USER_HUB_MAX_SOCKETS) {
        const oldest = open.shift();
        try { oldest?.close(1000, "Too many connections"); } catch {}
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ userId, at: now() });
      try { server.send(JSON.stringify({ type:"hello" })); } catch {}
      return new Response(null, { status:101, webSocket:client } as any);
    }

    if (url.pathname.endsWith("/notify") && request.method === "POST") {
      const body = await request.json().catch(() => null) as { event?: unknown } | null;
      const event = typeof body?.event === "string" ? body.event.slice(0, 32) : "";
      if (!event) return json({ error:"event required" }, { status:400 });
      const text = JSON.stringify({ type:"event", event });
      let delivered = 0;
      for (const socket of this.state.getWebSockets()) {
        try { socket.send(text); delivered += 1; } catch {}
      }
      return json({ delivered });
    }

    return json({ error:"Not found" }, { status:404 });
  }

  async webSocketMessage() { /* clients only listen */ }

  async webSocketClose(ws: WebSocket, code?: number, reason?: string) {
    const safeCode = typeof code === "number" && code >= 1000 && code <= 4999 && ![1005, 1006, 1015].includes(code) ? code : 1000;
    try { ws.close(safeCode, (reason ?? "").slice(0, 100)); } catch {}
  }

  async webSocketError() { /* the browser reconnects on its own */ }
}

const USER_HUB_MAX_SOCKETS = 8;

/** Tell every open tab of `userId` that something changed ("incoming", "friends"). Never throws. */
async function notifyUser(env: Env, userId: string, event: string) {
  try {
    if (!env.USER_HUBS || !userId) return;
    await env.USER_HUBS.get(env.USER_HUBS.idFromName(userId)).fetch(new Request("https://user-hub.local/notify", {
      method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ event }),
    }));
  } catch { /* pushing is an optimisation; polling still works */ }
}

async function callDO(env: Env, code:string, req:Request, user:SafeUser, hostId = ""): Promise<Response> {
  const id = env.CALL_ROOMS.idFromName(code);
  const headers = new Headers(req.headers);
  headers.set("x-user-id", user.id);
  headers.set("x-username", user.username);
  headers.set("x-avatar", user.avatar);
  if (hostId) headers.set("x-host-id", hostId);
  else headers.delete("x-host-id");
  const response = await env.CALL_ROOMS.get(id).fetch(new Request(req, { headers }));
  return response ?? new Response("Call room unavailable", { status:503 });
}

async function runEnsureAuthDatabase(env: Env) {
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
    env.HALLOCALL_DB.prepare(`CREATE TABLE IF NOT EXISTS call_members (
      call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_joined_at INTEGER NOT NULL,
      last_joined_at INTEGER NOT NULL,
      PRIMARY KEY (call_id, user_id)
    )`),
    env.HALLOCALL_DB.prepare(`CREATE INDEX IF NOT EXISTS call_members_user_idx ON call_members(user_id, last_joined_at)`),
    env.HALLOCALL_DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    )`),
  ]);
  /* "join" invites ring someone into a call that is already running (declining
     must not end that call). SQLite has no ADD COLUMN IF NOT EXISTS, so a
     second run simply fails harmlessly. */
  try {
    await env.HALLOCALL_DB.prepare(`ALTER TABLE call_invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'quick'`).run();
  } catch { /* column already there */ }
}

/* The schema check used to run 16 statements on EVERY login and registration.
   It is now done once per Worker isolate; the health endpoint can force a repair. */
let authSchemaReady: Promise<void> | null = null;
function ensureAuthDatabase(env: Env) {
  authSchemaReady ??= runEnsureAuthDatabase(env).catch((error) => {
    authSchemaReady = null;
    throw error;
  });
  return authSchemaReady;
}

/* ── rate limiting (fixed window per key, stored in D1) ───────────────── */

function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/** Counts this attempt and says whether it is still within `limit` per `windowMs`. Fails open on database trouble. */
async function rateLimit(env: Env, key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfter: number }> {
  try {
    await ensureAuthDatabase(env);
    const at = now();
    const row = await env.HALLOCALL_DB.prepare(`INSERT INTO rate_limits(key,window_start,count) VALUES(?1,?2,1)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
        window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
      RETURNING count, window_start`).bind(key, at, at - windowMs).first<{ count:number; window_start:number }>();
    if (Math.random() < 0.02) {
      await env.HALLOCALL_DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?1`).bind(at - 86_400_000).run();
    }
    if (!row || row.count <= limit) return { ok:true, retryAfter:0 };
    return { ok:false, retryAfter:Math.max(1, Math.ceil((row.window_start + windowMs - at) / 1000)) };
  } catch {
    return { ok:true, retryAfter:0 };
  }
}

function tooManyRequests(retryAfter: number) {
  const minutes = retryAfter >= 90 ? `${Math.ceil(retryAfter / 60)} دقیقه` : `${retryAfter} ثانیه`;
  return json({ error:`تعداد تلاش‌ها زیاد است. حدود ${minutes} بعد دوباره امتحان کن.` }, { status:429, headers:{ "retry-after":String(retryAfter) } });
}

async function api(env: Env, req: Request): Promise<Response> {
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
        authSchemaReady = null;
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
    const avatar = typeof body?.avatar === "string" && SELECTABLE_AVATARS.has(body.avatar) ? body.avatar : "ronaldo_red";
    const registerLimit = await rateLimit(env, `register:ip:${clientIp(req)}`, 12, 3_600_000);
    if (!registerLimit.ok) return tooManyRequests(registerLimit.retryAfter);
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
    /* Brute-force protection: per account+network and per network. Generous enough for shared Wi-Fi. */
    const ip = clientIp(req);
    const byAccount = await rateLimit(env, `login:acct:${ip}:${username.toLowerCase().slice(0, 40)}`, 12, 600_000);
    if (!byAccount.ok) return tooManyRequests(byAccount.retryAfter);
    const byNetwork = await rateLimit(env, `login:ip:${ip}`, 80, 600_000);
    if (!byNetwork.ok) return tooManyRequests(byNetwork.retryAfter);
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
    const avatar = typeof body?.avatar === "string" && SELECTABLE_AVATARS.has(body.avatar) ? body.avatar : null;
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
    const searchLimit = await rateLimit(env, `search:${auth.user.id}`, 90, 60_000);
    if (!searchLimit.ok) return tooManyRequests(searchLimit.retryAfter);
    const pattern = likeContains(q);
    const rows = await env.HALLOCALL_DB.prepare(`SELECT id,username,avatar FROM users WHERE username_lower LIKE ?1 ESCAPE '\\' AND id<>?2 ORDER BY username_lower LIMIT 12`).bind(pattern,auth.user.id).all<{id:string;username:string;avatar:string}>();
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
    const requestLimit = await rateLimit(env, `friend-request:${auth.user.id}`, 40, 3_600_000);
    if (!requestLimit.ok) return tooManyRequests(requestLimit.retryAfter);
    const target = await env.HALLOCALL_DB.prepare(`SELECT id FROM users WHERE id=?1`).bind(userId).first();
    if (!target) return json({ error:"کاربر پیدا نشد." }, { status:404 });
    const existing = await friendshipBetween(env,auth.user.id,userId);
    if (existing?.status === "accepted") return json({ error:"این کاربر از قبل دوست شماست." }, { status:409 });
    if (existing?.status === "pending") return json({ error:existing.requester_id===auth.user.id?"درخواست دوستی از قبل ارسال شده است.":"این کاربر برای شما درخواست فرستاده است." }, { status:409 });
    if (existing) await env.HALLOCALL_DB.prepare(`DELETE FROM friendships WHERE id=?1`).bind(existing.id).run();
    /* The symmetric NOT EXISTS check is part of the insert itself, so two
       opposite-direction requests submitted at the same time cannot create
       duplicate pending relationships. */
    const inserted = await env.HALLOCALL_DB.prepare(`INSERT INTO friendships(id,requester_id,addressee_id,status,created_at)
      SELECT ?1,?2,?3,'pending',?4 WHERE NOT EXISTS (
        SELECT 1 FROM friendships WHERE (requester_id=?2 AND addressee_id=?3) OR (requester_id=?3 AND addressee_id=?2)
      )`).bind(uuid(),auth.user.id,userId,now()).run();
    if (!inserted.meta.changes) {
      const raced = await friendshipBetween(env,auth.user.id,userId);
      const message = raced?.status==="accepted" ? "این کاربر از قبل دوست شماست."
        : raced?.status==="pending" && raced.requester_id!==auth.user.id ? "این کاربر برای شما درخواست فرستاده است."
        : "درخواست دوستی از قبل ارسال شده است.";
      return json({ error:message }, { status:409 });
    }
    await notifyUser(env, userId, "friends");
    return json({ ok:true });
  }
  if (path === "/api/friends/respond" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { friendshipId?:unknown; action?:unknown } | null;
    const id = typeof body?.friendshipId === "string" ? body.friendshipId : "";
    const action = body?.action === "accept" ? "accepted" : body?.action === "decline" ? "declined" : null;
    if (!id || !action) return json({ error:"درخواست نامعتبر است." }, { status:400 });
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,requester_id,addressee_id,status FROM friendships WHERE id=?1`).bind(id).first<{id:string;requester_id:string;addressee_id:string;status:string}>();
    if (!row || row.addressee_id!==auth.user.id || row.status!=="pending") return json({ error:"درخواست پیدا نشد." }, { status:404 });
    await env.HALLOCALL_DB.prepare(`UPDATE friendships SET status=?1, responded_at=?2 WHERE id=?3`).bind(action,now(),id).run();
    await notifyUser(env, row.requester_id, "friends");
    await notifyUser(env, auth.user.id, "friends");
    return json({ ok:true });
  }
  if (path === "/api/friends/remove" && method === "DELETE") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { friendshipId?:unknown } | null;
    const id = typeof body?.friendshipId === "string" ? body.friendshipId : "";
    const gone = await env.HALLOCALL_DB.prepare(`SELECT requester_id,addressee_id FROM friendships WHERE id=?1 AND (requester_id=?2 OR addressee_id=?2)`).bind(id,auth.user.id).first<{requester_id:string;addressee_id:string}>();
    await env.HALLOCALL_DB.prepare(`DELETE FROM friendships WHERE id=?1 AND (requester_id=?2 OR addressee_id=?2)`).bind(id,auth.user.id).run();
    if (gone) await notifyUser(env, gone.requester_id === auth.user.id ? gone.addressee_id : gone.requester_id, "friends");
    return json({ ok:true });
  }

  if (path === "/api/calls" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const body = await req.json().catch(() => null) as { name?:unknown } | null;
    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0,64) : "Friend Call";
    const createLimit = await rateLimit(env, `create-call:${auth.user.id}`, 40, 600_000);
    if (!createLimit.ok) return tooManyRequests(createLimit.retryAfter);
    const code = await uniqueCallCode(env); const id = uuid();
    await env.HALLOCALL_DB.prepare(`INSERT INTO calls(id,code,host_id,name,status,created_at) VALUES(?1,?2,?3,?4,'waiting',?5)`).bind(id,code,auth.user.id,name,now()).run();
    return json({ call:{id,code,name,hostId:auth.user.id,status:"waiting",maxParticipants:MAX_CALL_PARTICIPANTS} });
  }
  /* Incoming call requests MUST be handled before the /api/calls/:code lookup:
     otherwise "incoming" would be read as a call code and the ringing invite
     never reaches the friend being called. */
  if (path === "/api/calls/incoming" && method === "GET") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    await ensureAuthDatabase(env);
    const cutoff = now() - 120_000;
    await env.HALLOCALL_DB.prepare(`UPDATE call_invites SET status='expired',responded_at=?1 WHERE callee_id=?2 AND status='ringing' AND created_at<=?3`)
      .bind(now(),auth.user.id,cutoff).run();
    const rows = await env.HALLOCALL_DB.prepare(`SELECT i.id invite_id,i.kind,c.code,c.name,u.id caller_id,u.username caller_username,u.avatar caller_avatar
      FROM call_invites i JOIN calls c ON c.id=i.call_id JOIN users u ON u.id=i.caller_id WHERE i.callee_id=?1 AND i.status='ringing' AND c.status<>'ended' AND i.created_at>?2 ORDER BY i.created_at DESC LIMIT 8`)
      .bind(auth.user.id,cutoff).all<{invite_id:string;kind:string;code:string;name:string;caller_id:string;caller_username:string;caller_avatar:string}>();
    return json({ calls:rows.results.map(r=>({inviteId:r.invite_id,kind:r.kind==="join"?"join":"quick",code:r.code,name:r.name,caller:{id:r.caller_id,username:r.caller_username,avatar:r.caller_avatar}})) });
  }
  /* Calls this account has been in recently, newest first (for "join again"). */
  if (path === "/api/calls/recent" && method === "GET") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    await ensureAuthDatabase(env);
    const rows = await env.HALLOCALL_DB.prepare(`SELECT c.code,c.name,c.status,c.ended_at,c.host_id,h.username host_username,m.last_joined_at,
        (SELECT COUNT(*) FROM call_members x WHERE x.call_id=c.id) members
      FROM call_members m JOIN calls c ON c.id=m.call_id JOIN users h ON h.id=c.host_id
      WHERE m.user_id=?1 ORDER BY m.last_joined_at DESC LIMIT 12`)
      .bind(auth.user.id).all<{code:string;name:string;status:string;ended_at:number|null;host_id:string;host_username:string;last_joined_at:number;members:number}>();
    return json({ calls:rows.results.map((r)=>({
      code:r.code, name:r.name, status:r.status==="ended"?"ended":"active",
      isHost:r.host_id===auth.user.id, hostUsername:r.host_username,
      lastJoinedAt:r.last_joined_at, endedAt:r.ended_at, members:r.members,
    })) });
  }
  const RESERVED_CALL_ROUTES = new Set(["invite", "respond", "join", "leave", "incoming", "recent"]);
  const callMatch = path.match(/^\/api\/calls\/([^/]+)$/);
  if (callMatch && method === "GET" && !RESERVED_CALL_ROUTES.has(callMatch[1])) {
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
    const inviteLimit = await rateLimit(env, `invite:${auth.user.id}`, 40, 600_000);
    if (!inviteLimit.ok) return tooManyRequests(inviteLimit.retryAfter);
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
    await notifyUser(env, friendId, "incoming");
    return json({ inviteId, call:{id:callId,code,name,hostId:auth.user.id,status:"waiting",maxParticipants:MAX_CALL_PARTICIPANTS} });
  }

  /* Ring a friend into a call that is already running (from inside the call). */
  const inviteIntoCall = path.match(/^\/api\/calls\/([^/]+)\/invite$/);
  if (inviteIntoCall && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    await ensureAuthDatabase(env);
    const code = decodeURIComponent(inviteIntoCall[1]).toUpperCase();
    const body = await req.json().catch(() => null) as { friendId?:unknown } | null;
    const friendId = typeof body?.friendId === "string" ? body.friendId : "";
    const limit = await rateLimit(env, `invite-into-call:${auth.user.id}`, 60, 600_000);
    if (!limit.ok) return tooManyRequests(limit.retryAfter);
    const call = await env.HALLOCALL_DB.prepare(`SELECT id,status FROM calls WHERE code=?1 LIMIT 1`).bind(code).first<{id:string;status:string}>();
    if (!call || call.status === "ended") return json({ error:"این کال دیگر فعال نیست." }, { status:404 });
    const friendship = friendId ? await friendshipBetween(env,auth.user.id,friendId) : null;
    if (!friendship || friendship.status !== "accepted") return json({ error:"این کاربر دوست شما نیست." }, { status:403 });
    let room: { participants?:Array<{id:string}>; locked?:boolean; banned?:string[] } = {};
    try {
      const res = await env.CALL_ROOMS.get(env.CALL_ROOMS.idFromName(code)).fetch(new Request("https://call-room.local/state"));
      if (res.ok) room = await res.json();
    } catch {}
    const present = room.participants ?? [];
    if (!present.some((p) => p.id === auth.user.id)) return json({ error:"برای دعوت کردن باید خودت داخل تماس باشی." }, { status:403 });
    if (present.some((p) => p.id === friendId)) return json({ error:"این دوست همین الان در تماس است." }, { status:409 });
    if ((room.banned ?? []).includes(friendId)) return json({ error:"میزبان این کاربر را از تماس حذف کرده است." }, { status:403 });
    if (room.locked) return json({ error:"تماس قفل است؛ اول ورود را باز کن تا دوستت بتواند بیاید." }, { status:423 });
    if (present.length >= MAX_CALL_PARTICIPANTS) return json({ error:"تماس پر است." }, { status:409 });
    const recent = await env.HALLOCALL_DB.prepare(`SELECT id FROM call_invites WHERE call_id=?1 AND callee_id=?2 AND status='ringing' AND created_at>?3 LIMIT 1`).bind(call.id,friendId,now()-30_000).first();
    if (recent) return json({ error:"برای این دوست همین الان یک دعوت در حال زنگ‌خوردن است." }, { status:409 });
    const inviteId = uuid();
    await env.HALLOCALL_DB.prepare(`INSERT INTO call_invites(id,call_id,caller_id,callee_id,status,created_at,kind) VALUES(?1,?2,?3,?4,'ringing',?5,'join')`).bind(inviteId,call.id,auth.user.id,friendId,now()).run();
    await notifyUser(env, friendId, "incoming");
    return json({ ok:true, inviteId });
  }

  if (path === "/api/calls/respond" && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    await ensureAuthDatabase(env);
    const body = await req.json().catch(() => null) as { inviteId?:unknown; action?:unknown } | null;
    const id = typeof body?.inviteId === "string" ? body.inviteId : "";
    const action = body?.action === "accept" ? "accepted" : body?.action === "decline" ? "declined" : null;
    if (!id || !action) return json({ error:"درخواست نامعتبر است." }, { status:400 });
    const row = await env.HALLOCALL_DB.prepare(`SELECT i.id,i.kind,c.code,c.status call_status,i.callee_id,i.call_id,i.status invite_status FROM call_invites i JOIN calls c ON c.id=i.call_id WHERE i.id=?1 LIMIT 1`).bind(id).first<{id:string;kind:string;code:string;call_status:string;callee_id:string;call_id:string;invite_status:string}>();
    if (!row || row.callee_id!==auth.user.id || row.invite_status!=="ringing" || row.call_status==="ended") return json({ error:"این تماس دیگر در دسترس نیست." }, { status:409 });
    const respondedAt = now();
    const updated = await env.HALLOCALL_DB.prepare(`UPDATE call_invites SET status=?1,responded_at=?2 WHERE id=?3 AND callee_id=?4 AND status='ringing' AND EXISTS (SELECT 1 FROM calls WHERE id=call_invites.call_id AND status<>'ended')`)
      .bind(action,respondedAt,id,auth.user.id).run();
    if (!updated.meta.changes) return json({ error:"این تماس دیگر در دسترس نیست." }, { status:409 });
    if (action === "accepted") {
      const activated = await env.HALLOCALL_DB.prepare(`UPDATE calls SET status='active' WHERE id=?1 AND status<>'ended'`).bind(row.call_id).run();
      if (!activated.meta.changes) return json({ error:"این تماس دیگر در دسترس نیست." }, { status:409 });
      await env.HALLOCALL_DB.prepare(`UPDATE call_invites SET status='expired',responded_at=?1 WHERE callee_id=?2 AND status='ringing' AND id<>?3`).bind(respondedAt,auth.user.id,id).run();
    } else if (row.kind !== "join") {
      /* The caller joins immediately while the invite is ringing. End active
         quick-call rooms too, so a decline cannot leave the caller stranded.
         (An invite into a running group call never ends that call.) */
      await env.HALLOCALL_DB.prepare(`UPDATE calls SET status='ended',ended_at=?1 WHERE id=?2 AND status<>'ended'`).bind(respondedAt,row.call_id).run();
      const roomId = env.CALL_ROOMS.idFromName(row.code);
      try { await env.CALL_ROOMS.get(roomId).fetch(new Request("https://call-room.local/end")); } catch {}
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
        const state = await stateRes.json() as { participants?:Array<{id:string}>; locked?:boolean; members?:string[]; banned?:string[] };
        const participants = state.participants ?? [];
        const isHost = row.host_id === auth.user.id;
        if (!isHost && (state.banned ?? []).includes(auth.user.id)) {
          return json({ error:"میزبان شما را از این تماس حذف کرده است." }, { status:403 });
        }
        if (!isHost && state.locked && !(state.members ?? []).includes(auth.user.id) && !participants.some(p=>p.id===auth.user.id)) {
          return json({ error:"میزبان این تماس را قفل کرده است و ورود تازه‌واردها بسته است." }, { status:423 });
        }
        if (participants.length >= MAX_CALL_PARTICIPANTS && !participants.some(p=>p.id===auth.user.id)) {
          return json({ error:`این کال در حال حاضر پر است. حداکثر ظرفیت این تماس ${MAX_CALL_PARTICIPANTS} نفر است.` }, { status:409 });
        }
      }
    } catch {}
    if (row.status === "waiting") await env.HALLOCALL_DB.prepare(`UPDATE calls SET status='active' WHERE id=?1 AND status='waiting'`).bind(row.id).run();
    /* "Recent calls" history; must never block a join. */
    try {
      await ensureAuthDatabase(env);
      const at = now();
      await env.HALLOCALL_DB.prepare(`INSERT INTO call_members(call_id,user_id,first_joined_at,last_joined_at) VALUES(?1,?2,?3,?3)
        ON CONFLICT(call_id,user_id) DO UPDATE SET last_joined_at=excluded.last_joined_at`).bind(row.id,auth.user.id,at).run();
    } catch {}
    return json({ ok:true, call:callJson({...row,status:"active"}) });
  }
  /* Pick the person who has been in the room longest (other than `excludeId`). */
  const pickSuccessor = async (code: string, excludeId: string) => {
    try {
      const res = await env.CALL_ROOMS.get(env.CALL_ROOMS.idFromName(code)).fetch(new Request("https://call-room.local/state"));
      if (!res.ok) return null;
      const state = await res.json() as { participants?:Array<{id:string;joinedAt?:number}> };
      const others = (state.participants ?? []).filter((p) => p.id !== excludeId).sort((a,b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
      return others[0]?.id ?? null;
    } catch { return null; }
  };
  const setHost = async (row: {id:string}, code: string, hostId: string) => {
    await env.HALLOCALL_DB.prepare(`UPDATE calls SET host_id=?1 WHERE id=?2 AND status<>'ended'`).bind(hostId,row.id).run();
    await env.CALL_ROOMS.get(env.CALL_ROOMS.idFromName(code)).fetch(new Request("https://call-room.local/host", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ hostId }) }));
  };

  const transferMatch = path.match(/^\/api\/calls\/([^/]+)\/transfer$/);
  if (transferMatch && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const code = decodeURIComponent(transferMatch[1]).toUpperCase();
    const body = await req.json().catch(() => null) as { userId?:unknown } | null;
    const targetId = typeof body?.userId === "string" ? body.userId : "";
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,host_id,status FROM calls WHERE code=?1 LIMIT 1`).bind(code).first<{id:string;host_id:string;status:string}>();
    if (!row || row.status==="ended") return json({ error:"این کال دیگر فعال نیست." }, { status:404 });
    if (row.host_id !== auth.user.id) return json({ error:"فقط میزبان می‌تواند میزبانی را واگذار کند." }, { status:403 });
    if (!targetId || targetId === auth.user.id) return json({ error:"کاربر نامعتبر است." }, { status:400 });
    let inRoom = false;
    try {
      const res = await env.CALL_ROOMS.get(env.CALL_ROOMS.idFromName(code)).fetch(new Request("https://call-room.local/state"));
      const state = await res.json() as { participants?:Array<{id:string}> };
      inRoom = (state.participants ?? []).some((p) => p.id === targetId);
    } catch {}
    if (!inRoom) return json({ error:"این کاربر الان در تماس نیست." }, { status:409 });
    await setHost(row, code, targetId);
    return json({ ok:true, hostId:targetId });
  }

  const leaveMatch = path.match(/^\/api\/calls\/([^/]+)\/leave$/);
  if (leaveMatch && method === "POST") {
    const auth = await requireUser(env,req); if ("response" in auth) return auth.response;
    const code = decodeURIComponent(leaveMatch[1]).toUpperCase();
    const body = await req.json().catch(() => null) as { transfer?:unknown } | null;
    const row = await env.HALLOCALL_DB.prepare(`SELECT id,host_id FROM calls WHERE code=?1 LIMIT 1`).bind(code).first<{id:string;host_id:string}>();
    if (row && row.host_id===auth.user.id) {
      /* By default the host leaving ends the call. With {transfer:true} the call
         continues and the longest-present participant becomes the new host. */
      const successor = body?.transfer === true ? await pickSuccessor(code, auth.user.id) : null;
      if (successor) {
        await setHost(row, code, successor);
        return json({ ok:true, hostId:successor });
      }
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

/** WebSockets must come from this site (or from a local dev proxy). */
function originAllowed(req: Request, url: URL) {
  const origin = req.headers.get("Origin");
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
    const host = req.headers.get("host") || url.host;
    const behindLocalProxy = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    const requestHost = behindLocalProxy ? (forwardedHost || host) : host;
    return parsedOrigin.host.toLowerCase() === requestHost.toLowerCase() &&
      (behindLocalProxy && forwardedHost ? true : parsedOrigin.origin === url.origin);
  } catch {
    return false;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(env,req);
      if (url.pathname === "/ws/user") {
        if (!originAllowed(req, url)) return new Response("Forbidden", {status:403});
        const user = await currentUser(env,req);
        if (!user) return new Response("Unauthorized", {status:401});
        if (!env.USER_HUBS) return new Response("Realtime channel unavailable", {status:503});
        const headers = new Headers(req.headers);
        headers.set("x-user-id", user.id);
        return env.USER_HUBS.get(env.USER_HUBS.idFromName(user.id)).fetch(new Request(req, { headers }));
      }
      if (url.pathname.startsWith("/ws/call/")) {
        if (!originAllowed(req, url)) return new Response("Forbidden", {status:403});
        const user = await currentUser(env,req);
        if (!user) return new Response("Unauthorized", {status:401});
        const code = decodeURIComponent(url.pathname.split("/").pop() || "").toUpperCase();
        const row = await env.HALLOCALL_DB.prepare(`SELECT id,host_id FROM calls WHERE code=?1 AND status<>'ended' LIMIT 1`).bind(code).first<{id:string;host_id:string}>();
        if (!row) return new Response("Call not found", {status:404});
        return callDO(env,code,req,user,row.host_id);
      }
      const assetResponse = await env.ASSETS.fetch(req);
      return assetResponse ?? new Response("Asset unavailable", { status:503 });
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
