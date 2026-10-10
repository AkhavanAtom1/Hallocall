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
