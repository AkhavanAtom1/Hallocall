export type AvatarId =
  | "ronaldo_red" | "ronaldo_white" | "ronaldo_black"
  | "messi_barca_blue" | "messi_barca_purple"
  | "ronaldinho_brazil" | "ronaldinho_milan"
  | "neymar_brazil" | "neymar_barca" | "dybala_juve"
  | "ronaldo_red_alt" | "messi_argentina" | "mbappe_france"
  | "van_dijk_netherlands" | "haaland_city"
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

export type Participant = User & {
  muted: boolean;
  speaking?: boolean;
  connected?: boolean;
};
