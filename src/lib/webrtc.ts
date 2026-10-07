export async function applyAudioQuality(pc: RTCPeerConnection, quality: number) {
  const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
  if (!sender) return;
  try {
    const params = sender.getParameters();
    const enc = params.encodings?.[0] ?? {};
    const bitrate = Math.round(12000 + (quality / 100) * 84000);
    enc.maxBitrate = bitrate;
    enc.priority = quality < 35 ? "low" : quality > 75 ? "high" : "medium";
    params.encodings = [enc];
    await sender.setParameters(params);
  } catch {
    // Some browsers expose a read-only encoding configuration.
  }
}

export async function getIceServers(): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ];
  try {
    const res = await fetch("/api/webrtc/ice");
    if (!res.ok) return fallback;
    const data = await res.json();
    return Array.isArray(data.iceServers) && data.iceServers.length ? data.iceServers : fallback;
  } catch {
    return fallback;
  }
}
