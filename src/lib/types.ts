export type AvatarId =
  | "aurora" | "ember" | "ocean" | "violet" | "mint" | "sunset"
  | "cosmic" | "rose" | "bolt" | "forest" | "pearl" | "lava";

export type User = {
  id: string;
  username: string;
  avatar: AvatarId;
};

export type Friend = User & {
  friendshipId: string;
  online: boolean;
  direction: "friend";
};

export type FriendRequest = User & {
  friendshipId: string;
  direction: "incoming" | "outgoing";
  status: "pending";
};

export type CallInfo = {
  id: string;
  code: string;
  name: string;
  hostId: string;
  status: "waiting" | "active" | "ended";
};

export type IncomingCall = {
  inviteId: string;
  code: string;
  name: string;
  caller: User;
};

export type Participant = User & { muted: boolean; speaking?: boolean; connected?: boolean };
