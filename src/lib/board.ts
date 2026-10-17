/**
 * Shared whiteboard: data model, a tiny observable store and canvas drawing.
 *
 * Coordinates are integers on a fixed 1000 × 625 grid, so every screen draws
 * the same picture and a stroke is only a flat array of numbers
 * [x0, y0, x1, y1, …] (small enough to sync and to keep in Durable Object
 * storage). Stroke widths are in grid units too and scale with the canvas.
 */
export type Tool = "pen" | "highlight" | "eraser";

export type Stroke = { id: string; uid: string; tool: Tool; color: string; size: number; pts: number[] };

export type StrokeFragment = Stroke & { end?: boolean };

export const BOARD_W = 1000;
export const BOARD_H = 625;
export const BOARD_COLORS = ["#111827", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"] as const;
export const BOARD_SIZES = [3, 6, 12] as const;
/** A single stroke is cut after this many numbers (pairs × 2) and continues as a new stroke. */
export const STROKE_SPLIT_AT = 1_200;

export type BoardEvent = { type: "reset" } | { type: "append"; stroke: Stroke; from: number };

export class BoardStore {
  private strokes: Stroke[] = [];
  private index = new Map<string, Stroke>();
  private listeners = new Set<(event: BoardEvent) => void>();

  getStrokes(): readonly Stroke[] { return this.strokes; }

  subscribe(listener: (event: BoardEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: BoardEvent) { for (const listener of this.listeners) listener(event); }

  sync(strokes: Stroke[]) {
    this.strokes = strokes.map((stroke) => ({ ...stroke, pts: stroke.pts.slice() }));
    this.index = new Map(this.strokes.map((stroke) => [stroke.id, stroke]));
    this.emit({ type: "reset" });
  }

  /** Apply a (possibly partial) stroke coming from this or another client. */
  applyFragment(fragment: StrokeFragment) {
    let stroke = this.index.get(fragment.id);
    const from = stroke ? stroke.pts.length : 0;
    if (!stroke) {
      stroke = { id: fragment.id, uid: fragment.uid, tool: fragment.tool, color: fragment.color, size: fragment.size, pts: [] };
      this.strokes.push(stroke);
      this.index.set(stroke.id, stroke);
    }
    if (fragment.pts.length) stroke.pts.push(...fragment.pts);
    this.emit({ type: "append", stroke, from });
  }

  remove(id: string) {
    if (!this.index.has(id)) return;
    this.index.delete(id);
    this.strokes = this.strokes.filter((stroke) => stroke.id !== id);
    this.emit({ type: "reset" });
  }

  clear() {
    this.strokes = [];
    this.index.clear();
    this.emit({ type: "reset" });
  }

  lastStrokeOf(uid: string): Stroke | undefined {
    for (let i = this.strokes.length - 1; i >= 0; i--) if (this.strokes[i].uid === uid) return this.strokes[i];
    return undefined;
  }
}

function strokeStyle(context: CanvasRenderingContext2D, stroke: Stroke, scale: number) {
  context.lineCap = "round";
  context.lineJoin = "round";
  if (stroke.tool === "eraser") {
    context.globalCompositeOperation = "destination-out";
    context.globalAlpha = 1;
    context.strokeStyle = "#000";
    context.fillStyle = "#000";
    context.lineWidth = Math.max(1, stroke.size * 4 * scale);
  } else if (stroke.tool === "highlight") {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 0.35;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = Math.max(1, stroke.size * 3 * scale);
  } else {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = Math.max(1, stroke.size * scale);
  }
}

/** Draw a stroke, optionally only the part appended after `fromNumber` (an index into pts). */
export function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, canvasWidth: number, fromNumber = 0) {
  const scale = canvasWidth / BOARD_W;
  const pts = stroke.pts;
  if (pts.length < 2) return;
  context.save();
  strokeStyle(context, stroke, scale);
  if (pts.length === 2) {
    context.beginPath();
    context.arc(pts[0] * scale, pts[1] * scale, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  const start = Math.max(0, fromNumber - 2);
  context.beginPath();
  context.moveTo(pts[start] * scale, pts[start + 1] * scale);
  for (let i = start + 2; i + 1 < pts.length; i += 2) context.lineTo(pts[i] * scale, pts[i + 1] * scale);
  context.stroke();
  context.restore();
}

export function redrawBoard(context: CanvasRenderingContext2D, strokes: readonly Stroke[], canvasWidth: number, canvasHeight: number) {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  for (const stroke of strokes) drawStroke(context, stroke, canvasWidth);
}

/** Render the board on a white background and return a PNG. */
export async function exportBoardPng(strokes: readonly Stroke[], width = 1600): Promise<Blob | null> {
  const height = Math.round(width * (BOARD_H / BOARD_W));
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const layerContext = layer.getContext("2d");
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const outContext = out.getContext("2d");
  if (!layerContext || !outContext) return null;
  redrawBoard(layerContext, strokes, width, height);
  outContext.fillStyle = "#ffffff";
  outContext.fillRect(0, 0, width, height);
  outContext.drawImage(layer, 0, 0);
  return new Promise((resolve) => out.toBlob((blob) => resolve(blob), "image/png"));
}
