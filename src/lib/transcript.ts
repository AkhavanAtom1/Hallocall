/** Plain-text export of a call: chat messages and live captions in time order. */
export type TranscriptEntry = { at: number; name: string; text: string; kind: "chat" | "speech" };

export function buildTranscript(options: { callName: string; code: string; entries: TranscriptEntry[]; generatedAt?: number }): string {
  const { callName, code, entries } = options;
  const when = new Date(options.generatedAt ?? Date.now());
  const clock = (at: number) => {
    const d = new Date(at);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const lines = [
    `HalloCall — ${callName}`,
    `Code: ${code}`,
    `Saved: ${when.toISOString()}`,
    "",
  ];
  for (const entry of sorted) {
    lines.push(`[${clock(entry.at)}] ${entry.name}${entry.kind === "speech" ? " (speech)" : ""}: ${entry.text}`);
  }
  if (!sorted.length) lines.push("(nothing to save yet)");
  return lines.join("\n") + "\n";
}

export function transcriptFileName(code: string, when: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `hallocall-${code}-${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}_${pad(when.getHours())}${pad(when.getMinutes())}.txt`;
}
