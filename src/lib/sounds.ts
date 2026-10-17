/**
 * Tiny synthesized sound cues (no audio files, nothing to download).
 * One lazily created AudioContext lives for the whole page; browsers only let
 * it make noise after a user gesture, which is always true by the time a call
 * is joined or a ringtone is needed.
 */
export type SoundKind = "join" | "leave" | "hand" | "message" | "ring" | "test" | "rec" | "timer";

let shared: AudioContext | null = null;

export function getSoundContext(): AudioContext | null {
  try {
    if (shared && shared.state !== "closed") return shared;
    const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    shared = new Ctor();
    return shared;
  } catch {
    return null;
  }
}

const NOTES: Record<SoundKind, Array<[number, number]>> = {
  join: [[660, 0.09], [880, 0.12]],
  leave: [[660, 0.09], [440, 0.14]],
  hand: [[988, 0.08], [1319, 0.1]],
  message: [[740, 0.07]],
  ring: [[480, 0.18], [620, 0.22], [480, 0.18], [620, 0.22]],
  test: [[523, 0.14], [659, 0.14], [784, 0.2]],
  rec: [[880, 0.1], [880, 0.1]],
  timer: [[880, 0.14], [660, 0.14], [880, 0.14], [1175, 0.28]],
};

export function playSound(kind: SoundKind, volume = 0.16, sinkId?: string) {
  const context = getSoundContext();
  if (!context) return;
  try {
    if (context.state === "suspended") void context.resume().catch(() => {});
    if (sinkId && typeof (context as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId === "function") {
      void (context as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(sinkId).catch(() => {});
    }
    let at = context.currentTime + 0.01;
    for (const [frequency, duration] of NOTES[kind]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.02);
      at += duration * 0.9;
    }
  } catch {
    /* sound cues are decoration; never let them break a call */
  }
}
