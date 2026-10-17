/**
 * Local call recording: mixes the microphone and every remote voice into one
 * audio track and records it in the browser. Nothing is uploaded; the file is
 * saved on the recorder's own device. (Everyone in the call is told while a
 * recording is running — see the `rec` flag in the presence list.)
 */
type AnyAudioContext = AudioContext;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof window !== "undefined" && !!(window.AudioContext || (window as Window & { webkitAudioContext?: unknown }).webkitAudioContext);
}

export function pickRecordingMime(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function recordingFileName(code: string, when: Date, mime: string) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}_${pad(when.getHours())}${pad(when.getMinutes())}`;
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  return `hallocall-${code}-${stamp}.${ext}`;
}

export class CallRecorder {
  private readonly context: AnyAudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly sources = new Map<string, MediaStreamAudioSourceNode>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  startedAt = 0;
  mimeType = "";

  constructor(context: AnyAudioContext) {
    this.context = context;
    this.destination = context.createMediaStreamDestination();
  }

  get recording() {
    return !!this.recorder && this.recorder.state === "recording";
  }

  /** Add (or replace) one voice in the mix. Safe to call before or during recording. */
  addStream(key: string, stream: MediaStream) {
    this.removeStream(key);
    if (!stream.getAudioTracks().length) return;
    try {
      const source = this.context.createMediaStreamSource(stream);
      source.connect(this.destination);
      this.sources.set(key, source);
    } catch {
      /* a stream that is already ended cannot be mixed; skip it */
    }
  }

  removeStream(key: string) {
    const source = this.sources.get(key);
    if (!source) return;
    try { source.disconnect(); } catch {}
    this.sources.delete(key);
  }

  start() {
    if (this.recording) return;
    this.mimeType = pickRecordingMime();
    this.chunks = [];
    const options: MediaRecorderOptions = this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 96_000 } : {};
    const recorder = new MediaRecorder(this.destination.stream, options);
    recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) this.chunks.push(event.data); };
    this.recorder = recorder;
    this.startedAt = Date.now();
    recorder.start(1000);
  }

  stop(): Promise<{ blob: Blob; durationMs: number; mimeType: string }> {
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve({ blob: new Blob([], { type: this.mimeType }), durationMs: 0, mimeType: this.mimeType });
    return new Promise((resolve) => {
      const finish = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || "audio/webm" });
        const result = { blob, durationMs: Date.now() - this.startedAt, mimeType: this.mimeType || "audio/webm" };
        this.chunks = [];
        this.recorder = null;
        resolve(result);
      };
      if (recorder.state === "inactive") { finish(); return; }
      recorder.onstop = finish;
      try { recorder.stop(); } catch { finish(); }
    });
  }

  dispose() {
    for (const key of Array.from(this.sources.keys())) this.removeStream(key);
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      try { this.recorder.stop(); } catch {}
    }
    this.recorder = null;
    this.chunks = [];
  }
}
