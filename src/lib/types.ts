export type AvatarId =
  | "ronaldo_red" | "ronaldo_white" | "ronaldo_black"
  | "messi_barca_blue" | "messi_barca_purple"
  | "ronaldinho_brazil" | "ronaldinho_milan"
  | "neymar_brazil" | "neymar_barca" | "dybala_juve"
  | "ronaldo_red_alt" | "messi_argentina" | "mbappe_france"
  | "van_dijk_netherlands" | "haaland_city"
  /* ── season-accurate legends added in v4 (files 31–40 in image/) ── */
  | "ronaldo_united_0708" | "ronaldo_madrid_1718" | "ronaldo_juve_1819"
  | "ronaldo_united_concept" | "ronaldo_alnassr" | "ronaldo_portugal_2018"
  | "messi_barca_2012" | "maldini_milan_0203" | "ramos_madrid_1718" | "ibrahimovic_milan_1112"
  | "crimson_weaver" | "nightwarden" | "solar_sentinel" | "arc_titan" | "voltara"
  | "tarnished" | "malenia" | "radahn" | "ranni" | "melina"
  | "artorias" | "solaire" | "ornstein" | "black_knight" | "nameless_king"
  | "sekiro" | "ghost_samurai" | "kratos" | "geralt" | "doom_slayer"
  | "aurora" | "ember" | "ocean" | "violet" | "mint" | "sunset"
  | "cosmic" | "rose" | "bolt" | "forest" | "pearl" | "lava";

/** Avatar ids that may still be assigned from the picker. */
export const SELECTABLE_AVATAR_IDS = [
  "ronaldo_red", "ronaldo_white", "ronaldo_black", "messi_barca_blue", "messi_barca_purple",
  "ronaldinho_brazil", "ronaldinho_milan", "neymar_brazil", "neymar_barca", "dybala_juve",
  "ronaldo_red_alt", "messi_argentina", "mbappe_france", "van_dijk_netherlands", "haaland_city",
  "tarnished", "malenia", "radahn", "ranni", "melina",
  "artorias", "solaire", "ornstein", "black_knight", "nameless_king",
  "sekiro", "ghost_samurai", "kratos", "geralt", "doom_slayer",
  "ronaldo_united_0708", "ronaldo_madrid_1718", "ronaldo_juve_1819", "ronaldo_united_concept",
  "ronaldo_alnassr", "ronaldo_portugal_2018", "messi_barca_2012", "maldini_milan_0203",
  "ramos_madrid_1718", "ibrahimovic_milan_1112",
  "crimson_weaver", "nightwarden", "solar_sentinel", "arc_titan", "voltara",
] as const;

/** Everything the backend accepts, including retired gradient avatars.
 *  NOTE: keep this list in sync with `src/lib/avatars.catalog.json`;
 *  `scripts/build-avatars.mjs` prints a warning when the two drift apart. */
export const KNOWN_AVATAR_IDS = [
  ...SELECTABLE_AVATAR_IDS,
  "aurora", "ember", "ocean", "violet", "mint", "sunset",
  "cosmic", "rose", "bolt", "forest", "pearl", "lava",
] as const;

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
  maxParticipants: number;
};

export type IncomingCall = {
  inviteId: string;
  /** "join" = a friend is ringing you into a call that is already running. */
  kind?: "quick" | "join";
  code: string;
  name: string;
  caller: User;
};

export type Participant = User & {
  muted: boolean;
  speaking?: boolean;
  connected?: boolean;
  /** True while this participant is presenting their screen. */
  sharing?: boolean;
  /** Browser page-session id; WebRTC links are bound to it (see lib/mesh.ts). */
  sid?: string;
  /** When the hand was raised (ms since epoch); 0/undefined = hand down. Also the queue order. */
  hand?: number;
  /** True while this participant is recording the call on their own device. */
  rec?: boolean;
  /** When this person entered the room (used to pick the next host). */
  joinedAt?: number;
};

/** Room-wide state published by the Durable Object with every presence update. */
export type RoomInfo = {
  hostId: string;
  locked: boolean;
  board: { open: boolean; drawers: "all" | "host" };
  /** Who may share their screen. */
  shareMode: "all" | "host";
  /** Shared countdown, as "time left" so wrong device clocks do not matter. */
  timer: { id: string; label: string; durationMs: number; remainingMs: number } | null;
};

/** A quick poll as seen by one participant. */
export type PollView = {
  id: string;
  question: string;
  options: Array<{ text: string; count: number }>;
  open: boolean;
  total: number;
  myVote: number | null;
};

/** A call this account was in recently (the "join again" list). */
export type RecentCall = {
  code: string;
  name: string;
  status: "active" | "ended";
  isHost: boolean;
  hostUsername: string;
  lastJoinedAt: number;
  endedAt: number | null;
  members: number;
};
