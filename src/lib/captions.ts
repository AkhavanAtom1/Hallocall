/**
 * Live captions of your own speech, using the browser's built-in speech
 * recognition (Chrome/Edge/Safari). Recognised text is relayed to the others
 * by the call room; nothing is stored on the server.
 *
 * Note: in Chrome the audio is processed by the browser vendor's speech
 * service, and recognition uses the browser's default microphone.
 */
type RecognitionEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function captionsSupported() {
  return recognitionConstructor() !== null;
}

export const CAPTION_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "fa-IR", label: "فارسی" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "ar-SA", label: "العربية" },
  { code: "tr-TR", label: "Türkçe" },
  { code: "de-DE", label: "Deutsch" },
  { code: "fr-FR", label: "Français" },
  { code: "es-ES", label: "Español" },
  { code: "ru-RU", label: "Русский" },
  { code: "hi-IN", label: "हिन्दी" },
];

export type CaptionerState = "listening" | "stopped" | "blocked";

export class Captioner {
  private recognition: Recognition | null = null;
  private wanted = false;
  private restartTimer: number | null = null;
  private quickEnds = 0;
  private lastStart = 0;

  constructor(
    private lang: string,
    private readonly onText: (text: string, final: boolean) => void,
    private readonly onState: (state: CaptionerState) => void = () => {},
  ) {}

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.begin();
  }

  stop() {
    this.wanted = false;
    if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      try { recognition.abort(); } catch { /* already stopped */ }
    }
    this.onState("stopped");
  }

  setLang(lang: string) {
    if (lang === this.lang) return;
    this.lang = lang;
    if (this.wanted) { this.stop(); this.start(); }
  }

  private schedule() {
    if (!this.wanted || this.restartTimer !== null) return;
    /* Recognition ends by itself after silence; restart quickly, but slow down if it keeps ending at once. */
    const delay = Math.min(5000, 250 * 2 ** Math.min(this.quickEnds, 4));
    this.restartTimer = window.setTimeout(() => { this.restartTimer = null; this.begin(); }, delay);
  }

  private begin() {
    const Ctor = recognitionConstructor();
    if (!this.wanted || !Ctor || this.recognition) return;
    const recognition = new Ctor();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = (result[0]?.transcript ?? "").trim();
        if (text) this.onText(text, !!result.isFinal);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.wanted = false;
        this.onState("blocked");
      }
    };
    recognition.onend = () => {
      this.recognition = null;
      this.quickEnds = Date.now() - this.lastStart < 1500 ? this.quickEnds + 1 : 0;
      this.schedule();
    };
    this.recognition = recognition;
    this.lastStart = Date.now();
    try {
      recognition.start();
      this.onState("listening");
    } catch {
      this.recognition = null;
      this.quickEnds += 1;
      this.schedule();
    }
  }
}
