"use client";

import { type ReactNode, type CSSProperties, type PointerEvent, useRef, useState } from "react";
import type { Photo } from "./page";
import { outsideNotebook, resizeInNotebook } from "./notebook-geometry";

type Position = { photoId: string; x: number; y: number; angle: number };

export default function NotebookPreview({ photos, onSizeChange, imageStyle, children }: {
  photos: Photo[];
  onSizeChange: (id: string, width: number, height: number) => void;
  imageStyle: (photo: Photo) => CSSProperties;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [book, setBook] = useState({ width: 148, height: 210 });
  const [items, setItems] = useState<Position[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [addId, setAddId] = useState("");
  const [menu, setMenu] = useState<{ photoId: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<{ photoId: string; width: number; height: number } | null>(null);
  const drag = useRef<{ pointerId: number; mode: "move" | "resize"; startX: number; startY: number; pixelsPerMm: number; item: Position; photo: Photo; latestSize?: { width: number; height: number } } | null>(null);
  const visibleItems = items.filter((item) => photos.some((photo) => photo.id === item.photoId));
  const selected = photos.find((photo) => photo.id === selectedId);
  const position = visibleItems.find((item) => item.photoId === selectedId);

  function openPhoto(photoId: string) {
    if (!photos.some((photo) => photo.id === photoId)) return;
    setItems((current) => current.some((item) => item.photoId === photoId) ? current : [...current, { photoId, x: book.width / 2, y: book.height / 2, angle: 0 }]);
    setSelectedId(photoId);
    setMenu(null);
    if (!dialog.current?.open) dialog.current?.showModal();
  }

  function updatePosition(patch: Partial<Position>) {
    setItems((current) => current.map((item) => item.photoId === selectedId ? { ...item, ...patch } : item));
  }

  function beginDrag(event: PointerEvent<HTMLElement>, item: Position, photo: Photo, mode: "move" | "resize") {
    if (event.button !== 0 || !page.current) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(photo.id);
    drag.current = { pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, pixelsPerMm: page.current.getBoundingClientRect().width / book.width, item: { ...item }, photo };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = (event.clientX - current.startX) / current.pixelsPerMm;
    const dy = (event.clientY - current.startY) / current.pixelsPerMm;
    if (current.mode === "move") {
      setItems((previous) => previous.map((item) => item.photoId === current.photo.id ? { ...item, x: Math.max(0, Math.min(book.width, current.item.x + dx)), y: Math.max(0, Math.min(book.height, current.item.y + dy)) } : item));
    } else {
      // The resize handle moves relative to the photo centre, so the full size changes twice as fast.
      const size = resizeInNotebook(current.photo.widthMm, current.photo.heightMm, dx * 2, dy * 2, current.item.angle, current.photo.lockAspectRatio);
      current.latestSize = size;
      setDraft({ photoId: current.photo.id, ...size });
    }
  }

  function finishDrag(cancelled = false) {
    const current = drag.current;
    drag.current = null;
    setDraft(null);
    if (!current) return;
    if (cancelled) setItems((previous) => previous.map((item) => item.photoId === current.item.photoId ? current.item : item));
    else if (current.latestSize) onSizeChange(current.photo.id, current.latestSize.width, current.latestSize.height);
  }

  function changeSize(field: "widthMm" | "heightMm", value: number) {
    if (!selected || !Number.isFinite(value) || value < 10 || value > 400) return;
    const width = field === "widthMm" ? value : selected.lockAspectRatio ? value * selected.ratio : selected.widthMm;
    const height = field === "heightMm" ? value : selected.lockAspectRatio ? value / selected.ratio : selected.heightMm;
    onSizeChange(selected.id, width, height);
  }

  return <div onContextMenu={(event) => {
    if (!(event.target instanceof HTMLElement) || event.target.closest("dialog")) return;
    const photoId = event.target.closest<HTMLElement>("[data-photo-id]")?.dataset.photoId;
    if (!photoId) return;
    event.preventDefault();
    const bounds = event.target.getBoundingClientRect();
    setMenu({ photoId, x: Math.max(8, Math.min(event.clientX || bounds.left, window.innerWidth - 230)), y: Math.max(8, Math.min(event.clientY || bounds.top, window.innerHeight - 70)) });
  }} onClick={(event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const photoId = event.target.closest<HTMLElement>("[data-notebook-open]")?.dataset.notebookOpen;
    if (photoId) openPhoto(photoId);
    else if (!event.target.closest(".notebook-context-menu")) setMenu(null);
  }}>
    {children}
    {menu && <div className="notebook-context-menu" role="menu" aria-label="照片操作" style={{ left: menu.x, top: menu.y }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMenu(null); } }}>
      <button type="button" role="menuitem" autoFocus onClick={() => openPhoto(menu.photoId)}>在我的本子上预览</button>
    </div>}
    <dialog ref={dialog} className="notebook-dialog" aria-labelledby="notebook-title" onClose={() => finishDrag(true)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.target.blur(); }}>
      <header className="notebook-heading">
        <div><span className="eyebrow">贴进本子之前，先比一比</span><h2 id="notebook-title">在我的本子上预览</h2></div>
        <button type="button" aria-label="关闭本子预览" onClick={() => dialog.current?.close()}>×</button>
      </header>
      <p className="notebook-help">测量本子单页的宽和高。照片与页面按真实毫米比例显示；屏幕会缩放，并非实物 1:1。拖动照片摆放，拖右下角调整打印大小。</p>
      <div className="notebook-workspace">
        <aside className="notebook-controls">
          <h3>我的本子 · 单页尺寸</h3>
          <div className="notebook-presets">{[["A5", 148, 210], ["A6", 105, 148], ["A4", 210, 297]].map(([name, width, height]) => <button type="button" key={name} onClick={() => setBook({ width: Number(width), height: Number(height) })}>{name}</button>)}<button type="button" onClick={() => setBook({ width: book.height, height: book.width })}>横竖切换</button></div>
          <label>本子宽度（mm）<input type="number" min="50" max="600" key={`book-width-${book.width}`} defaultValue={book.width} onBlur={(event) => { const value = Number(event.target.value); if (value >= 50 && value <= 600) setBook({ ...book, width: value }); else event.target.value = String(book.width); }} /></label>
          <label>本子高度（mm）<input type="number" min="50" max="600" key={`book-height-${book.height}`} defaultValue={book.height} onBlur={(event) => { const value = Number(event.target.value); if (value >= 50 && value <= 600) setBook({ ...book, height: value }); else event.target.value = String(book.height); }} /></label>
          <small>例如 14.8 × 21 cm，输入 148 × 210 mm。</small>
          <label>添加照片<select value={addId || photos[0]?.id || ""} onChange={(event) => setAddId(event.target.value)}>{photos.map((photo, index) => <option key={photo.id} value={photo.id}>#{index + 1} · {photo.name}</option>)}</select></label>
          <button type="button" disabled={!photos.length} onClick={() => openPhoto(addId || photos[0]?.id || "")}>放到本子上</button>
          {selected && position && <fieldset><legend>选中照片</legend><strong className="notebook-photo-name">{selected.name}</strong>
            <label>照片宽度（mm）<input type="number" min="10" max="400" step="0.1" key={`${selected.id}-width-${selected.widthMm}`} defaultValue={selected.widthMm} onBlur={(event) => { changeSize("widthMm", Number(event.target.value)); event.target.value = String(selected.widthMm); }} /></label>
            <label>照片高度（mm）<input type="number" min="10" max="400" step="0.1" key={`${selected.id}-height-${selected.heightMm}`} defaultValue={selected.heightMm} onBlur={(event) => { changeSize("heightMm", Number(event.target.value)); event.target.value = String(selected.heightMm); }} /></label>
            <p>{selected.lockAspectRatio ? "保持照片比例" : "自由宽高"} · 修改尺寸同步到打印排版及 PDF，可在主页面撤销。</p>
            <label>摆放角度（°）<input type="number" min="-180" max="180" value={position.angle} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updatePosition({ angle: Math.max(-180, Math.min(180, value)) }); }} /></label>
            <div className="notebook-presets"><button type="button" onClick={() => updatePosition({ angle: ((position.angle + 270) % 360) - 180 })}>旋转 90°</button><button type="button" onClick={() => updatePosition({ x: book.width / 2, y: book.height / 2, angle: 0 })}>居中摆正</button></div>
            <p>照片 {Math.round(selected.widthMm) / 10} × {Math.round(selected.heightMm) / 10} cm · 面积约占单页 {Math.round(selected.widthMm * selected.heightMm / (book.width * book.height) * 100)}%</p>
            <button type="button" onClick={() => setItems((current) => current.filter((item) => item.photoId !== selectedId))}>从本子移除（保留打印照片）</button>
          </fieldset>}
        </aside>
        <section className="notebook-stage" aria-label="本子排版预览">
          <p className="notebook-ruler">{book.width} × {book.height} mm · 方格 10 × 10 mm</p>
          <div ref={page} className="notebook-page" style={{ width: `min(100%, ${book.width / book.height * 45}vh)`, aspectRatio: `${book.width} / ${book.height}`, backgroundSize: `${1000 / book.width}% ${1000 / book.height}%` }}>
            {visibleItems.map((item) => {
              const photo = photos.find((entry) => entry.id === item.photoId)!;
              const size = draft?.photoId === photo.id ? draft : { width: photo.widthMm, height: photo.heightMm };
              const outside = outsideNotebook(item.x, item.y, size.width, size.height, item.angle, book.width, book.height);
              const quarterTurn = photo.rotationTurns % 2 === 1;
              return <div key={photo.id} className={`notebook-photo ${selectedId === photo.id ? "is-active" : ""} ${outside ? "is-outside" : ""}`} role="button" tabIndex={0} aria-label={`摆放 ${photo.name}`} aria-pressed={selectedId === photo.id}
                style={{ left: `${item.x / book.width * 100}%`, top: `${item.y / book.height * 100}%`, width: `${size.width / book.width * 100}%`, height: `${size.height / book.height * 100}%`, transform: `translate(-50%, -50%) rotate(${item.angle}deg)` }}
                onPointerDown={(event) => beginDrag(event, item, photo, "move")} onPointerMove={moveDrag} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)}
                onKeyDown={(event) => { setSelectedId(photo.id); const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]; if (direction) { event.preventDefault(); setItems((current) => current.map((entry) => entry.photoId === photo.id ? { ...entry, x: Math.max(0, Math.min(book.width, entry.x + direction[0])), y: Math.max(0, Math.min(book.height, entry.y + direction[1])) } : entry)); } }}>
                <div className="notebook-photo-crop"><div role="img" aria-label={photo.name} style={{ ...imageStyle(photo), position: "absolute", left: "50%", top: "50%", width: quarterTurn ? `${size.height / size.width * 100}%` : "100%", height: quarterTurn ? `${size.width / size.height * 100}%` : "100%", transform: `translate(-50%, -50%) rotate(${photo.rotationTurns * 90}deg)` }} /></div>
                {selectedId === photo.id && <><span className="notebook-size-label">{size.width} × {size.height} mm{outside ? " · 超出本子" : ""}</span><button type="button" className="notebook-resize" aria-label={`调整 ${photo.name} 的打印大小`} onPointerDown={(event) => beginDrag(event, item, photo, "resize")} onPointerMove={moveDrag} onPointerUp={(event) => { event.stopPropagation(); finishDrag(); }} onPointerCancel={(event) => { event.stopPropagation(); finishDrag(true); }}>↘</button></>}
              </div>;
            })}
          </div>
          <p className="notebook-help">可叠放、旋转；选中后方向键每次移动 1 mm。红框表示超出页面。摆放位置与角度不改变省纸打印顺序。</p>
        </section>
      </div>
    </dialog>
  </div>;
}
