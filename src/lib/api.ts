import type { CallInfo, Friend, FriendRequest, IncomingCall, User } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "خطایی رخ داد.");
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>("/api/auth/me"),
  login: (username: string, password: string) => request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string, avatar: string) => request<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password, avatar }) }),
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
