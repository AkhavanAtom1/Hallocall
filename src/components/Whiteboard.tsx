import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { BOARD_COLORS, BOARD_H, BOARD_SIZES, BOARD_W, BoardStore, STROKE_SPLIT_AT, drawStroke, exportBoardPng, redrawBoard } from "../lib/board";
import type { StrokeFragment, Tool } from "../lib/board";
import { Icon } from "./Icon";

const TOOLS: Array<{ id: Tool; label: string; icon: string }> = [
  { id: "pen", label: "قلم", icon: "pen" },
  { id: "highlight", label: "هایلایت", icon: "highlighter" },
  { id: "eraser", label: "پاک‌کن", icon: "eraser" },
];

const SEND_EVERY_MS = 50;
const MIN_STEP = 1.2;

function newStrokeId(selfId: string) {
  return `${selfId.slice(0, 6)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

type Props = {
  store: BoardStore;
  selfId: string;
  isHost: boolean;
  /** False when the host limited drawing to themself. */
  canDraw: boolean;
  drawers: "all" | "host";
  sharedOpen: boolean;
  onFragment: (fragment: StrokeFragment) => void;
  onUndo: () => void;
  onClear: () => void;
  onClose: () => void;
  onShareOpen: (open: boolean) => void;
  onDrawers: (drawers: "all" | "host") => void;
};

/** Shared whiteboard: everyone sees strokes live; late joiners get the full board. */
export function Whiteboard(props: Props) {
  const { store, selfId, isHost, canDraw } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(BOARD_COLORS[0]);
  const [size, setSize] = useState<number>(BOARD_SIZES[1]);
  const drawing = useRef<{ id: string; pending: number[]; total: number; last: [number, number]; pointerId: number } | null>(null);
  const sendTimer = useRef<number | null>(null);
  const toolRef = useRef({ tool, color, size });
  toolRef.current = { tool, color, size };
  const propsRef = useRef(props);
  propsRef.current = props;

  const paintAll = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    redrawBoard(context, store.getStrokes(), canvas.width, canvas.height);
  }, [store]);

  /* Keep the bitmap sharp on any screen and redraw after every resize. */
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(200, Math.round((canvas.clientWidth || wrap.clientWidth) * ratio));
      const height = Math.round(width * (BOARD_H / BOARD_W));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      paintAll();
    };
    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(wrap);
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    return () => { observer?.disconnect(); window.removeEventListener("resize", resize); };
  }, [paintAll]);

  /* Live updates from this client and from everyone else. Pens and erasers are
     drawn incrementally; a translucent highlighter would darken at every joint
     if drawn piecewise, so it is repainted once per frame instead. */
  useEffect(() => {
    let frame = 0;
    const repaint = () => { frame = 0; paintAll(); };
    const unsubscribe = store.subscribe((event) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      if (event.type === "reset" || (event.stroke.tool === "highlight" && event.from > 0)) {
        if (!frame) frame = window.requestAnimationFrame(repaint);
      } else {
        drawStroke(context, event.stroke, canvas.width, event.from);
      }
    });
    return () => { unsubscribe(); if (frame) window.cancelAnimationFrame(frame); };
  }, [store, paintAll]);

  const flush = useCallback((end: boolean) => {
    const current = drawing.current;
    if (sendTimer.current !== null) { window.clearTimeout(sendTimer.current); sendTimer.current = null; }
    if (!current) return;
    const { tool: t, color: c, size: s } = toolRef.current;
    if (!current.pending.length && !end) return;
    const pts = current.pending.slice();
    current.pending = [];
    propsRef.current.onFragment({ id: current.id, uid: selfId, tool: t, color: c, size: s, pts, end });
  }, [selfId]);

  const scheduleFlush = useCallback(() => {
    if (sendTimer.current !== null) return;
    sendTimer.current = window.setTimeout(() => { sendTimer.current = null; flush(false); }, SEND_EVERY_MS);
  }, [flush]);

  const toGrid = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * BOARD_W;
    const y = ((event.clientY - rect.top) / rect.height) * BOARD_H;
    return [Math.max(0, Math.min(BOARD_W, Math.round(x))), Math.max(0, Math.min(BOARD_H, Math.round(y)))];
  };

  const addPoint = (x: number, y: number, first = false) => {
    const current = drawing.current;
    if (!current) return;
    if (!first) {
      const dx = x - current.last[0];
      const dy = y - current.last[1];
      if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return;
    }
    current.last = [x, y];
    current.pending.push(x, y);
    current.total += 2;
    const { tool: t, color: c, size: s } = toolRef.current;
    store.applyFragment({ id: current.id, uid: selfId, tool: t, color: c, size: s, pts: [x, y] });
    if (current.total >= STROKE_SPLIT_AT) {
      /* Very long lines are cut so no single stroke grows without bound. */
      flush(true);
      current.id = newStrokeId(selfId);
      current.total = 0;
      current.pending = [];
      current.pending.push(x, y);
      current.total = 2;
      store.applyFragment({ id: current.id, uid: selfId, tool: t, color: c, size: s, pts: [x, y] });
    }
    scheduleFlush();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || drawing.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    const [x, y] = toGrid(event);
    drawing.current = { id: newStrokeId(selfId), pending: [], total: 0, last: [x, y], pointerId: event.pointerId };
    addPoint(x, y, true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const native = event.nativeEvent as PointerEvent;
    const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    if (samples.length) for (const sample of samples) { const [x, y] = toGrid(sample); addPoint(x, y); }
    else { const [x, y] = toGrid(event); addPoint(x, y); }
  };

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const [x, y] = toGrid(event);
    addPoint(x, y);
    flush(true);
    drawing.current = null;
  };

  useEffect(() => () => {
    if (sendTimer.current !== null) window.clearTimeout(sendTimer.current);
    if (drawing.current) flush(true);
  }, [flush]);

  const download = async () => {
    const blob = await exportBoardPng(store.getStrokes());
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    link.href = url;
    link.download = `hallocall-board-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const undo = () => {
    const last = store.lastStrokeOf(selfId);
    if (last) store.remove(last.id);
    props.onUndo();
  };

  const clear = () => {
    if (!window.confirm("همهٔ تخته برای همه پاک شود؟")) return;
    store.clear();
    props.onClear();
  };

  return (
    <section className="board-panel glass" role="dialog" aria-label="تخته سفید مشترک">
      <div className="board-bar">
        <div className="board-tools" role="group" aria-label="ابزار نقاشی">
          {TOOLS.map((item) => (
            <button key={item.id} type="button" className={tool === item.id ? "board-btn on" : "board-btn"} aria-pressed={tool === item.id} title={item.label} aria-label={item.label} onClick={() => setTool(item.id)} disabled={!canDraw}>
              <Icon name={item.icon} size={17} />
            </button>
          ))}
        </div>
        <div className="board-colors" role="group" aria-label="رنگ">
          {BOARD_COLORS.map((swatch) => (
            <button key={swatch} type="button" className={color === swatch && tool !== "eraser" ? "swatch on" : "swatch"} style={{ background: swatch }} aria-label={`رنگ ${swatch}`} aria-pressed={color === swatch} disabled={!canDraw || tool === "eraser"} onClick={() => setColor(swatch)} />
          ))}
        </div>
        <div className="board-sizes" role="group" aria-label="ضخامت">
          {BOARD_SIZES.map((value) => (
            <button key={value} type="button" className={size === value ? "board-btn on" : "board-btn"} aria-pressed={size === value} aria-label={`ضخامت ${value}`} disabled={!canDraw} onClick={() => setSize(value)}>
              <i style={{ width: 4 + value, height: 4 + value }} />
            </button>
          ))}
        </div>
        <div className="board-actions">
          <button type="button" className="board-btn" onClick={undo} disabled={!canDraw} title="برگرداندن آخرین خط من" aria-label="برگرداندن"><Icon name="undo" size={17} /></button>
          <button type="button" className="board-btn" onClick={() => void download()} title="ذخیره به‌صورت تصویر" aria-label="ذخیره تصویر"><Icon name="download" size={17} /></button>
          {isHost && <button type="button" className="board-btn danger" onClick={clear} title="پاک‌کردن همه" aria-label="پاک‌کردن همه"><Icon name="trash" size={17} /></button>}
          <button type="button" className="board-btn" onClick={props.onClose} title="بستن تخته (فقط برای خودت)" aria-label="بستن تخته"><Icon name="x" size={17} /></button>
        </div>
      </div>

      {isHost && (
        <div className="board-host">
          <label className="switch-row"><input type="checkbox" checked={props.sharedOpen} onChange={(event) => props.onShareOpen(event.target.checked)} /><span>نمایش تخته برای همه</span></label>
          <label className="switch-row"><input type="checkbox" checked={props.drawers === "host"} onChange={(event) => props.onDrawers(event.target.checked ? "host" : "all")} /><span>فقط من بکشم</span></label>
        </div>
      )}
      {!canDraw && <p className="board-note">میزبان نقاشی روی تخته را فقط برای خودش باز گذاشته است؛ تو می‌توانی ببینی.</p>}

      <div className="board-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={canDraw ? "board-canvas" : "board-canvas readonly"}
          role="img"
          aria-label="بوم تخته سفید"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      </div>
    </section>
  );
}
