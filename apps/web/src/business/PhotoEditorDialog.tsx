import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';
import { Button, Dialog, Segmented, Spinner } from '@/design/components';
import { Icon } from '@/design/Icon';
import { makeStudioPhoto, warmUpStudioPhoto, type StudioProgress } from '@/lib/studioPhoto';
import { prepareSelection, removeArea, selectObjectAt, warmUpRemoval } from '@/lib/removeObjects';
import { easeProgress } from '@/lib/onDeviceAi';
import { MAX_ANGLE, MAX_ZOOM, NO_EDIT, autoLight, clampPan, cssFilter, cssTransform, isUnchanged, renderEdit, warmthTint, type PhotoEdit } from '@/lib/photoEdit';

type Tab = 'crop' | 'light' | 'remove';
type Studio = { state: 'idle' } | { state: 'working'; progress: StudioProgress } | { state: 'done' } | { state: 'failed'; reason: string };
type Dims = { w: number; h: number };

/**
 * Product photo editor. The studio background is one prominent button under the photo; the tabs
 * crop (drag/pinch the photo itself, turn, straighten), light, and remove (tap an object or brush
 * an area, then erase it). Everything previews live and runs on the device; only Save renders the
 * 1200 px square and hands it back.
 */
export function PhotoEditorDialog({ source, onDone }: { source: Blob; onDone: (edited: File | null) => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('crop');
  const [work, setWork] = useState<Blob>(source);
  const workUrl = useMemo(() => URL.createObjectURL(work), [work]);
  const originalUrl = useMemo(() => URL.createObjectURL(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(workUrl), [workUrl]);
  useEffect(() => () => URL.revokeObjectURL(originalUrl), [originalUrl]);
  const [dims, setDims] = useState<Dims | null>(null);
  const [edit, setEdit] = useState<PhotoEdit>(NO_EDIT);
  const [studio, setStudio] = useState<Studio>({ state: 'idle' });
  const [beforeStudio, setBeforeStudio] = useState<Blob | null>(null);
  const [undo, setUndo] = useState<Blob[]>([]); // photos before each removal
  const [removing, setRemoving] = useState<number | null>(null); // eased % while erasing
  const [peek, setPeek] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null); // remove-mode controls render here
  // The chosen tool and brush stay put across removals: cleaning a photo often takes several passes.
  const [eraseMode, setEraseMode] = useState<Mode>('tap');
  const [brush, setBrush] = useState<Brush>('m');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const update = (patch: Partial<PhotoEdit>) => setEdit((e) => (dims ? clampPan({ ...e, ...patch }, dims.w, dims.h) : { ...e, ...patch }));
  const replaceWork = (next: Blob, resetCrop: boolean) => { setWork(next); setDims(null); if (resetCrop) setEdit(NO_EDIT); };
  const changed = !isUnchanged(edit) || work !== source;
  const busy = saving || studio.state === 'working' || removing !== null;

  const runStudio = () => {
    setError(null);
    const from = work;
    setStudio({ state: 'working', progress: { pct: 0, stage: 'prepare' } });
    makeStudioPhoto(from, (p) => { if (alive.current) setStudio({ state: 'working', progress: p }); })
      .then((res) => {
        if (!alive.current) return;
        setBeforeStudio(from);
        replaceWork(res.blob, true); // the studio frame is already square and centred on the dish
        setStudio({ state: 'done' });
      })
      .catch((e) => {
        console.warn('studio background failed', e);
        if (alive.current) setStudio({ state: 'failed', reason: e instanceof Error ? e.message : String(e) });
      });
  };
  const removeStudio = () => {
    if (beforeStudio) replaceWork(beforeStudio, true);
    setBeforeStudio(null);
    setStudio({ state: 'idle' });
  };

  const erase = async (mask: Uint8Array, w: number, h: number) => {
    setError(null);
    setRemoving(0);
    const stop = easeProgress(0, 95, 6000, (v) => { if (alive.current) setRemoving(Math.round(v)); });
    try {
      const next = await removeArea(work, mask, w, h);
      if (!alive.current) return false;
      setUndo((u) => [...u, work]);
      replaceWork(next, false); // same size: the crop stays
      prepareSelection(next);
      return true;
    } catch (e) {
      console.warn('object removal failed', e);
      if (alive.current) setError(`${t('edit.removeFailed')} ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      stop();
      if (alive.current) setRemoving(null);
    }
  };
  const undoRemoval = () => {
    const prev = undo.at(-1);
    if (!prev) return;
    setUndo((u) => u.slice(0, -1));
    replaceWork(prev, false);
    prepareSelection(prev);
  };

  const resetAll = () => {
    setWork(source); setDims(null); setEdit(NO_EDIT); setUndo([]); setBeforeStudio(null); setStudio({ state: 'idle' });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = await renderEdit(work, edit);
      onDone(new File([blob], `photo.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type }));
    } catch (e) {
      setError(`${t('edit.saveFailed')} ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={t('edit.title')}
      onClose={() => { if (!saving) onDone(null); }}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => onDone(null)}>{t('common.cancel')}</Button>
          <Button loading={saving} disabled={!changed || busy || !dims} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="ped">
        {tab === 'remove' && !peek ? (
          <EraseFrame url={workUrl} work={work} dims={dims} onDims={setDims} busy={busy} removing={removing} onErase={erase} panel={panel} canUndo={undo.length > 0} onUndo={undoRemoval} mode={eraseMode} onMode={setEraseMode} brush={brush} onBrush={setBrush} />
        ) : (
          <Frame
            url={peek ? originalUrl : workUrl}
            raw={peek}
            dims={dims}
            onDims={setDims}
            edit={edit}
            onEdit={update}
            interactive={tab === 'crop' && !busy && !peek}
            progress={studio.state === 'working' ? studio.progress.pct : null}
          />
        )}

        <StudioButton studio={studio} disabled={saving || removing !== null} onRun={runStudio} onRemove={removeStudio} />

        <div className="ped__bar">
          <button
            type="button"
            className="ped__peek"
            disabled={!changed || busy}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setPeek(true); }}
            onPointerUp={() => setPeek(false)}
            onPointerCancel={() => setPeek(false)}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setPeek(true); }}
            onKeyUp={() => setPeek(false)}
            onBlur={() => setPeek(false)}
          >
            <Icon name="eye" size={16} />
            {t('edit.compare')}
          </button>
          {changed && !busy ? (
            <button type="button" className="ped__reset" onClick={resetAll}>
              <Icon name="refresh" size={16} />
              {t('edit.resetAll')}
            </button>
          ) : null}
        </div>

        <Segmented<Tab>
          label={t('edit.title')}
          value={tab}
          onChange={(v) => { setTab(v); if (v === 'remove') prepareSelection(work); }}
          stacked
          options={[
            { value: 'crop', label: t('edit.tab.crop'), icon: 'grid' },
            { value: 'light', label: t('edit.tab.light'), icon: 'sun' },
            { value: 'remove', label: t('edit.tab.remove'), icon: 'trash' },
          ]}
        />

        <div className="ped__panel" ref={setPanel}>
          {tab === 'crop' ? (
            <>
              <Slider label={t('edit.zoom')} min={1} max={MAX_ZOOM} step={0.01} value={edit.zoom} format={(v) => `${v.toFixed(1)}×`} onChange={(zoom) => update({ zoom })} disabled={busy} />
              <Slider label={t('edit.straighten')} min={-MAX_ANGLE} max={MAX_ANGLE} step={0.5} value={edit.angle} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`} onChange={(angle) => update({ angle })} centered disabled={busy} />
              <div className="ped__row">
                <Button variant="secondary" size="sm" icon="refresh" disabled={busy} onClick={() => update({ turns: (edit.turns + 1) % 4, x: 0, y: 0 })}>{t('edit.rotate')}</Button>
              </div>
            </>
          ) : null}
          {tab === 'light' ? (
            <>
              <div className="ped__row">
                <Button variant="secondary" size="sm" icon="sun" disabled={busy} onClick={() => void autoLight(work).then((l) => update(l))}>{t('edit.auto')}</Button>
              </div>
              <Slider label={t('edit.brightness')} min={-1} max={1} step={0.05} value={edit.brightness} format={signed} onChange={(brightness) => update({ brightness })} centered disabled={busy} />
              <Slider label={t('edit.warmth')} min={-1} max={1} step={0.05} value={edit.warmth} format={signed} onChange={(warmth) => update({ warmth })} centered disabled={busy} />
              <Slider label={t('edit.saturation')} min={-1} max={1} step={0.05} value={edit.saturation} format={signed} onChange={(saturation) => update({ saturation })} centered disabled={busy} />
            </>
          ) : null}
        </div>
        {error ? <p className="ped__error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}

const signed = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`);

/** The studio background, kept in plain sight under the photo in every tab. */
function StudioButton({ studio, disabled, onRun, onRemove }: { studio: Studio; disabled: boolean; onRun: () => void; onRemove: () => void }) {
  const t = useT();
  if (studio.state === 'done') {
    return (
      <div className="ped-studio ped-studio--on">
        <span className="ped-studio__label"><Icon name="check" size={18} />{t('studio.title')}</span>
        <button type="button" className="ped-studio__off" disabled={disabled} onClick={onRemove}>{t('edit.studioRemove')}</button>
      </div>
    );
  }
  if (studio.state === 'working') {
    const { pct, stage } = studio.progress;
    return (
      <div className="ped-studio ped-studio--working" style={{ '--pct': `${pct}%` } as CSSProperties} role="status" aria-live="polite">
        <span className="ped-studio__label"><Icon name="sun" size={18} />{t('studio.title')}</span>
        <span className="ped-studio__meta">{t(`studio.stage.${stage}`)} · {pct}%</span>
      </div>
    );
  }
  return (
    <div className="ped-studio__wrap">
      <button type="button" className="ped-studio ped-studio--go" disabled={disabled} onClick={onRun} onPointerEnter={warmUpStudioPhoto} onFocus={warmUpStudioPhoto}>
        <span className="ped-studio__label"><Icon name="sun" size={18} />{t('studio.title')}</span>
      </button>
      {studio.state === 'failed' ? (
        <p className="studio-status" role="alert">
          <span>{t('studio.failed')}</span>
          <small className="studio-status__why">{studio.reason.slice(0, 160)}</small>
        </p>
      ) : null}
    </div>
  );
}

/** The square preview; in crop mode it is the control: drag to move, pinch or wheel to zoom. */
function Frame({ url, raw, dims, onDims, edit, onEdit, interactive, progress }: {
  url: string; raw: boolean; dims: Dims | null; onDims: (d: Dims) => void;
  edit: PhotoEdit; onEdit: (patch: Partial<PhotoEdit>) => void; interactive: boolean; progress: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const size = useWidth(box);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  // Latest values for the native wheel listener (React's onWheel is passive and cannot preventDefault).
  const live = useRef({ edit, onEdit, interactive });
  useEffect(() => { live.current = { edit, onEdit, interactive }; });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!live.current.interactive) return;
      e.preventDefault();
      live.current.onEdit({ zoom: Math.min(MAX_ZOOM, Math.max(1, live.current.edit.zoom * Math.exp(-e.deltaY * 0.0015))) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const tint = warmthTint(edit);
  const ready = dims && size;
  return (
    <div
      ref={box}
      className={`ped__frame${interactive ? ' ped__frame--crop' : ''}${dragging ? ' is-dragging' : ''}`}
      style={progress === null ? undefined : ({ '--p': progress / 100 } as CSSProperties)}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        setDragging(true);
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: edit.zoom };
        }
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!interactive || !prev || !size) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size >= 2 && pinch.current) {
          const [a, b] = [...pointers.current.values()];
          const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          onEdit({ zoom: Math.min(MAX_ZOOM, Math.max(1, pinch.current.zoom * (dist / pinch.current.dist))) });
        } else {
          onEdit({ x: edit.x + (e.clientX - prev.x) / size, y: edit.y + (e.clientY - prev.y) / size });
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) setDragging(false);
      }}
      onPointerCancel={(e) => { pointers.current.delete(e.pointerId); pinch.current = null; if (pointers.current.size === 0) setDragging(false); }}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        className={raw ? 'ped__raw' : 'ped__img'}
        onLoad={(e) => { if (!raw) onDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); }}
        style={raw || !ready ? undefined : { transform: cssTransform(edit, dims.w, dims.h, size), filter: cssFilter(edit) }}
      />
      {!raw && edit.warmth !== 0 ? <div className="ped__tint" style={{ background: tint.color, opacity: tint.opacity }} aria-hidden="true" /> : null}
      {interactive ? <div className="ped__grid" aria-hidden="true" /> : null}
      {progress !== null ? (
        <>
          <div className="studio-work__light" aria-hidden="true" />
          <span className="studio-work__pct" aria-hidden="true">{progress}%</span>
        </>
      ) : null}
    </div>
  );
}

const BRUSHES = { s: 0.035, m: 0.07, l: 0.12 } as const; // brush diameter as a share of the frame
type Brush = keyof typeof BRUSHES;
type Mode = 'tap' | 'brush';

/**
 * Remove mode: the whole photo (not the crop) with a marking layer on top. Tap selects the object
 * under the finger; the brush paints an area. "Remove" erases everything marked.
 */
function EraseFrame({ url, work, dims, onDims, busy, removing, onErase, panel, canUndo, onUndo, mode, onMode, brush, onBrush }: {
  url: string; work: Blob; dims: Dims | null; onDims: (d: Dims) => void; busy: boolean; removing: number | null;
  onErase: (mask: Uint8Array, w: number, h: number) => Promise<boolean>;
  /** Where the marking controls render (the editor's panel under the tabs). */
  panel: HTMLElement | null; canUndo: boolean; onUndo: () => void;
  mode: Mode; onMode: (m: Mode) => void; brush: Brush; onBrush: (b: Brush) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLCanvasElement>(null);
  const size = useWidth(box);
  const [marked, setMarked] = useState(false);
  // Load the removal model only once something is marked, so it does not compete with the selection model.
  useEffect(() => { if (marked) warmUpRemoval(); }, [marked]);
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);
  const stroke = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  // Where the photo sits inside the square (contain).
  const fit = dims && size ? (() => { const s = Math.min(size / dims.w, size / dims.h); return { s, w: dims.w * s, h: dims.h * s, x: (size - dims.w * s) / 2, y: (size - dims.h * s) / 2 }; })() : null;
  // A new photo (after a removal or undo) starts with no marks; the tool and brush stay as they were.
  useEffect(() => {
    const c = marks.current;
    if (!c || !dims) return;
    c.width = dims.w;
    c.height = dims.h;
    setMarked(false);
  }, [dims, url]);

  const toImage = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (clientX - r.left - fit!.x) / fit!.s, y: (clientY - r.top - fit!.y) / fit!.s };
  };
  const paint = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = marks.current!.getContext('2d')!;
    ctx.strokeStyle = ctx.fillStyle = '#d6453f';
    ctx.lineWidth = (BRUSHES[brush] * size) / fit!.s;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    setMarked(true);
  };
  const tapSelect = async (p: { x: number; y: number }) => {
    if (!dims || p.x < 0 || p.y < 0 || p.x >= dims.w || p.y >= dims.h) return;
    setSelecting(true);
    setSelectError(null);
    try {
      const { mask, width, height } = await selectObjectAt(work, p.x, p.y);
      const c = marks.current!;
      const ctx = c.getContext('2d')!;
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const sx = width / c.width, sy = height / c.height;
      let any = false;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (!mask[Math.floor(y * sy) * width + Math.floor(x * sx)]) continue;
          const i = (y * c.width + x) * 4;
          img.data[i] = 214; img.data[i + 1] = 69; img.data[i + 2] = 63; img.data[i + 3] = 255;
          any = true;
        }
      }
      ctx.putImageData(img, 0, 0);
      if (any) setMarked(true);
    } catch (e) {
      console.warn('object selection failed', e);
      setSelectError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(false);
    }
  };
  const clear = () => { const c = marks.current; c?.getContext('2d')!.clearRect(0, 0, c.width, c.height); setMarked(false); };
  const eraseMarked = async () => {
    const c = marks.current;
    if (!c) return;
    const a = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const mask = new Uint8Array(c.width * c.height);
    for (let i = 0; i < mask.length; i++) mask[i] = a[i * 4 + 3]! > 32 ? 1 : 0;
    if (await onErase(mask, c.width, c.height)) setMarked(false);
  };

  const locked = busy || selecting;
  return (
    <>
      <div
        ref={box}
        className={`ped__frame ped__frame--erase ped__frame--${mode}`}
        style={removing === null ? undefined : ({ '--p': removing / 100 } as CSSProperties)}
        onPointerDown={(e) => {
          if (locked || !fit) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = toImage(e.clientX, e.clientY);
          stroke.current = { id: e.pointerId, ...p, moved: false };
          if (mode === 'brush') paint(p, p);
        }}
        onPointerMove={(e) => {
          const s = stroke.current;
          if (!s || s.id !== e.pointerId || locked || !fit) return;
          const p = toImage(e.clientX, e.clientY);
          if (Math.hypot(p.x - s.x, p.y - s.y) * fit.s > 4) s.moved = true;
          if (mode === 'brush') { paint(s, p); stroke.current = { ...s, ...p }; }
        }}
        onPointerUp={(e) => {
          const s = stroke.current;
          stroke.current = null;
          if (!s || s.id !== e.pointerId || !fit) return;
          if (mode === 'tap' && !s.moved) void tapSelect(toImage(e.clientX, e.clientY));
        }}
        onPointerCancel={() => { stroke.current = null; }}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          className="ped__fit"
          onLoad={(e) => onDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={fit ? { left: fit.x, top: fit.y, width: fit.w, height: fit.h } : { visibility: 'hidden' }}
        />
        <canvas ref={marks} className="ped__marks" style={fit ? { left: fit.x, top: fit.y, width: fit.w, height: fit.h } : undefined} aria-hidden="true" />
        {selecting ? <span className="ped__busy"><Spinner size={22} />{t('edit.selecting')}</span> : null}
        {removing !== null ? (
          <>
            <div className="studio-work__light" aria-hidden="true" />
            <span className="studio-work__pct" aria-hidden="true">{removing}%</span>
          </>
        ) : null}
      </div>
      {panel ? createPortal(
        <div className="ped-erase">
          <Segmented<Mode>
            label={t('edit.tab.remove')}
            value={mode}
            onChange={onMode}
            options={[{ value: 'tap', label: t('edit.selectTap') }, { value: 'brush', label: t('edit.brush') }]}
          />
          {mode === 'brush' ? (
            <div className="ped-erase__sizes" role="radiogroup" aria-label={t('edit.brushSize')}>
              {(Object.keys(BRUSHES) as Brush[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={brush === k} aria-label={`${t('edit.brushSize')} ${k}`} className="ped-erase__size" onClick={() => onBrush(k)}>
                  <i style={{ inlineSize: `${8 + Object.keys(BRUSHES).indexOf(k) * 7}px`, blockSize: `${8 + Object.keys(BRUSHES).indexOf(k) * 7}px` }} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="ped__row ped__row--spread">
            <span className="ped__row">
              <Button variant="secondary" size="sm" disabled={!marked || locked} onClick={clear}>{t('edit.clearMarks')}</Button>
              <Button variant="ghost" size="sm" icon="refresh" disabled={!canUndo || locked} onClick={onUndo}>{t('edit.undo')}</Button>
            </span>
            <Button size="sm" icon="trash" disabled={!marked || locked} onClick={() => void eraseMarked()}>{t('edit.removeMarked')}</Button>
          </div>
          {selectError ? <p className="ped__error" role="alert">{t('edit.selectFailed')} <small>{selectError.slice(0, 160)}</small></p> : null}
        </div>,
        panel,
      ) : null}
    </>
  );
}

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Slider({ label, min, max, step, value, onChange, format, centered, disabled }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
  format: (v: number) => ReactNode; centered?: boolean; disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const zero = centered ? ((0 - min) / (max - min)) * 100 : 0;
  return (
    <label className={`ped-slider${centered ? ' ped-slider--centered' : ''}`}>
      <span className="ped-slider__head">
        <span>{label}</span>
        <output>{format(value)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(centered ? 0 : min)}
        style={{ '--from': `${Math.min(zero, pct)}%`, '--to': `${Math.max(zero, pct)}%` } as CSSProperties}
      />
    </label>
  );
}
