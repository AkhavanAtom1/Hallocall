# HalloCall Architecture

## Request flow

Browser → Cloudflare Worker → D1 for durable application data.

Browser → `/ws/call/:code` → Worker auth → Durable Object instance named by Call Code.

The Durable Object coordinates all real-time events for one call:

- participant presence (up to 20 concurrent participants)
- WebRTC signaling messages
- mute state
- chat messages
- reactions

## WebRTC model

The application uses browser-to-browser audio. Signaling is not the media path.

1. Browser A connects to the Call Durable Object.
2. Browser B connects to the same Call Durable Object.
3. The DO forwards `offer`, `answer`, and ICE candidates to the intended peer.
4. Browsers establish the actual WebRTC audio channel.
5. The quality slider changes the outgoing audio sender bitrate.
6. Cloudflare TURN can be enabled for difficult NAT/firewall cases.

### Sessions, reconnects and the mesh engine (`src/lib/mesh.ts`)

Every browser page generates a random **session id** (`sid`) and sends it when it opens the WebSocket (`/ws/call/:code?sid=…`). The Durable Object stores it next to the participant and publishes it in every `presence` list.

- A WebRTC link belongs to *(user, remote sid)*. When the same user comes back with a new `sid`, the old `RTCPeerConnection` is closed and a new one is negotiated; signals carry `sid`/`toSid`, so packets from a dead session are dropped.
- Negotiation uses the *perfect negotiation* pattern (polite/impolite by user id), so both sides may renegotiate at any time (screen share) without deadlocks. The polite side waits ~350 ms before its first offer to avoid needless collisions.
- Health: `connected` → ok. `disconnected` for 2.5 s or `failed` → ICE restart. A link that never comes up is restarted by a watchdog. After 6 failed restarts the page does a full re-join with a fresh `sid` (at most once per 45 s).
- Signals from ids that are not in the participant list are buffered for a few seconds (presence can lag by a few milliseconds) and then discarded; they never create participants.

### Keep-alive and ghost cleanup

The Durable Object registers `setWebSocketAutoResponse("ping" → "pong")`, so the browser can ping every 15 s without waking the object. A pong that does not arrive within 40 s makes the page drop the socket and reconnect. On the server an alarm runs every 30 s while sockets exist and evicts any heartbeat-capable client that has been silent for 75 s (a closed laptop lid, a lost network).

### One connection per user

`CallRoom.connectedSockets()` returns exactly one socket per user id (the newest). When a user connects again, older sockets are flagged `superseded` in their attachment *before* `close()` is called, so they disappear from snapshots immediately. If the new connection has a different `sid` (second tab/device), the old page receives `{type:"replaced"}` and stops instead of reconnecting.

### Screen share

Screen share is a second (video) track on the same peer connections, added with `addTrack` and removed with `removeTrack`; the resulting renegotiation goes through the same perfect-negotiation path. The Durable Object keeps a `sharing` flag per participant (one presenter at a time; others receive `screen-denied`) and the flag is part of `presence`, which is what the UI uses to show or hide the shared screen.

Because calls are a peer-to-peer mesh, the presenter uploads one copy per viewer. `applyScreenQuality` therefore splits a ~2.4 Mbit/s budget across viewers (and lowers frame rate/resolution for larger audiences). For large audiences an SFU (for example Cloudflare Realtime) would be the next step.

### Room state, host controls and the whiteboard (v3)

Every `presence` message now also carries `room: { hostId, locked, board: { open, drawers } }`, so clients never need extra requests to know who the host is or whether the room is locked.

- **Host**: the Worker passes `host_id` from D1 in the `x-host-id` header of each WebSocket upgrade; the Durable Object keeps it in `meta` and only that user may send `kick`, `lock`, `mute-request`, `hand-lower`, `board-open` and `board-clear` (others get `{type:"denied"}`). A host change (`POST /api/calls/:code/transfer` or leaving with `{transfer:true}`) updates D1 first and then tells the room through `POST /host`.
- **Kick / lock**: kicked ids are stored in `meta.banned` and refused (403) on both the REST join and the socket; a locked room refuses (423) anyone who has never been a member, so people who dropped can still come back.
- **Whiteboard**: strokes are flat integer arrays on a 1000×625 grid. Clients send fragments (≤ 400 numbers, ~20/s); the Durable Object validates colour/size/points, relays them to everybody else, trims the oldest strokes beyond 600 strokes / 60k numbers (announcing `board-remove`), and persists the board in ≤ 90 KB chunks (`board:0…n`). Late joiners receive one `board-sync`.
- **Raise hand / recording flag**: per-socket attachment fields (`hand` = timestamp that also orders the queue, `rec`), published in `presence`.

### Client structure (v3)

`CallRoom.tsx` orchestrates; behaviour lives in `lib/` (`mesh`, `board`, `recorder`, `prefs`, `sounds`, `quality`, `devices`) and in small components (`Lobby`, `PeoplePanel`, `SettingsSheet`, `Whiteboard`). Joining as a listener (no microphone) uses a `recvonly` audio transceiver that is upgraded to `sendrecv` when a microphone becomes available, without reconnecting. Per-person volume uses `HTMLMediaElement.volume`/`muted`; the speaker choice uses `setSinkId` where available. Recording mixes the microphone and all remote streams through one `MediaStreamAudioDestinationNode` into a `MediaRecorder`.

### Live user channel (v4)

`UserHub` is a second Durable Object class, one instance per user (`idFromName(userId)`). The browser opens `/ws/user` (cookie-authenticated, same-origin check) and keeps it alive with the same `ping`/`pong` auto-response as call rooms. When something changes for a user, the Worker calls `notifyUser(env, userId, "incoming" | "friends")` after the database write; the hub forwards `{type:"event", event}` to every open tab (max 8). Nothing is stored and no data travels over the channel: pages simply re-run their normal API request (`useLiveRefresh` in `lib/userChannel.ts`). While the channel is connected the old 1.5 s polling is replaced by a 12 s safety net; if it drops, the fast polling returns automatically and the channel reconnects with back-off.

Triggers: friend request / accept / remove, quick call invite, and the new in-call invite (`POST /api/calls/:code/invite`, stored as `call_invites.kind = 'join'`; declining such an invite never ends the running call).

### Room extras (v4)

- **Share mode**: `meta.shareMode` (`all` | `host`). Switching to `host` stops everybody else's screen share (`screen-stopped`) and refuses new ones (`denied`).
- **Timer**: `meta.timer` stores an absolute end time server-side but is published as `remainingMs`; each client counts down on its own monotonic clock, so wrong device clocks do not matter.
- **Poll**: one poll at a time in `meta.poll`; votes are keyed by user id, each recipient gets counts plus only their own `myVote`.
- **Captions**: `caption` messages are relayed (never stored) and limited to 8 per second per speaker. Recognition runs in the speaker's browser (`SpeechRecognition`) and is paused while the microphone is muted.
- **Screen sound**: the presenter announces the id of the screen `MediaStream` with a `screen-info` signal that always precedes the offer carrying it, so viewers can tell tab sound from the presenter's voice.

### Rate limiting

`rateLimit(env, key, limit, windowMs)` keeps fixed-window counters in the `rate_limits` D1 table with one `INSERT … ON CONFLICT … RETURNING`. Keys: login per account+network (12 / 10 min) and per network (80 / 10 min), register per network (12 / hour), search per user (90 / min), friend requests (40 / hour), call creation and invites. It fails open if the database errors.

### Emoji, reactions and the "lite" stylesheet (v5)

`lite.css` deliberately disables **every** CSS animation (`animation: none !important`) to keep calls cheap next to a game. Anything that must move therefore uses the Web Animations API instead (`ReactionBurst` calls `element.animate()`), which that rule cannot cancel.

- **Pack**: `src/lib/animatedEmoji.json` lists 48 emoji with their Noto file codes. `scripts/fetch-animated-emoji.mjs` (run by `npm run build` / `dev`, or alone with `npm run emoji:fetch`) downloads `…/notoemoji/latest/<code>/512.webp` into `public/emoji/<code>.webp`, resizing to 256 px when `sharp` is installed. Existing files are kept; failures only warn (`EMOJI_STRICT=1` makes them fatal).
- **Runtime fallback chain** (`AnimatedEmoji`): `/emoji/<code>.webp` → Google CDN → plain system emoji. Failures are remembered per emoji, `prefers-reduced-motion` and the "animated emoji" setting skip images entirely, and the system glyph is shown while an image loads.
- **Reactions**: the Durable Object accepts only strings containing an `Extended_Pictographic` character (≤ 16 UTF-16 units), limits each person to 6 per second and broadcasts `{type:"reaction", emoji, from, uid}`; the client renders the burst on that person's tile.
- **Chat**: messages carry `reactions: { emoji: userId[] }` (toggle with `chat-react`, ≤ 8 kinds per message, stored with the message); `typing` is relayed with the sender's name and rate-limited to one "typing" per 800 ms. Emoji-only messages (1–3 grapheme clusters, via `Intl.Segmenter`) render as large animated stickers.

## Durable Object choice

Each call code maps to one Durable Object name. This makes a call's state strongly consistent and isolated from unrelated calls. The Durable Object enforces the shared 20-participant room limit before accepting a WebSocket.

The implementation uses the Durable Object WebSocket Hibernation API so idle call rooms can hibernate while keeping client WebSocket connections alive.

## Persistent data

D1 tables:

- `users`
- `sessions`
- `friendships`
- `calls`
- `call_invites`

Short-lived call state belongs in the Call Durable Object. Chat is kept to the latest 100 messages in DO storage for continuity after an in-memory eviction.

## Interface performance budget

The UI is deliberately "lite": it is meant to stay open in a background window
while the user plays a heavy game and talks with friends. The rules are enforced
in `src/lite.css`, the last stylesheet in the cascade.

- **No infinite CSS animations.** The only looping CSS animation left is the
  loading spinner (`.spinner`, `.tiny-spinner`). Everything else — auroras,
  sparks, orbiting avatars, pulsing rings, halo spins, light sweeps,
  `float`/`pulse` loops — is disabled with a single global rule.
- **One deliberate exception: the «مخصوص» palette.** Its colours drift slowly
  through `src/lib/specialPalette.ts`, a single timer (~1.6 updates/s) that
  rewrites four CSS variables on `<html>`. It is skipped while the tab is
  hidden, disabled under `prefers-reduced-motion`, and removed when another
  palette is chosen.
- **No `backdrop-filter`, `filter: blur()` or `mix-blend-mode`** on interface
  surfaces, overlays, toolbars, drawers or dialogs. Panels use opaque gradients
  so text contrast does not depend on a blur pass.
- **No per-frame JavaScript.** The old `onMouseMove` spotlight handlers are gone.
- **Static scene.** `src/components/Scene.tsx` renders one element painted with a
  pre-composited gradient (`lite.css` section 3).
- **Lazy portraits.** `AvatarImage` renders a real `<img loading="lazy">` inside
  the circular frame, so a 45-portrait gallery does not load 45 files up front.
- **Static artwork instead of motion.** The home hero and the calls page use two
  designed images from `image/site/` (copied to `public/site/` by
  `scripts/build-avatars.mjs`).

Layout rules that come with it: bottom navigation + bottom-sheet chat on phones,
`env(safe-area-inset-*)` padding for notched devices, and 44px+ tap targets.

## Appearance and themes

The color palette is a browser preference (separate from light/dark mode), not
account data. `src/lib/theme.ts` defines the eleven palettes in three groups
(special, cheerful, classic) and `src/theme.css` maps each to the same set of
tokens: four "house lights" (`primary`, `secondary`, `tertiary`, `warm`), their
bright variants, the button gradient and `--theme-ink`. `--theme-ink` is a
darker accent used for text on light backgrounds so cheerful yellows stay
readable in light mode.

The selected palette is stored in local storage and applied on the document
root before the app renders (see the inline script in `index.html`), avoiding a
flash of the default colors. The default is **مخصوص** (Special), which blends
violet, aqua, rose and gold and drifts slowly while keeping status colors
(online, mute, accept/decline) semantically recognizable.
