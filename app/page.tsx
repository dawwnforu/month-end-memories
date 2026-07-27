"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";

type Photo = {
  id: string;
  name: string;
  src: string;
  ratio: number;
  naturalWidth: number;
  naturalHeight: number;
  widthMm: number;
  heightMm: number;
  quantity: number;
};

type Settings = {
  orientation: "portrait" | "landscape";
  margin: number;
  gap: number;
  allowRotation: boolean;
};

type PackItem = {
  key: string;
  photoId: string;
  copy: number;
  widthMm: number;
  heightMm: number;
};

type Placement = PackItem & {
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
};

type FreeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PackedPage = {
  placements: Placement[];
  freeRects: FreeRect[];
};

type PackResult = {
  pages: PackedPage[];
  unplaced: PackItem[];
};

const A4 = {
  portrait: { width: 210, height: 297 },
  landscape: { width: 297, height: 210 },
} as const;

const LONG_EDGE_PRESETS = [50, 60, 70, 90];
const EPSILON = 0.001;

function roundMm(value: number) {
  return Math.round(value * 10) / 10;
}

function expandPhotos(photos: Photo[]): PackItem[] {
  return photos.flatMap((photo) =>
    Array.from({ length: photo.quantity }, (_, index) => ({
      key: `${photo.id}-${index}`,
      photoId: photo.id,
      copy: index + 1,
      widthMm: photo.widthMm,
      heightMm: photo.heightMm,
    })),
  );
}

function intersects(a: FreeRect, b: FreeRect) {
  return !(
    b.x >= a.x + a.width - EPSILON ||
    b.x + b.width <= a.x + EPSILON ||
    b.y >= a.y + a.height - EPSILON ||
    b.y + b.height <= a.y + EPSILON
  );
}

function splitFreeRect(free: FreeRect, used: FreeRect): FreeRect[] {
  if (!intersects(free, used)) return [free];

  const pieces: FreeRect[] = [];
  const freeRight = free.x + free.width;
  const freeBottom = free.y + free.height;
  const usedRight = used.x + used.width;
  const usedBottom = used.y + used.height;

  if (used.y > free.y + EPSILON && used.y < freeBottom - EPSILON) {
    pieces.push({
      x: free.x,
      y: free.y,
      width: free.width,
      height: used.y - free.y,
    });
  }
  if (usedBottom < freeBottom - EPSILON && usedBottom > free.y + EPSILON) {
    pieces.push({
      x: free.x,
      y: usedBottom,
      width: free.width,
      height: freeBottom - usedBottom,
    });
  }
  if (used.x > free.x + EPSILON && used.x < freeRight - EPSILON) {
    pieces.push({
      x: free.x,
      y: free.y,
      width: used.x - free.x,
      height: free.height,
    });
  }
  if (usedRight < freeRight - EPSILON && usedRight > free.x + EPSILON) {
    pieces.push({
      x: usedRight,
      y: free.y,
      width: freeRight - usedRight,
      height: free.height,
    });
  }

  return pieces.filter(
    (piece) => piece.width > EPSILON && piece.height > EPSILON,
  );
}

function contains(a: FreeRect, b: FreeRect) {
  return (
    b.x >= a.x - EPSILON &&
    b.y >= a.y - EPSILON &&
    b.x + b.width <= a.x + a.width + EPSILON &&
    b.y + b.height <= a.y + a.height + EPSILON
  );
}

function pruneFreeRects(rects: FreeRect[]) {
  return rects.filter(
    (rect, index) =>
      !rects.some(
        (other, otherIndex) =>
          index !== otherIndex && contains(other, rect),
      ),
  );
}

type Candidate = {
  pageIndex: number;
  freeRect: FreeRect;
  packedWidth: number;
  packedHeight: number;
  rotated: boolean;
  score: number[];
};

function isBetterScore(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > EPSILON) return a[i] < b[i];
  }
  return false;
}

function findCandidate(
  pages: PackedPage[],
  item: PackItem,
  gap: number,
  allowRotation: boolean,
): Candidate | null {
  let best: Candidate | null = null;

  pages.forEach((page, pageIndex) => {
    page.freeRects.forEach((freeRect) => {
      const orientations = [
        {
          packedWidth: item.widthMm + gap,
          packedHeight: item.heightMm + gap,
          rotated: false,
        },
      ];

      if (
        allowRotation &&
        Math.abs(item.widthMm - item.heightMm) > EPSILON
      ) {
        orientations.push({
          packedWidth: item.heightMm + gap,
          packedHeight: item.widthMm + gap,
          rotated: true,
        });
      }

      orientations.forEach((orientation) => {
        if (
          orientation.packedWidth <= freeRect.width + EPSILON &&
          orientation.packedHeight <= freeRect.height + EPSILON
        ) {
          const remainingWidth = freeRect.width - orientation.packedWidth;
          const remainingHeight = freeRect.height - orientation.packedHeight;
          const score = [
            Math.min(remainingWidth, remainingHeight),
            Math.max(remainingWidth, remainingHeight),
            freeRect.y,
            freeRect.x,
            pageIndex,
          ];
          const candidate: Candidate = {
            pageIndex,
            freeRect,
            ...orientation,
            score,
          };
          if (!best || isBetterScore(candidate.score, best.score)) {
            best = candidate;
          }
        }
      });
    });
  });

  return best;
}

function commitPlacement(
  page: PackedPage,
  item: PackItem,
  candidate: Candidate,
  gap: number,
) {
  const used: FreeRect = {
    x: candidate.freeRect.x,
    y: candidate.freeRect.y,
    width: candidate.packedWidth,
    height: candidate.packedHeight,
  };

  page.freeRects = pruneFreeRects(
    page.freeRects.flatMap((freeRect) => splitFreeRect(freeRect, used)),
  );

  page.placements.push({
    ...item,
    x: used.x,
    y: used.y,
    width: candidate.rotated ? item.heightMm : item.widthMm,
    height: candidate.rotated ? item.widthMm : item.heightMm,
    rotated: candidate.rotated,
  });

  void gap;
}

function packWithOrder(
  items: PackItem[],
  settings: Settings,
  paperWidth: number,
  paperHeight: number,
): PackResult {
  const usableWidth = paperWidth - settings.margin * 2;
  const usableHeight = paperHeight - settings.margin * 2;
  const binWidth = usableWidth + settings.gap;
  const binHeight = usableHeight + settings.gap;
  const pages: PackedPage[] = [];
  const unplaced: PackItem[] = [];

  items.forEach((item) => {
    const fitsNormal =
      item.widthMm <= usableWidth + EPSILON &&
      item.heightMm <= usableHeight + EPSILON;
    const fitsRotated =
      settings.allowRotation &&
      item.heightMm <= usableWidth + EPSILON &&
      item.widthMm <= usableHeight + EPSILON;

    if (!fitsNormal && !fitsRotated) {
      unplaced.push(item);
      return;
    }

    let candidate = findCandidate(
      pages,
      item,
      settings.gap,
      settings.allowRotation,
    );

    if (!candidate) {
      pages.push({
        placements: [],
        freeRects: [{ x: 0, y: 0, width: binWidth, height: binHeight }],
      });
      candidate = findCandidate(
        pages,
        item,
        settings.gap,
        settings.allowRotation,
      );
    }

    if (!candidate) {
      unplaced.push(item);
      return;
    }

    commitPlacement(
      pages[candidate.pageIndex],
      item,
      candidate,
      settings.gap,
    );
  });

  return { pages, unplaced };
}

function layoutScore(result: PackResult) {
  const lastPage = result.pages[result.pages.length - 1];
  const lastBottom = lastPage
    ? Math.max(
        0,
        ...lastPage.placements.map((placement) => placement.y + placement.height),
      )
    : 0;
  return [result.unplaced.length, result.pages.length, lastBottom];
}

function calculateLayout(
  photos: Photo[],
  settings: Settings,
  paperWidth: number,
  paperHeight: number,
): PackResult {
  const items = expandPhotos(photos);
  if (!items.length) return { pages: [], unplaced: [] };

  const sorters: Array<(a: PackItem, b: PackItem) => number> = [
    (a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm,
    (a, b) =>
      Math.max(b.widthMm, b.heightMm) -
      Math.max(a.widthMm, a.heightMm),
    (a, b) => b.heightMm - a.heightMm,
    (a, b) => b.widthMm - a.widthMm,
    (a, b) =>
      b.widthMm + b.heightMm - (a.widthMm + a.heightMm),
    (a, b) =>
      Math.abs(b.widthMm - b.heightMm) -
      Math.abs(a.widthMm - a.heightMm),
  ];

  let best: PackResult | null = null;
  sorters.forEach((sorter) => {
    const ordered = [...items].sort(sorter);
    const result = packWithOrder(
      ordered,
      settings,
      paperWidth,
      paperHeight,
    );
    if (!best || isBetterScore(layoutScore(result), layoutScore(best))) {
      best = result;
    }
  });

  return best ?? { pages: [], unplaced: items };
}

function loadBrowserImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = src;
  });
}

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [settings, setSettings] = useState<Settings>({
    orientation: "portrait",
    margin: 5,
    gap: 2,
    allowRotation: true,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const objectUrls = useRef(new Set<string>());

  const paper = A4[settings.orientation];
  const layout = useMemo(
    () =>
      calculateLayout(photos, settings, paper.width, paper.height),
    [photos, settings, paper.width, paper.height],
  );

  const totalCopies = photos.reduce(
    (total, photo) => total + photo.quantity,
    0,
  );
  const usedArea = photos.reduce(
    (total, photo) =>
      total + photo.widthMm * photo.heightMm * photo.quantity,
    0,
  );
  const usableArea =
    (paper.width - settings.margin * 2) *
    (paper.height - settings.margin * 2);
  const utilization =
    layout.pages.length > 0
      ? Math.min(100, (usedArea / (usableArea * layout.pages.length)) * 100)
      : 0;

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) {
      setMessage("请选择 JPG、PNG 或 WebP 图片。");
      return;
    }

    const loaded = await Promise.all(
      files.map(
        (file) =>
          new Promise<Photo | null>((resolve) => {
            const src = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
              objectUrls.current.add(src);
              const ratio = image.naturalWidth / image.naturalHeight;
              const longEdge = 70;
              const widthMm = ratio >= 1 ? longEdge : longEdge * ratio;
              const heightMm = ratio >= 1 ? longEdge / ratio : longEdge;
              resolve({
                id: crypto.randomUUID(),
                name: file.name,
                src,
                ratio,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                widthMm: roundMm(widthMm),
                heightMm: roundMm(heightMm),
                quantity: 1,
              });
            };
            image.onerror = () => {
              URL.revokeObjectURL(src);
              resolve(null);
            };
            image.src = src;
          }),
      ),
    );

    const validPhotos = loaded.filter(
      (photo): photo is Photo => photo !== null,
    );
    setPhotos((current) => [...current, ...validPhotos]);
    setMessage(
      validPhotos.length === files.length
        ? `已加入 ${validPhotos.length} 张照片，正在重新计算最省纸排法。`
        : `已加入 ${validPhotos.length} 张，另有 ${
            files.length - validPhotos.length
          } 张无法读取。`,
    );
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  function updateDimension(
    photoId: string,
    field: "widthMm" | "heightMm",
    rawValue: number,
  ) {
    if (!Number.isFinite(rawValue)) return;
    const value = Math.max(10, Math.min(400, rawValue));
    setPhotos((current) =>
      current.map((photo) => {
        if (photo.id !== photoId) return photo;
        if (field === "widthMm") {
          return {
            ...photo,
            widthMm: roundMm(value),
            heightMm: roundMm(value / photo.ratio),
          };
        }
        return {
          ...photo,
          heightMm: roundMm(value),
          widthMm: roundMm(value * photo.ratio),
        };
      }),
    );
  }

  function updateQuantity(photoId: string, quantity: number) {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === photoId
          ? {
              ...photo,
              quantity: Math.max(1, Math.min(20, Math.round(quantity || 1))),
            }
          : photo,
      ),
    );
  }

  function removePhoto(photoId: string) {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === photoId);
      if (target) {
        URL.revokeObjectURL(target.src);
        objectUrls.current.delete(target.src);
      }
      return current.filter((photo) => photo.id !== photoId);
    });
  }

  function clearPhotos() {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    setPhotos([]);
    setMessage("");
  }

  function applyLongEdge(longEdge: number) {
    setPhotos((current) =>
      current.map((photo) => {
        const widthMm =
          photo.ratio >= 1 ? longEdge : longEdge * photo.ratio;
        const heightMm =
          photo.ratio >= 1 ? longEdge / photo.ratio : longEdge;
        return {
          ...photo,
          widthMm: roundMm(widthMm),
          heightMm: roundMm(heightMm),
        };
      }),
    );
    setMessage(`全部照片的长边已设为 ${longEdge} mm。`);
  }

  function updateSetting<K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function exportPdf() {
    if (!layout.pages.length || layout.unplaced.length) return;
    setIsExporting(true);
    setMessage("正在按 300 DPI 生成 A4 PDF，请稍候…");

    try {
      const [{ jsPDF }, imageEntries] = await Promise.all([
        import("jspdf"),
        Promise.all(
          photos.map(async (photo) => [
            photo.id,
            await loadBrowserImage(photo.src),
          ] as const),
        ),
      ]);
      const imageMap = new Map(imageEntries);
      const orientation =
        settings.orientation === "portrait" ? "portrait" : "landscape";
      const pdf = new jsPDF({
        orientation,
        unit: "mm",
        format: "a4",
        compress: true,
      });
      const scale = 300 / 25.4;

      for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
        if (pageIndex > 0) pdf.addPage("a4", orientation);

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(paper.width * scale);
        canvas.height = Math.round(paper.height * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法建立导出画布");

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        layout.pages[pageIndex].placements.forEach((placement) => {
          const image = imageMap.get(placement.photoId);
          const photo = photos.find(
            (item) => item.id === placement.photoId,
          );
          if (!image || !photo) return;

          const x = (settings.margin + placement.x) * scale;
          const y = (settings.margin + placement.y) * scale;

          if (placement.rotated) {
            context.save();
            context.translate(x + placement.width * scale, y);
            context.rotate(Math.PI / 2);
            context.drawImage(
              image,
              0,
              0,
              photo.widthMm * scale,
              photo.heightMm * scale,
            );
            context.restore();
          } else {
            context.drawImage(
              image,
              x,
              y,
              placement.width * scale,
              placement.height * scale,
            );
          }
        });

        const pageImage = canvas.toDataURL("image/jpeg", 0.96);
        pdf.addImage(
          pageImage,
          "JPEG",
          0,
          0,
          paper.width,
          paper.height,
          undefined,
          "FAST",
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }

      const date = new Date();
      const fileName = `月末照片排版-${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}.pdf`;
      pdf.save(fileName);
      setMessage(
        `PDF 已生成，共 ${layout.pages.length} 页。打印时请选择“实际大小 / 100%”。`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `导出失败：${error.message}`
          : "导出失败，请重试。",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            月
          </span>
          <div>
            <h1>月末拾光</h1>
            <p>把值得纪念的照片，刚刚好地放进 A4 纸里。</p>
          </div>
        </div>
        <div className="privacy-note">
          <span aria-hidden="true">●</span>
          照片仅在本机处理
        </div>
      </header>

      <section className="workspace">
        <aside className="control-panel">
          <section className="panel-section upload-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">01 · 导入照片</span>
                <h2>本月的照片</h2>
              </div>
              {photos.length > 0 && (
                <button className="text-button" onClick={clearPhotos}>
                  清空
                </button>
              )}
            </div>

            <label
              className={`dropzone ${isDragging ? "is-dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleFileInput}
              />
              <span className="upload-symbol" aria-hidden="true">
                ＋
              </span>
              <strong>选择或拖入照片</strong>
              <small>支持 JPG、PNG、WebP，可一次多选</small>
            </label>

            {photos.length > 0 && (
              <>
                <div className="batch-size">
                  <span>全部长边</span>
                  <div className="preset-row">
                    {LONG_EDGE_PRESETS.map((size) => (
                      <button
                        key={size}
                        onClick={() => applyLongEdge(size)}
                      >
                        {size} mm
                      </button>
                    ))}
                  </div>
                </div>

                <div className="photo-list">
                  {photos.map((photo, index) => (
                    <article className="photo-card" key={photo.id}>
                      <div className="photo-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.src} alt="" />
                        <span>{String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <div className="photo-fields">
                        <div className="photo-title-row">
                          <div>
                            <strong title={photo.name}>{photo.name}</strong>
                            <small>
                              {photo.naturalWidth} × {photo.naturalHeight} px
                            </small>
                          </div>
                          <button
                            className="remove-button"
                            aria-label={`删除 ${photo.name}`}
                            onClick={() => removePhoto(photo.id)}
                          >
                            ×
                          </button>
                        </div>
                        <div className="dimension-row">
                          <label>
                            宽
                            <span>
                              <input
                                type="number"
                                min="10"
                                max="400"
                                step="1"
                                value={roundMm(photo.widthMm)}
                                onChange={(event) =>
                                  updateDimension(
                                    photo.id,
                                    "widthMm",
                                    Number(event.target.value),
                                  )
                                }
                              />
                              mm
                            </span>
                          </label>
                          <span className="dimension-link" aria-hidden="true">
                            ∞
                          </span>
                          <label>
                            高
                            <span>
                              <input
                                type="number"
                                min="10"
                                max="400"
                                step="1"
                                value={roundMm(photo.heightMm)}
                                onChange={(event) =>
                                  updateDimension(
                                    photo.id,
                                    "heightMm",
                                    Number(event.target.value),
                                  )
                                }
                              />
                              mm
                            </span>
                          </label>
                          <label className="quantity-field">
                            份数
                            <span>
                              <input
                                type="number"
                                min="1"
                                max="20"
                                step="1"
                                value={photo.quantity}
                                onChange={(event) =>
                                  updateQuantity(
                                    photo.id,
                                    Number(event.target.value),
                                  )
                                }
                              />
                            </span>
                          </label>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="panel-section layout-settings">
            <div className="section-heading">
              <div>
                <span className="eyebrow">02 · 纸张设置</span>
                <h2>A4 排版规则</h2>
              </div>
            </div>

            <div className="segmented-control" aria-label="纸张方向">
              <button
                className={
                  settings.orientation === "portrait" ? "active" : ""
                }
                aria-pressed={settings.orientation === "portrait"}
                onClick={() => updateSetting("orientation", "portrait")}
              >
                竖版
              </button>
              <button
                className={
                  settings.orientation === "landscape" ? "active" : ""
                }
                aria-pressed={settings.orientation === "landscape"}
                onClick={() => updateSetting("orientation", "landscape")}
              >
                横版
              </button>
            </div>

            <div className="setting-grid">
              <label>
                <span>安全边距</span>
                <span className="number-control">
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="1"
                    value={settings.margin}
                    onChange={(event) =>
                      updateSetting(
                        "margin",
                        Math.max(0, Math.min(20, Number(event.target.value))),
                      )
                    }
                  />
                  mm
                </span>
              </label>
              <label>
                <span>剪裁缝隙</span>
                <span className="number-control">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    value={settings.gap}
                    onChange={(event) =>
                      updateSetting(
                        "gap",
                        Math.max(0, Math.min(10, Number(event.target.value))),
                      )
                    }
                  />
                  mm
                </span>
              </label>
            </div>

            <label className="switch-row">
              <span>
                <strong>允许照片旋转 90°</strong>
                <small>横拍、竖拍自由混排，更省纸</small>
              </span>
              <input
                type="checkbox"
                checked={settings.allowRotation}
                onChange={(event) =>
                  updateSetting("allowRotation", event.target.checked)
                }
              />
              <span className="switch" aria-hidden="true" />
            </label>
          </section>
        </aside>

        <section className="preview-panel">
          <div className="preview-header">
            <div>
              <span className="eyebrow">03 · 自动排版</span>
              <h2>A4 打印预览</h2>
            </div>
            <div className="layout-stats">
              <div>
                <strong>{totalCopies}</strong>
                <span>张照片</span>
              </div>
              <div>
                <strong>{layout.pages.length || "—"}</strong>
                <span>A4 页</span>
              </div>
              <div>
                <strong>
                  {layout.pages.length ? `${Math.round(utilization)}%` : "—"}
                </strong>
                <span>照片占比</span>
              </div>
            </div>
          </div>

          <div className="preview-stage">
            {photos.length === 0 ? (
              <div className="empty-preview">
                <div
                  className={`empty-paper ${settings.orientation}`}
                  aria-hidden="true"
                >
                  <span>210 × 297 mm</span>
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div>
                  <strong>先导入几张照片吧</strong>
                  <p>
                    设置尺寸后，照片会自动旋转、重排并尽量塞进更少的 A4
                    纸。
                  </p>
                </div>
              </div>
            ) : (
              <div className="pages">
                {layout.pages.map((page, pageIndex) => (
                  <article className="page-wrap" key={pageIndex}>
                    <div className="page-label">
                      <span>第 {pageIndex + 1} 页</span>
                      <small>
                        {paper.width} × {paper.height} mm
                      </small>
                    </div>
                    <div
                      className="a4-page"
                      style={{
                        aspectRatio: `${paper.width} / ${paper.height}`,
                      }}
                    >
                      <div
                        className="safe-area"
                        style={{
                          left: `${(settings.margin / paper.width) * 100}%`,
                          top: `${(settings.margin / paper.height) * 100}%`,
                          width: `${
                            ((paper.width - settings.margin * 2) /
                              paper.width) *
                            100
                          }%`,
                          height: `${
                            ((paper.height - settings.margin * 2) /
                              paper.height) *
                            100
                          }%`,
                        }}
                      />
                      {page.placements.map((placement) => {
                        const photo = photos.find(
                          (item) => item.id === placement.photoId,
                        );
                        if (!photo) return null;
                        return (
                          <div
                            className="placed-photo"
                            key={placement.key}
                            title={`${photo.name} · ${roundMm(
                              photo.widthMm,
                            )} × ${roundMm(photo.heightMm)} mm${
                              placement.rotated ? " · 已旋转" : ""
                            }`}
                            style={{
                              left: `${
                                ((settings.margin + placement.x) /
                                  paper.width) *
                                100
                              }%`,
                              top: `${
                                ((settings.margin + placement.y) /
                                  paper.height) *
                                100
                              }%`,
                              width: `${
                                (placement.width / paper.width) * 100
                              }%`,
                              height: `${
                                (placement.height / paper.height) * 100
                              }%`,
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.src}
                              alt={photo.name}
                              className={
                                placement.rotated ? "rotated" : undefined
                              }
                              style={
                                placement.rotated
                                  ? {
                                      width: `${
                                        (placement.height / placement.width) *
                                        100
                                      }%`,
                                      height: `${
                                        (placement.width / placement.height) *
                                        100
                                      }%`,
                                    }
                                  : undefined
                              }
                            />
                            {placement.rotated && (
                              <span className="rotation-badge">↻</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {layout.unplaced.length > 0 && (
            <div className="warning-banner" role="alert">
              有 {layout.unplaced.length} 张照片的目标尺寸超过当前 A4
              可用范围，请调小照片或边距后再导出。
            </div>
          )}

          <div className="export-bar">
            <div className="print-tip">
              <span aria-hidden="true">i</span>
              <p>
                <strong>打印店提示</strong>
                导出后请选择“实际大小 / 100%”，不要勾选“适合页面”。
              </p>
            </div>
            <div className="export-actions">
              <span>
                {message ||
                  (photos.length
                    ? "尺寸改变后会立即重新优化排版"
                    : "等待导入照片")}
              </span>
              <button
                className="export-button"
                disabled={
                  !layout.pages.length ||
                  layout.unplaced.length > 0 ||
                  isExporting
                }
                onClick={() => void exportPdf()}
              >
                <span aria-hidden="true">↓</span>
                {isExporting ? "正在生成…" : "导出打印 PDF"}
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
