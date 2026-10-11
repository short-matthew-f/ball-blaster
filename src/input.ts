// Pointer input -> internal canvas coordinates, routed to the active handler.
import { VIEW_W, VIEW_H } from './core/types';

export interface PointerHandler {
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  cancel?(): void;
}

export function attachInput(canvas: HTMLCanvasElement, getHandler: () => PointerHandler, onFirstGesture: () => void): void {
  let active: number | null = null;
  const pos = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * VIEW_W) / r.width, ((e.clientY - r.top) * VIEW_H) / r.height];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onFirstGesture();
    if (active !== null) return;
    active = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const [x, y] = pos(e);
    getHandler().down(x, y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== active) return;
    e.preventDefault();
    const [x, y] = pos(e);
    getHandler().move(x, y);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== active) return;
    e.preventDefault();
    active = null;
    const [x, y] = pos(e);
    getHandler().up(x, y);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== active) return;
    active = null;
    getHandler().cancel?.();
  });
  for (const ev of ['touchstart', 'touchmove', 'gesturestart', 'contextmenu', 'dblclick']) {
    document.addEventListener(ev, (e) => { if (!(e.target as Element | null)?.closest?.('#overlay')) e.preventDefault(); }, { passive: false });
  }
  window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
}
