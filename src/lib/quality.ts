/** Connection quality of one participant, shown as 0–3 signal bars. */
export type QualityLevel = 0 | 1 | 2 | 3;

export type QualitySample = {
  connected: boolean;
  rttMs?: number | null;
  lossPct?: number | null;
  jitterMs?: number | null;
};

export type PeerQuality = { level: QualityLevel; rttMs: number | null; lossPct: number | null; jitterMs: number | null };

export const QUALITY_LABELS: Record<QualityLevel, string> = { 0: "قطع", 1: "ضعیف", 2: "متوسط", 3: "خوب" };

export function qualityLevel(sample: QualitySample): QualityLevel {
  if (!sample.connected) return 0;
  const rtt = sample.rttMs ?? 0;
  const loss = sample.lossPct ?? 0;
  const jitter = sample.jitterMs ?? 0;
  if (rtt > 400 || loss > 12 || jitter > 80) return 1;
  if (rtt > 220 || loss > 5 || jitter > 45) return 2;
  return 3;
}

/** Worst level among the given peers (what "my connection" feels like). */
export function worstLevel(levels: QualityLevel[]): QualityLevel | null {
  if (!levels.length) return null;
  return levels.reduce((worst, level) => (level < worst ? level : worst), 3 as QualityLevel);
}
