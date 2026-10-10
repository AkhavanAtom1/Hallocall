import type { CallInfo, Friend, FriendRequest, IncomingCall, User } from "./types";

const encoder = new TextEncoder();

function bytesToB64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function passwordProof(username: string, password: string) {
  const normalized = username.trim().toLowerCase();
  const saltBuffer = await crypto.subtle.digest("SHA-256", encoder.encode("hallocall-client-salt:v2:" + normalized));
  const salt = new Uint8Array(saltBuffer).slice(0, 16);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" }, key, 256);
  return bytesToB64(new Uint8Array(bits));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers, ...rest } = init ?? {};
  const res = await fetch(path, {
    credentials: "include",
    ...rest,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "خطایی رخ داد.";
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>("/api/auth/me"),
  login: async (username: string, password: string) => request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, passwordProof: await passwordProof(username, password) }) }),
  register: async (username: string, password: string, avatar: string) => request<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, passwordProof: await passwordProof(username, password), avatar }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  profile: (avatar: string) => request<{ user: User }>("/api/profile", { method: "PATCH", body: JSON.stringify({ avatar }) }),
  friends: () => request<{ friends: Friend[]; requests: FriendRequest[] }>("/api/friends"),
  searchUsers: (q: string) => request<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),
  friendRequest: (userId: string) => request<{ ok: true }>("/api/friends/request", { method: "POST", body: JSON.stringify({ userId }) }),
  friendRespond: (friendshipId: string, action: "accept" | "decline") => request<{ ok: true }>("/api/friends/respond", { method: "POST", body: JSON.stringify({ friendshipId, action }) }),
  friendRemove: (friendshipId: string) => request<{ ok: true }>("/api/friends/remove", { method: "DELETE", body: JSON.stringify({ friendshipId }) }),
  touch: () => request<{ ok: true }>("/api/presence", { method: "POST" }),
  createCall: (name?: string) => request<{ call: CallInfo }>("/api/calls", { method: "POST", body: JSON.stringify({ name }) }),
  getCall: (code: string) => request<{ call: CallInfo }>(`/api/calls/${encodeURIComponent(code)}`),
  invite: (friendId: string) => request<{ inviteId: string; call: CallInfo }>("/api/calls/invite", { method: "POST", body: JSON.stringify({ friendId }) }),
  incoming: () => request<{ calls: IncomingCall[] }>("/api/calls/incoming"),
  respondCall: (inviteId: string, action: "accept" | "decline") => request<{ ok: true; code?: string }>("/api/calls/respond", { method: "POST", body: JSON.stringify({ inviteId, action }) }),
  join: (code: string) => request<{ ok: true; call: CallInfo }>(`/api/calls/${encodeURIComponent(code)}/join`, { method: "POST" }),
  leave: (code: string) => request<{ ok: true }>(`/api/calls/${encodeURIComponent(code)}/leave`, { method: "POST" }),
};