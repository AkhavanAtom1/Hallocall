export const AUDIO_MIN_BITRATE = 12_000;
export const AUDIO_MAX_BITRATE = 96_000;

/** Maps the quality control (0–100) to a sender-side Opus bitrate ceiling. */
export function audioBitrateForQuality(quality: number) {
  const normalized = Math.min(100, Math.max(0, Number.isFinite(quality) ? quality : 50));
  return Math.round(AUDIO_MIN_BITRATE + (normalized / 100) * (AUDIO_MAX_BITRATE - AUDIO_MIN_BITRATE));
}

/**
 * Apply a maximum outgoing audio bitrate to every audio sender in a peer.
 * The control is intentionally best-effort: unsupported browsers keep the
 * negotiated codec defaults and the call itself remains unaffected.
 */
export async function applyAudioQuality(pc: RTCPeerConnection, quality: number): Promise<boolean> {
  const senders = pc.getSenders().filter((sender) => sender.track?.kind === "audio");
  if (!senders.length) return false;

  const maxBitrate = audioBitrateForQuality(quality);
  const results = await Promise.all(senders.map(async (sender) => {
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) return false;

      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = maxBitrate;
        if ("priority" in encoding) {
          encoding.priority = quality < 35 ? "low" : quality > 75 ? "high" : "medium";
        }
      }

      await sender.setParameters(parameters);
      return true;
    } catch {
      // A few browser engines lock sender parameters after negotiation.
      return false;
    }
  }));

  return results.every(Boolean);
}

/** Total upload budget (bits/s) for one screen share. Calls are a peer-to-peer
 * mesh, so the presenter uploads one copy per viewer: the budget is split. */
export const SCREEN_TOTAL_BUDGET = 2_400_000;
export const SCREEN_MIN_BITRATE = 250_000;
export const SCREEN_MAX_BITRATE = 2_500_000;

export function screenBitrateForPeers(peerCount: number) {
  const viewers = Math.max(1, Math.floor(peerCount) || 1);
  return Math.round(Math.min(SCREEN_MAX_BITRATE, Math.max(SCREEN_MIN_BITRATE, SCREEN_TOTAL_BUDGET / viewers)));
}

/**
 * Cap the screen-share video sender. Best-effort like the audio control:
 * browsers reject parameter changes before the first negotiation finishes, in
 * which case the caller simply retries after the connection is stable.
 */
export async function applyScreenQuality(sender: RTCRtpSender, peerCount: number): Promise<boolean> {
  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) return false;
    const maxBitrate = screenBitrateForPeers(peerCount);
    for (const encoding of parameters.encodings) {
      encoding.maxBitrate = maxBitrate;
      encoding.maxFramerate = peerCount > 6 ? 8 : peerCount > 3 ? 12 : 20;
      if (peerCount > 8) encoding.scaleResolutionDownBy = 2;
      else if (peerCount > 4) encoding.scaleResolutionDownBy = 1.5;
      else encoding.scaleResolutionDownBy = 1;
    }
    // Slides/text must stay readable: drop frames before dropping resolution.
    (parameters as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "maintain-resolution";
    await sender.setParameters(parameters);
    return true;
  } catch {
    return false;
  }
}

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== "object") return false;
  const server = value as { urls?: unknown; username?: unknown; credential?: unknown };
  const validUrls = typeof server.urls === "string"
    ? server.urls.trim().length > 0
    : Array.isArray(server.urls) && server.urls.length > 0 && server.urls.every((url) => typeof url === "string" && url.trim());
  return validUrls &&
    (server.username === undefined || typeof server.username === "string") &&
    (server.credential === undefined || typeof server.credential === "string");
}

export async function getIceServers(): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ];

  try {
    const res = await fetch("/api/webrtc/ice", { credentials: "include" });
    if (!res.ok) return fallback;
    const data: unknown = await res.json();
    if (!data || typeof data !== "object" || !("iceServers" in data)) return fallback;

    const servers = (data as { iceServers?: unknown }).iceServers;
    if (!Array.isArray(servers)) return fallback;
    const validServers = servers.filter(isIceServer);
    return validServers.length ? validServers : fallback;
  } catch {
    return fallback;
  }
}
