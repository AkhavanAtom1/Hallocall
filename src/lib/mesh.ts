import { applyAudioQuality, applyScreenQuality } from "./webrtc";
import { qualityLevel } from "./quality";
import type { PeerQuality } from "./quality";

/**
 * CallMesh — all WebRTC peer handling for one call.
 *
 * Why this exists (bugs it fixes):
 *  1. A participant that dropped and re-entered kept an OLD RTCPeerConnection
 *     on the other side. The new session could never negotiate with it, so the
 *     person looked connected but nobody could hear them. Peers are now bound
 *     to the remote *page session* (`sid`); a new session always gets a fresh
 *     connection and stale signals from an old session are dropped.
 *  2. A connection that went `disconnected` / `failed` (Wi-Fi ↔ mobile data
 *     switch, sleeping laptop, …) was never repaired. We now run ICE restarts
 *     with back-off and a watchdog for connections that never come up.
 *  3. Renegotiation (needed for screen share) uses the "perfect negotiation"
 *     pattern, so simultaneous offers can never wedge a connection.
 *  4. Signals that arrive from someone who is not in the participant list are
 *     dropped instead of creating phantom "Friend" participants.
 */

export type SignalPayload = {
  kind: "offer" | "answer" | "ice";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  /** Sender's page-session id. */
  sid?: string;
  /** Page-session id of the intended recipient, when the sender knows it. */
  toSid?: string;
};

export type MeshPeerInfo = { id: string; sid?: string };

export type MeshOptions = {
  selfId: string;
  sid: string;
  getIceServers: () => Promise<RTCIceServer[]>;
  sendSignal: (to: string, payload: SignalPayload) => boolean;
  onPeerState: (id: string, connected: boolean) => void;
  onRemoteAudio: (id: string, stream: MediaStream) => void;
  onRemoteScreen: (id: string, stream: MediaStream | null) => void;
  onPeerClosed: (id: string) => void;
  /** Connection quality of one peer (bars in the people list). Optional. */
  onPeerQuality?: (id: string, quality: PeerQuality) => void;
  /** Repeated, unrecoverable failures: the host component should do a full re-join. */
  onFatal?: () => void;
  /** Test seam. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
};

type Entry = {
  id: string;
  remoteSid: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  forceIceRestart: boolean;
  pending: RTCIceCandidateInit[];
  audioSender: RTCRtpSender | null;
  /** Set when we joined without a microphone (receive-only) so it can be upgraded later. */
  audioTransceiver: RTCRtpTransceiver | null;
  screenSender: RTCRtpSender | null;
  chain: Promise<void>;
  closed: boolean;
  /** A remote offer/answer has been applied at least once. */
  remoteApplied: boolean;
  /** Polite side already waited once before sending its first offer. */
  initialDeferred: boolean;
  everHealthy: boolean;
  restartCount: number;
  unhealthySince: number;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setInterval> | null;
  statsTimer: ReturnType<typeof setInterval> | null;
  prevLost: number;
  prevReceived: number;
  lastQualitySig: string;
  negotiate: () => Promise<void>;
};

const MAX_PENDING_CANDIDATES = 120;
const EARLY_SIGNAL_LIMIT = 60;
const EARLY_SIGNAL_TTL_MS = 8_000;
const ICE_CACHE_MS = 10 * 60_000;
const DISCONNECT_GRACE_MS = 2_500;
const WATCHDOG_INTERVAL_MS = 2_000;
const FIRST_CONNECT_LIMIT_MS = 9_000;
const REPEAT_RECOVER_LIMIT_MS = 12_000;
const MAX_RESTARTS_BEFORE_FATAL = 6;
const POLITE_INITIAL_DELAY_MS = 350;
const STATS_INTERVAL_MS = 3_000;

export class CallMesh {
  sid: string;
  private readonly opts: MeshOptions;
  private readonly peers = new Map<string, Entry>();
  private readonly creating = new Map<string, { gen: number; sid: string; promise: Promise<Entry | null> }>();
  private known = new Map<string, string>();
  private early: Array<{ from: string; payload: SignalPayload; at: number }> = [];
  private generation = 0;
  private destroyed = false;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private quality = 50;
  private iceCache: { at: number; servers: Promise<RTCIceServer[]> } | null = null;
  private fatalNotified = false;

  constructor(options: MeshOptions) {
    this.opts = options;
    this.sid = options.sid;
  }

  /* ───────────────────────── public API ───────────────────────── */

  setSid(sid: string) { this.sid = sid; }

  setLocalAudio(stream: MediaStream | null) {
    this.localStream = stream;
  }

  /** Swap the microphone track on every connection without renegotiating. */
  async replaceAudioTrack(track: MediaStreamTrack) {
    await Promise.all(Array.from(this.peers.values()).map(async (entry) => {
      if (!entry.audioSender) return;
      try { await entry.audioSender.replaceTrack(track); } catch { /* peer will recover via restart */ }
      /* Joined listen-only and a microphone just became available: start sending. */
      const transceiver = entry.audioTransceiver;
      if (transceiver && transceiver.direction === "recvonly") {
        try { transceiver.direction = "sendrecv"; } catch { /* negotiation retries */ }
      }
    }));
  }

  setQuality(quality: number) {
    this.quality = quality;
    for (const entry of this.peers.values()) void applyAudioQuality(entry.pc, quality);
  }

  /** Reconcile with the server's participant list. */
  syncPeers(list: MeshPeerInfo[]) {
    if (this.destroyed) return;
    const next = new Map<string, string>();
    for (const participant of list) {
      if (participant.id !== this.opts.selfId) next.set(participant.id, participant.sid ?? "");
    }
    for (const id of Array.from(this.peers.keys())) {
      if (!next.has(id)) this.closePeer(id);
    }
    for (const id of Array.from(this.creating.keys())) {
      if (!next.has(id)) this.creating.delete(id);
    }
    this.known = next;
    for (const [id, sid] of next) void this.ensurePeer({ id, sid });
    this.flushEarly();
    this.tuneScreenAll();
  }

  handleSignal(from: string, payload: SignalPayload) {
    if (this.destroyed || !payload || typeof payload !== "object") return;
    if (payload.toSid && payload.toSid !== this.sid) return; // meant for our previous session
    if (!this.known.has(from)) {
      this.bufferEarly(from, payload);
      return;
    }
    const expectedSid = this.known.get(from) ?? "";
    const messageSid = payload.sid ?? "";
    if (expectedSid && messageSid && messageSid !== expectedSid) return; // stale session of that user
    void this.ensurePeer({ id: from, sid: expectedSid || messageSid }).then((entry) => {
      if (!entry) return;
      entry.chain = entry.chain.then(() => this.processSignal(entry, payload)).catch(() => {});
    });
  }

  startScreen(stream: MediaStream) {
    this.screenStream = stream;
    for (const entry of this.peers.values()) this.attachScreen(entry);
  }

  stopScreen() {
    this.screenStream = null;
    for (const entry of this.peers.values()) {
      if (!entry.screenSender) continue;
      try { entry.pc.removeTrack(entry.screenSender); } catch { /* already gone */ }
      entry.screenSender = null;
    }
  }

  isConnected(id: string) {
    const entry = this.peers.get(id);
    return !!entry && this.isHealthy(entry);
  }

  closeAll() {
    for (const id of Array.from(this.peers.keys())) this.closePeer(id);
    this.creating.clear();
    this.known = new Map();
    this.early = [];
  }

  destroy() {
    this.destroyed = true;
    this.closeAll();
  }

  /* ───────────────────────── peer lifecycle ───────────────────────── */

  private iceServers() {
    const now = Date.now();
    if (!this.iceCache || now - this.iceCache.at > ICE_CACHE_MS) {
      this.iceCache = { at: now, servers: this.opts.getIceServers() };
    }
    return this.iceCache.servers;
  }

  private ensurePeer(info: { id: string; sid: string }): Promise<Entry | null> {
    if (this.destroyed) return Promise.resolve(null);
    const sid = info.sid ?? "";
    const existing = this.peers.get(info.id);
    if (existing && !existing.closed && existing.remoteSid === sid) return Promise.resolve(existing);
    const pending = this.creating.get(info.id);
    if (pending && pending.sid === sid) return pending.promise;
    if (existing) this.closePeer(info.id);

    const gen = ++this.generation;
    const promise = (async (): Promise<Entry | null> => {
      let servers: RTCIceServer[];
      try { servers = await this.iceServers(); } catch { servers = []; }
      if (this.destroyed || this.creating.get(info.id)?.gen !== gen) return null;
      if (!this.known.has(info.id) || this.known.get(info.id) !== sid) return null;
      const stale = this.peers.get(info.id);
      if (stale) this.closePeer(info.id);
      const entry = this.buildEntry(info.id, sid, servers);
      this.peers.set(info.id, entry);
      return entry;
    })().finally(() => {
      if (this.creating.get(info.id)?.gen === gen) this.creating.delete(info.id);
    });
    this.creating.set(info.id, { gen, sid, promise });
    return promise;
  }

  private buildEntry(id: string, remoteSid: string, iceServers: RTCIceServer[]): Entry {
    const config: RTCConfiguration = { iceServers };
    const pc = this.opts.createPeerConnection ? this.opts.createPeerConnection(config) : new RTCPeerConnection(config);
    const entry: Entry = {
      id,
      remoteSid,
      pc,
      polite: this.opts.selfId > id,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      forceIceRestart: false,
      pending: [],
      audioSender: null,
      audioTransceiver: null,
      screenSender: null,
      chain: Promise.resolve(),
      closed: false,
      remoteApplied: false,
      initialDeferred: false,
      everHealthy: false,
      restartCount: 0,
      unhealthySince: Date.now(),
      disconnectTimer: null,
      watchdog: null,
      statsTimer: null,
      prevLost: 0,
      prevReceived: 0,
      lastQualitySig: "",
      negotiate: async () => {},
    };

    entry.negotiate = async () => {
      if (entry.closed) return;
      try {
        entry.makingOffer = true;
        const restart = entry.forceIceRestart;
        entry.forceIceRestart = false;
        const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined);
        if (entry.closed || pc.signalingState !== "stable") return;
        await pc.setLocalDescription(offer);
        const local = pc.localDescription;
        if (local) this.signal(entry, { kind: "offer", sdp: { type: local.type, sdp: local.sdp } });
      } catch {
        /* a later negotiationneeded / restart will retry */
      } finally {
        entry.makingOffer = false;
      }
    };

    const audioTracks = this.localStream?.getAudioTracks() ?? [];
    for (const track of audioTracks) {
      try { entry.audioSender = pc.addTrack(track, this.localStream as MediaStream); } catch { /* ignore */ }
    }
    if (!audioTracks.length) {
      /* No microphone (denied / listen-only): still receive everyone's audio. */
      try {
        entry.audioTransceiver = pc.addTransceiver("audio", { direction: "recvonly" });
        entry.audioSender = entry.audioTransceiver.sender;
      } catch { /* very old browsers: they cannot join listen-only */ }
    }
    this.attachScreen(entry);

    pc.onnegotiationneeded = () => {
      /* Both sides add their microphone at the same moment, so both would send
         an offer at once ("glare"). The impolite side goes first; the polite
         side waits briefly for that offer and only sends its own if none came.
         Perfect negotiation resolves a collision anyway — this just avoids it. */
      if (entry.polite && !entry.remoteApplied && !entry.initialDeferred) {
        entry.initialDeferred = true;
        setTimeout(() => { if (!entry.closed && !entry.remoteApplied) void entry.negotiate(); }, POLITE_INITIAL_DELAY_MS);
        return;
      }
      void entry.negotiate();
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) this.signal(entry, { kind: "ice", candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => this.evaluate(entry);
    pc.oniceconnectionstatechange = () => this.evaluate(entry);
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === "stable") {
        void applyAudioQuality(pc, this.quality);
        this.tuneScreen(entry);
      }
    };
    pc.ontrack = (event) => {
      if (entry.closed) return;
      const track = event.track;
      const stream = event.streams[0] ?? new MediaStream([track]);
      if (track.kind === "audio") this.opts.onRemoteAudio(id, stream);
      else if (track.kind === "video") this.opts.onRemoteScreen(id, stream);
    };

    entry.watchdog = setInterval(() => this.watch(entry), WATCHDOG_INTERVAL_MS);
    if (this.opts.onPeerQuality) entry.statsTimer = setInterval(() => { void this.pollStats(entry); }, STATS_INTERVAL_MS);
    this.opts.onPeerState(id, false);
    return entry;
  }

  private closePeer(id: string) {
    const entry = this.peers.get(id);
    this.creating.delete(id);
    if (!entry) return;
    entry.closed = true;
    this.peers.delete(id);
    if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
    if (entry.watchdog) clearInterval(entry.watchdog);
    if (entry.statsTimer) clearInterval(entry.statsTimer);
    const pc = entry.pc;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    pc.ontrack = null;
    try { pc.close(); } catch { /* already closed */ }
    this.opts.onRemoteScreen(id, null);
    this.opts.onPeerClosed(id);
  }

  /* ───────────────────────── signaling ───────────────────────── */

  private signal(entry: Entry, payload: Omit<SignalPayload, "sid" | "toSid">) {
    this.opts.sendSignal(entry.id, { ...payload, sid: this.sid, toSid: entry.remoteSid || undefined });
  }

  private bufferEarly(from: string, payload: SignalPayload) {
    const now = Date.now();
    this.early = this.early.filter((item) => now - item.at < EARLY_SIGNAL_TTL_MS);
    if (this.early.length >= EARLY_SIGNAL_LIMIT) this.early.shift();
    this.early.push({ from, payload, at: now });
  }

  private flushEarly() {
    if (!this.early.length) return;
    const now = Date.now();
    const waiting = this.early;
    this.early = [];
    for (const item of waiting) {
      if (now - item.at >= EARLY_SIGNAL_TTL_MS) continue;
      if (this.known.has(item.from)) this.handleSignal(item.from, item.payload);
      else this.early.push(item);
    }
  }

  private async processSignal(entry: Entry, payload: SignalPayload) {
    if (entry.closed) return;
    const pc = entry.pc;
    try {
      if (payload.kind === "offer" || payload.kind === "answer") {
        const description = payload.sdp;
        if (!description) return;
        const readyForOffer = !entry.makingOffer && (pc.signalingState === "stable" || entry.settingRemoteAnswer);
        const offerCollision = description.type === "offer" && !readyForOffer;
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;

        entry.settingRemoteAnswer = description.type === "answer";
        try {
          if (offerCollision && pc.signalingState === "have-local-offer") {
            await pc.setLocalDescription({ type: "rollback" });
          }
          await pc.setRemoteDescription(description);
        } finally {
          entry.settingRemoteAnswer = false;
        }
        entry.remoteApplied = true;
        await this.flushCandidates(entry);

        if (description.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          const local = pc.localDescription;
          if (local) this.signal(entry, { kind: "answer", sdp: { type: local.type, sdp: local.sdp } });
        }
      } else if (payload.kind === "ice" && payload.candidate) {
        if (!pc.remoteDescription) {
          if (entry.pending.length < MAX_PENDING_CANDIDATES) entry.pending.push(payload.candidate);
        } else {
          await pc.addIceCandidate(payload.candidate).catch(() => {});
        }
      }
    } catch {
      /* stale / out-of-order packet: the next negotiation repairs it */
    }
  }

  private async flushCandidates(entry: Entry) {
    const queued = entry.pending;
    entry.pending = [];
    for (const candidate of queued) await entry.pc.addIceCandidate(candidate).catch(() => {});
  }

  /* ───────────────────────── health & recovery ───────────────────────── */

  private isHealthy(entry: Entry) {
    const pc = entry.pc;
    return pc.connectionState === "connected" ||
      pc.iceConnectionState === "connected" ||
      pc.iceConnectionState === "completed";
  }

  private evaluate(entry: Entry) {
    if (entry.closed) return;
    const pc = entry.pc;
    if (this.isHealthy(entry)) {
      if (entry.disconnectTimer) { clearTimeout(entry.disconnectTimer); entry.disconnectTimer = null; }
      entry.everHealthy = true;
      entry.restartCount = 0;
      entry.unhealthySince = 0;
      this.fatalNotified = false;
      this.opts.onPeerState(entry.id, true);
      void applyAudioQuality(pc, this.quality);
      this.tuneScreen(entry);
      return;
    }

    this.opts.onPeerState(entry.id, false);
    if (!entry.unhealthySince) entry.unhealthySince = Date.now();

    if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
      this.recover(entry);
    } else if (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected") {
      if (!entry.disconnectTimer) {
        entry.disconnectTimer = setTimeout(() => {
          entry.disconnectTimer = null;
          if (!entry.closed && !this.isHealthy(entry)) this.recover(entry);
        }, DISCONNECT_GRACE_MS);
      }
    }
  }

  private watch(entry: Entry) {
    if (entry.closed) return;
    if (this.isHealthy(entry)) { entry.unhealthySince = 0; return; }
    if (!entry.unhealthySince) entry.unhealthySince = Date.now();
    const limit = entry.everHealthy || entry.restartCount > 0 ? REPEAT_RECOVER_LIMIT_MS : FIRST_CONNECT_LIMIT_MS;
    if (Date.now() - entry.unhealthySince >= limit) {
      entry.unhealthySince = Date.now();
      this.recover(entry);
    }
  }

  private recover(entry: Entry) {
    if (entry.closed) return;
    entry.restartCount += 1;
    if (entry.restartCount > MAX_RESTARTS_BEFORE_FATAL) {
      if (!this.fatalNotified) {
        this.fatalNotified = true;
        this.opts.onFatal?.();
      }
      return;
    }
    const pc = entry.pc;
    try {
      if (typeof pc.restartIce === "function") {
        pc.restartIce(); // fires negotiationneeded; the next offer carries fresh ICE credentials
      } else {
        entry.forceIceRestart = true;
        void entry.negotiate();
      }
    } catch {
      entry.forceIceRestart = true;
      void entry.negotiate();
    }
  }

  /* ───────────────────────── connection quality ───────────────────────── */

  private async pollStats(entry: Entry) {
    if (entry.closed || !this.opts.onPeerQuality) return;
    const connected = this.isHealthy(entry);
    const measured = { rtt: null as number | null, jitter: null as number | null, loss: null as number | null };
    try {
      const report = await entry.pc.getStats();
      let lost = 0;
      let received = 0;
      let inbound = false;
      report.forEach((stat: Record<string, unknown>) => {
        if (stat.type === "candidate-pair" && (stat.nominated || stat.selected) && stat.state === "succeeded" && typeof stat.currentRoundTripTime === "number") {
          measured.rtt = stat.currentRoundTripTime * 1000;
        }
        if (stat.type === "inbound-rtp" && stat.kind === "audio") {
          inbound = true;
          lost += typeof stat.packetsLost === "number" ? stat.packetsLost : 0;
          received += typeof stat.packetsReceived === "number" ? stat.packetsReceived : 0;
          if (typeof stat.jitter === "number") measured.jitter = Math.max(measured.jitter ?? 0, stat.jitter * 1000);
        }
      });
      if (inbound) {
        const lostDelta = lost - entry.prevLost;
        const receivedDelta = received - entry.prevReceived;
        entry.prevLost = lost;
        entry.prevReceived = received;
        if (lostDelta + receivedDelta > 20) measured.loss = (Math.max(0, lostDelta) / (lostDelta + receivedDelta)) * 100;
      }
    } catch {
      /* stats are best-effort */
    }
    if (entry.closed) return;
    const level = qualityLevel({ connected, rttMs: measured.rtt, lossPct: measured.loss, jitterMs: measured.jitter });
    const signature = `${level}:${measured.rtt === null ? "-" : Math.round(measured.rtt / 40)}`;
    if (signature === entry.lastQualitySig) return;
    entry.lastQualitySig = signature;
    this.opts.onPeerQuality(entry.id, {
      level,
      rttMs: measured.rtt === null ? null : Math.round(measured.rtt),
      lossPct: measured.loss === null ? null : Math.round(measured.loss * 10) / 10,
      jitterMs: measured.jitter === null ? null : Math.round(measured.jitter),
    });
  }

  /* ───────────────────────── screen share ───────────────────────── */

  private attachScreen(entry: Entry) {
    const stream = this.screenStream;
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track || entry.screenSender || entry.closed) return;
    try {
      entry.screenSender = entry.pc.addTrack(track, stream);
    } catch {
      entry.screenSender = null;
    }
  }

  private tuneScreen(entry: Entry) {
    if (!entry.screenSender || entry.closed) return;
    void applyScreenQuality(entry.screenSender, this.peers.size);
  }

  private tuneScreenAll() {
    for (const entry of this.peers.values()) this.tuneScreen(entry);
  }
}
