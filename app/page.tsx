"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { duplicateGroups, uniquePhotos, fingerprintImage, previewImage, suspectedDuplicateGroups, originalPhotoName } from "./photo-tools";
import { usePhotoDatabase } from "./use-photo-database";
import { readMetadata, archivePaths } from "./photo-batch";
import { orderPhotos, type PhotoOrder } from "./photo-order";
import NotebookPreview from "./notebook-preview";

export type Photo = {
  id: string;
  name: string;
  src: string;
  previewSrc?: string;
  originalFile?: File;
  takenAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  fingerprint: string;
  ratio: number;
  rotationTurns: number;
  manualRotation: boolean;
  naturalWidth: number;
  naturalHeight: number;
  widthMm: number;
  heightMm: number;
  quantity: number;
  lockAspectRatio: boolean;
  crop: CropArea;
};

type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PaperSizeKey =
  | "a3"
  | "a4"
  | "a5"
  | "a6"
  | "b5"
  | "letter"
  | "photo5"
  | "photo6";

type Settings = {
  paperSize: PaperSizeKey;
  orientation: "portrait" | "landscape";
  margin: number;
  gap: number;
  allowRotation: boolean;
  strictColumns?: boolean;
  columns?: number;
  sortingEnabled?: boolean;
  photoOrder?: PhotoOrder;
  locationRadius?: number;
  timeWindow?: number;
};

type UndoSnapshot = {
  photos: Photo[];
  settings: Settings;
  selectedPlacementKey: string | null;
};

type PackItem = {
  key: string;
  photoId: string;
  copy: number;
  widthMm: number;
  heightMm: number;
  allowAutoRotation: boolean;
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

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type CropDragMode = ResizeCorner | "move";
type SizeReferenceKey =
  | "pen"
  | "card"
  | "phone"
  | "mouse"
  | "charger"
  | "textbook"
  | "sponge"
  | "tissues";

const PAPER_SIZES: Record<
  PaperSizeKey,
  { label: string; width: number; height: number }
> = {
  a3: { label: "A3", width: 297, height: 420 },
  a4: { label: "A4", width: 210, height: 297 },
  a5: { label: "A5", width: 148, height: 210 },
  a6: { label: "A6", width: 105, height: 148 },
  b5: { label: "B5", width: 176, height: 250 },
  letter: { label: "Letter", width: 215.9, height: 279.4 },
  photo5: { label: "5 寸照片纸", width: 89, height: 127 },
  photo6: { label: "6 寸照片纸", width: 102, height: 152 },
} as const;

const LONG_EDGE_PRESETS = [50, 60, 70, 90];
const EPSILON = 0.001;

const SIZE_REFERENCES: Array<{
  key: SizeReferenceKey;
  label: string;
  width: number;
  height: number;
  shape: SizeReferenceKey;
  note: string;
}> = [
  {
    key: "pen",
    label: "常见中性笔",
    width: 145,
    height: 10,
    shape: "pen",
    note: "常见近似尺寸",
  },
  {
    key: "card",
    label: "银行卡",
    width: 85.6,
    height: 53.98,
    shape: "card",
    note: "ISO ID-1 标准",
  },
  {
    key: "phone",
    label: "iPhone 15",
    width: 71.6,
    height: 147.6,
    shape: "phone",
    note: "Apple 官方尺寸",
  },
  {
    key: "mouse",
    label: "罗技 M240 鼠标",
    width: 60,
    height: 99,
    shape: "mouse",
    note: "罗技官方尺寸",
  },
  {
    key: "charger",
    label: "Anker 523 充电器",
    width: 35,
    height: 52.5,
    shape: "charger",
    note: "Anker 官方尺寸",
  },
  {
    key: "textbook",
    label: "学生课本",
    width: 185,
    height: 260,
    shape: "textbook",
    note: "常见 16 开近似尺寸",
  },
  {
    key: "sponge",
    label: "洗碗海绵",
    width: 110,
    height: 70,
    shape: "sponge",
    note: "家用常见近似尺寸",
  },
  {
    key: "tissues",
    label: "便携纸巾包",
    width: 110,
    height: 55,
    shape: "tissues",
    note: "常见近似尺寸",
  },
];

function roundMm(value: number) {
  return Math.round(value * 10) / 10;
}

function formatReferenceCount(value: number) {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function cropBackgroundStyle(photo: Photo) {
  const crop = photo.crop;
  const xPosition =
    crop.width >= 1 ? 0 : (crop.x / (1 - crop.width)) * 100;
  const yPosition =
    crop.height >= 1 ? 0 : (crop.y / (1 - crop.height)) * 100;

  return {
    backgroundImage: `url("${photo.previewSrc ?? photo.src}")`,
    backgroundPosition: `${xPosition}% ${yPosition}%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${100 / crop.width}% ${100 / crop.height}%`,
  };
}

function expandPhotos(photos: Photo[]): PackItem[] {
  return photos.flatMap((photo) =>
    Array.from({ length: photo.quantity }, (_, index) => ({
      key: `${photo.id}-${index}`,
      photoId: photo.id,
      copy: index + 1,
      widthMm: photo.widthMm,
      heightMm: photo.heightMm,
      allowAutoRotation: !photo.manualRotation,
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
        item.allowAutoRotation &&
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
      item.allowAutoRotation &&
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
  if (settings.strictColumns || (settings.sortingEnabled && settings.photoOrder !== "import")) {
    const width = paperWidth - settings.margin * 2;
    const height = paperHeight - settings.margin * 2;
    const columns = settings.strictColumns ? settings.columns ?? 2 : 1;
    const columnWidth = (width - settings.gap * (columns - 1)) / columns;
    const pages: PackedPage[] = [];
    const unplaced: PackItem[] = [];
    let row: Placement[] = [], y = 0, x = 0, rowHeight = 0;
    const flush = () => {
      if (!row.length) return;
      if (!pages.length || y + rowHeight > height + EPSILON) { pages.push({ placements: [], freeRects: [] }); y = 0; }
      const offset = settings.strictColumns ? 0 : (width - (x - settings.gap)) / 2;
      pages[pages.length - 1].placements.push(...row.map((item) => ({ ...item, x: item.x + offset, y: y + (rowHeight - item.height) / 2 })));
      y += rowHeight + settings.gap; row = []; x = 0; rowHeight = 0;
    };
    for (const item of items) {
      let w = item.widthMm, h = item.heightMm, rotated = false;
      if ((w > columnWidth + EPSILON || h > height + EPSILON) && settings.allowRotation && item.allowAutoRotation && h <= columnWidth + EPSILON && w <= height + EPSILON) { [w, h] = [h, w]; rotated = true; }
      if (w > columnWidth + EPSILON || h > height + EPSILON) { unplaced.push(item); continue; }
      if (row.length && (settings.strictColumns ? row.length === columns : x + w > width + EPSILON)) flush();
      row.push({ ...item, width: w, height: h, rotated, x: settings.strictColumns ? row.length * (columnWidth + settings.gap) + (columnWidth - w) / 2 : x, y: 0 });
      x += w + settings.gap; rowHeight = Math.max(rowHeight, h);
    }
    flush();
    return { pages, unplaced };
  }

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

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.matches("input, textarea, select") ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const databaseStatus = usePhotoDatabase(photos);
  const [settings, setSettings] = useState<Settings>({
    paperSize: "a4",
    orientation: "portrait",
    margin: 5,
    gap: 2,
    allowRotation: true,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [allowDuplicateImages, setAllowDuplicateImages] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicateNotice, setDuplicateNotice] = useState(false);
  const [skippedDuplicates, setSkippedDuplicates] = useState<Array<{ name: string; photoId: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [groupByDate, setGroupByDate] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const selectedPhotos = photos.filter((photo) => selectedIds.includes(photo.id));
  const orderedPhotos = useMemo(() => orderPhotos(photos, settings.sortingEnabled ? settings.photoOrder ?? "import" : "import", settings.locationRadius ?? 100, settings.timeWindow ?? 3), [photos, settings.sortingEnabled, settings.photoOrder, settings.locationRadius, settings.timeWindow]);
  const listedPhotos = orderedPhotos.map((photo) => ({ photo, index: photos.indexOf(photo) }));
  function togglePhoto(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }
  const [photoQuery, setPhotoQuery] = useState("");
  const [activeResultKey, setActiveResultKey] = useState<string | null>(null);
  const [cropEditor, setCropEditor] = useState<{
    photoId: string;
    draft: CropArea;
  } | null>(null);
  const [showSizeReference, setShowSizeReference] = useState(false);
  const [referencePaperKey, setReferencePaperKey] =
    useState<PaperSizeKey>("a4");
  const [referenceObjectKey, setReferenceObjectKey] =
    useState<SizeReferenceKey>("pen");
  const [undoDepth, setUndoDepth] = useState(0);
  const [selectedPlacementKey, setSelectedPlacementKey] = useState<
    string | null
  >(null);
  const [resizeHint, setResizeHint] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [resizeDraft, setResizeDraft] = useState<{
    key: string;
    corner: ResizeCorner;
  } | null>(null);
  const objectUrls = useRef(new Set<string>());
  const isImporting = useRef(false);
  const undoHistory = useRef<UndoSnapshot[]>([]);
  const photosRef = useRef(photos);
  const settingsRef = useRef(settings);
  const selectedPlacementKeyRef = useRef(selectedPlacementKey);
  useEffect(() => {
    const retained = new Set([...photos, ...undoHistory.current.flatMap((snapshot) => snapshot.photos)].flatMap((photo) => [photo.src, photo.previewSrc]));
    for (const url of objectUrls.current) if (!retained.has(url)) { URL.revokeObjectURL(url); objectUrls.current.delete(url); }
  }, [photos, undoDepth]);
  const shortcutDetailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    photosRef.current = photos;
    settingsRef.current = settings;
    selectedPlacementKeyRef.current = selectedPlacementKey;
  }, [photos, settings, selectedPlacementKey]);

  const basePaper = PAPER_SIZES[settings.paperSize];
  const paper =
    settings.orientation === "portrait"
      ? basePaper
      : {
          ...basePaper,
          width: basePaper.height,
          height: basePaper.width,
        };
  const layout = useMemo(
    () =>
      calculateLayout(orderedPhotos, settings, paper.width, paper.height),
    [orderedPhotos, settings, paper.width, paper.height],
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

  const duplicates = useMemo(() => duplicateGroups(photos), [photos]);
  const suspectedDuplicates = suspectedDuplicateGroups(photos);
  const extraPhotoCount = duplicates.reduce((count, group) => count + group.length - 1, 0);
  const locations = photos.flatMap((photo, index) => {
    const matches = layout.pages.flatMap((page, pageIndex) =>
      page.placements.flatMap((placement, position) =>
        placement.photoId === photo.id
          ? [{ photo, key: placement.key, label: `第 ${pageIndex + 1} 页 · 第 ${position + 1} 张 · 第 ${placement.copy} 份`, index }]
          : [],
      ),
    );
    return matches.length ? matches : [{ photo, key: `unplaced-${photo.id}`, label: "未排入页面（尺寸过大）", index }];
  });
  const searchResults = photoQuery.trim()
    ? locations.filter(({ photo }) => photo.name.toLocaleLowerCase().includes(photoQuery.trim().toLocaleLowerCase()))
    : [];
  const activeResultIndex = searchResults.findIndex((result) => result.key === activeResultKey);
  const matchedPhotoIds = new Set(searchResults.map(({ photo }) => photo.id));

  function locatePhoto(result: (typeof locations)[number]) {
    setActiveResultKey(result.key);
    setSelectedPlacementKey(result.key.startsWith("unplaced-") ? null : result.key);
    const card = document.getElementById(`photo-card-${result.photo.id}`);
    const list = card?.closest(".photo-list");
    if (card && list) {
      list.scrollTop += card.getBoundingClientRect().top - list.getBoundingClientRect().top;
    }
    const placed = document.getElementById(`placement-${result.key}`);
    placed?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (!placed) card?.scrollIntoView({ block: "center", behavior: "smooth" });
    setMessage(`${result.photo.name} · 图片 #${result.index + 1} · ${result.label}`);
  }

  function moveSearchResult(direction: number) {
    if (!searchResults.length) return;
    const index = activeResultIndex < 0
      ? (direction > 0 ? 0 : searchResults.length - 1)
      : (activeResultIndex + direction + searchResults.length) % searchResults.length;
    locatePhoto(searchResults[index]);
  }

  function removeDuplicates(group?: Photo[]) {
    const current = photosRef.current;
    const removeIds = new Set(group?.slice(1).map((photo) => photo.id));
    const next = group ? current.filter((photo) => !removeIds.has(photo.id)) : uniquePhotos(current);
    if (next.length === current.length) return;
    rememberForUndo();
    photosRef.current = next;
    setPhotos(next);
    setSelectedPlacementKey(null);
    setCropEditor(null);
    setMessage(`已清理 ${current.length - next.length} 张多余图片，每组保留第一张；可按 Ctrl/⌘ + Z 撤销。`);
  }

  function rememberForUndo() {
    undoHistory.current.push({
      photos: photosRef.current.map((photo) => ({
        ...photo,
        crop: { ...photo.crop },
      })),
      settings: { ...settingsRef.current },
      selectedPlacementKey: selectedPlacementKeyRef.current,
    });
    if (undoHistory.current.length > 50) {
      undoHistory.current.shift();
    }
    setUndoDepth(undoHistory.current.length);
  }

  function undoLastAction() {
    const snapshot = undoHistory.current.pop();
    if (!snapshot) {
      setMessage("目前没有可撤销的操作。");
      return;
    }
    photosRef.current = snapshot.photos;
    setPhotos(snapshot.photos);
    setSettings(snapshot.settings);
    setSelectedPlacementKey(snapshot.selectedPlacementKey);
    setResizeDraft(null);
    setResizeHint(null);
    setUndoDepth(undoHistory.current.length);
    setMessage("已撤销上一步操作。");
  }

  function getSelectedPhoto() {
    const key = selectedPlacementKeyRef.current;
    if (!key) return null;
    return (
      photosRef.current.find((photo) => key.startsWith(`${photo.id}-`)) ?? null
    );
  }

  function resizePhotoByKeyboard(photoId: string, direction: 1 | -1) {
    const target = photosRef.current.find((photo) => photo.id === photoId);
    if (!target) return;
    const currentLongEdge = Math.max(target.widthMm, target.heightMm);
    const nextLongEdge = Math.max(10, Math.min(400, currentLongEdge + direction));
    if (Math.abs(nextLongEdge - currentLongEdge) < EPSILON) return;

    rememberForUndo();
    const scale = nextLongEdge / currentLongEdge;
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === photoId
          ? {
              ...photo,
              widthMm: roundMm(photo.widthMm * scale),
              heightMm: roundMm(photo.heightMm * scale),
            }
          : photo,
      ),
    );
    setMessage(
      `${target.name} 已${direction > 0 ? "放大" : "缩小"} 1 mm，版面已重新排列。`,
    );
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) {
      setMessage("请选择 JPG、PNG 或 WebP 图片。");
      return;
    }

    if (isImporting.current) {
      setMessage("正在检查上一批照片，请稍候再试。");
      return;
    }

    isImporting.current = true;
    setMessage(
      allowDuplicateImages ? "正在读取照片…" : "正在检查照片是否重复…",
    );

    try {
      const loaded: Photo[] = [];
      const skipped: Array<{ name: string; photoId: string }> = [];
      let unreadableCount = 0;
      // Decode one image at a time so a large batch does not allocate all pixel buffers together.
      for (const file of files) {
        const src = URL.createObjectURL(file);
        let previewSrc: string | undefined;
        try {
          const image = await loadBrowserImage(src);
          const fingerprint = await fingerprintImage(image);
          previewSrc = await previewImage(image);
          const ratio = image.naturalWidth / image.naturalHeight;
          loaded.push({
            id: crypto.randomUUID(), name: file.name, src, previewSrc, fingerprint, ratio,
            originalFile: file, ...readMetadata(new Uint8Array(await file.arrayBuffer())),
            rotationTurns: 0, manualRotation: false,
            naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
            widthMm: roundMm(ratio >= 1 ? 70 : 70 * ratio),
            heightMm: roundMm(ratio >= 1 ? 70 / ratio : 70),
            quantity: 1, lockAspectRatio: true,
            crop: { x: 0, y: 0, width: 1, height: 1 },
          });
          image.src = "";
          setMessage(`正在读取照片 ${loaded.length + unreadableCount} / ${files.length}…`);
        } catch {
          URL.revokeObjectURL(src);
          if (previewSrc) URL.revokeObjectURL(previewSrc);
          unreadableCount += 1;
        }
      }

      // Compare against the current collection after decoding, including edits made during import.
      const next = [...photosRef.current];
      for (const photo of loaded) {
        if (!allowDuplicateImages) {
          const existing = next.find((item) => item.fingerprint === photo.fingerprint);
          if (existing) {
            skipped.push({ name: photo.name, photoId: existing.id });
            URL.revokeObjectURL(photo.src);
            if (photo.previewSrc) URL.revokeObjectURL(photo.previewSrc);
            continue;
          }
        }
        next.push(photo);
        objectUrls.current.add(photo.src);
        if (photo.previewSrc) objectUrls.current.add(photo.previewSrc);
      }
      const addedCount = next.length - photosRef.current.length;
      if (addedCount) {
        rememberForUndo();
        photosRef.current = next;
        setPhotos(next);
      }
      setSkippedDuplicates(skipped);
      if (skipped.length || (!allowDuplicateImages && suspectedDuplicateGroups(next).length)) setDuplicateNotice(true);
      setMessage(`已加入 ${addedCount} 张，跳过 ${skipped.length} 张重复图片${unreadableCount ? `，另有 ${unreadableCount} 张无法读取` : ""}。`);
    } catch {
      setMessage("图片读取失败，请重新选择。");
    } finally {
      isImporting.current = false;
    }
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
    rememberForUndo();
    setSelectedPlacementKey(`${photoId}-0`);
    const value = Math.max(10, Math.min(400, rawValue));
    setPhotos((current) =>
      current.map((photo) => {
        if (photo.id !== photoId) return photo;
        if (field === "widthMm") {
          return {
            ...photo,
            widthMm: roundMm(value),
            heightMm: photo.lockAspectRatio
              ? roundMm(value / photo.ratio)
              : photo.heightMm,
          };
        }
        return {
          ...photo,
          heightMm: roundMm(value),
          widthMm: photo.lockAspectRatio
            ? roundMm(value * photo.ratio)
            : photo.widthMm,
        };
      }),
    );
  }

  function toggleAspectLock(photoId: string) {
    const target = photosRef.current.find((photo) => photo.id === photoId);
    if (!target) return;
    rememberForUndo();
    setSelectedPlacementKey(`${photoId}-0`);
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === photoId
          ? { ...photo, lockAspectRatio: !photo.lockAspectRatio }
          : photo,
      ),
    );
    setMessage(
      target.lockAspectRatio
        ? `${target.name} 已解除比例锁定，可分别调整宽和高。`
        : `${target.name} 已恢复等比例缩放。`,
    );
  }

  function updateQuantity(photoId: string, quantity: number) {
    rememberForUndo();
    setSelectedPlacementKey(`${photoId}-0`);
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
    const target = photosRef.current.find((photo) => photo.id === photoId);
    if (!target) return;
    rememberForUndo();
    if (selectedPlacementKey?.startsWith(`${photoId}-`)) {
      setSelectedPlacementKey(null);
    }
    const next = photosRef.current.filter((photo) => photo.id !== photoId);
    photosRef.current = next;
    setPhotos(next);
    setMessage(`已删除 ${target.name}，可按 Ctrl/⌘ + Z 撤销。`);
  }

  function clearPhotos() {
    if (!photosRef.current.length) return;
    rememberForUndo();
    photosRef.current = [];
    setPhotos([]);
    setSelectedPlacementKey(null);
    setMessage("已清空照片，可按 Ctrl/⌘ + Z 撤销。");
  }

  function applyLongEdge(longEdge: number) {
    if (!photosRef.current.length) return;
    rememberForUndo();
    setPhotos((current) =>
      current.map((photo) => {
        const currentLongEdge = Math.max(photo.widthMm, photo.heightMm);
        const scale = longEdge / currentLongEdge;
        return {
          ...photo,
          widthMm: roundMm(photo.widthMm * scale),
          heightMm: roundMm(photo.heightMm * scale),
        };
      }),
    );
    setMessage(`全部照片的长边已设为 ${longEdge} mm。`);
  }

  function updateSetting<K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) {
    if (settingsRef.current[key] === value) return;
    rememberForUndo();
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function rotatePhoto(photoId: string) {
    if (!photosRef.current.some((photo) => photo.id === photoId)) return;
    rememberForUndo();
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === photoId
          ? {
              ...photo,
              ratio: 1 / photo.ratio,
              rotationTurns: (photo.rotationTurns + 1) % 4,
              manualRotation: true,
              widthMm: photo.heightMm,
              heightMm: photo.widthMm,
            }
          : photo,
      ),
    );
    setMessage("照片已顺时针旋转 90°，版面已重新优化。");
  }

  function openCropEditor(photoId: string) {
    const photo = photosRef.current.find((item) => item.id === photoId);
    if (!photo) return;
    setSelectedPlacementKey(`${photoId}-0`);
    setCropEditor({
      photoId,
      draft: { ...photo.crop },
    });
  }

  function applyCrop() {
    if (!cropEditor) return;
    const target = photosRef.current.find(
      (photo) => photo.id === cropEditor.photoId,
    );
    if (!target) {
      setCropEditor(null);
      return;
    }

    rememberForUndo();
    const sourceRatio =
      (target.naturalWidth * cropEditor.draft.width) /
      (target.naturalHeight * cropEditor.draft.height);
    const ratio =
      target.rotationTurns % 2 === 1 ? 1 / sourceRatio : sourceRatio;
    const currentLongEdge = Math.max(target.widthMm, target.heightMm);

    setPhotos((current) =>
      current.map((photo) => {
        if (photo.id !== target.id) return photo;
        if (!photo.lockAspectRatio) {
          return {
            ...photo,
            crop: { ...cropEditor.draft },
            ratio,
          };
        }
        return {
          ...photo,
          crop: { ...cropEditor.draft },
          ratio,
          widthMm: roundMm(ratio >= 1 ? currentLongEdge : currentLongEdge * ratio),
          heightMm: roundMm(ratio >= 1 ? currentLongEdge / ratio : currentLongEdge),
        };
      }),
    );
    setCropEditor(null);
    setMessage(`${target.name} 已完成自由裁剪，版面已重新排列。`);
  }

  function beginCropDrag(
    event: ReactPointerEvent<HTMLElement>,
    mode: CropDragMode,
  ) {
    if (!cropEditor) return;
    event.preventDefault();
    event.stopPropagation();
    const shell = event.currentTarget.closest(
      ".crop-image-shell",
    ) as HTMLElement | null;
    if (!shell) return;

    const bounds = shell.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...cropEditor.draft };
    const minSize = 0.05;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / bounds.width;
      const dy = (moveEvent.clientY - startY) / bounds.height;
      let left = start.x;
      let top = start.y;
      let right = start.x + start.width;
      let bottom = start.y + start.height;

      if (mode === "move") {
        left = Math.max(0, Math.min(1 - start.width, start.x + dx));
        top = Math.max(0, Math.min(1 - start.height, start.y + dy));
        right = left + start.width;
        bottom = top + start.height;
      } else {
        if (mode === "nw" || mode === "sw") {
          left = Math.max(0, Math.min(right - minSize, start.x + dx));
        }
        if (mode === "ne" || mode === "se") {
          right = Math.min(
            1,
            Math.max(left + minSize, start.x + start.width + dx),
          );
        }
        if (mode === "nw" || mode === "ne") {
          top = Math.max(0, Math.min(bottom - minSize, start.y + dy));
        }
        if (mode === "sw" || mode === "se") {
          bottom = Math.min(
            1,
            Math.max(top + minSize, start.y + start.height + dy),
          );
        }
      }

      const draft = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
      setCropEditor((current) =>
        current?.photoId === cropEditor.photoId
          ? { ...current, draft }
          : current,
      );
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function beginDirectResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    photo: Photo,
    placement: Placement,
    corner: ResizeCorner,
  ) {
    event.preventDefault();
    event.stopPropagation();
    rememberForUndo();
    const placedElement = event.currentTarget.closest(
      ".placed-photo",
    ) as HTMLElement | null;
    if (!placedElement) return;

    const bounds = placedElement.getBoundingClientRect();
    const opposite = {
      nw: { x: bounds.right, y: bounds.bottom },
      ne: { x: bounds.left, y: bounds.bottom },
      sw: { x: bounds.right, y: bounds.top },
      se: { x: bounds.left, y: bounds.top },
    }[corner];
    const startDistance = Math.max(
      1,
      Math.hypot(event.clientX - opposite.x, event.clientY - opposite.y),
    );
    const startWidth = photo.widthMm;
    const startHeight = photo.heightMm;
    const minScale = Math.max(10 / startWidth, 10 / startHeight);
    const maxScale = Math.min(400 / startWidth, 400 / startHeight);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      let widthMm: number;
      let heightMm: number;
      if (photo.lockAspectRatio) {
        const currentDistance = Math.hypot(
          moveEvent.clientX - opposite.x,
          moveEvent.clientY - opposite.y,
        );
        const scale = Math.max(
          minScale,
          Math.min(maxScale, currentDistance / startDistance),
        );
        widthMm = roundMm(startWidth * scale);
        heightMm = roundMm(startHeight * scale);
      } else {
        const horizontalScale = Math.max(
          10 / placement.width,
          Math.abs(moveEvent.clientX - opposite.x) / bounds.width,
        );
        const verticalScale = Math.max(
          10 / placement.height,
          Math.abs(moveEvent.clientY - opposite.y) / bounds.height,
        );
        widthMm = roundMm(
          Math.min(
            400,
            startWidth *
              (placement.rotated ? verticalScale : horizontalScale),
          ),
        );
        heightMm = roundMm(
          Math.min(
            400,
            startHeight *
              (placement.rotated ? horizontalScale : verticalScale),
          ),
        );
      }
      setResizeDraft({ key: placement.key, corner });
      setPhotos((current) =>
        current.map((item) =>
          item.id === photo.id &&
          (item.widthMm !== widthMm || item.heightMm !== heightMm)
            ? {
                ...item,
                widthMm,
                heightMm,
              }
            : item,
        ),
      );
      setResizeHint({
        x: moveEvent.clientX + 14,
        y: moveEvent.clientY + 14,
        text: `${widthMm} × ${heightMm} mm`,
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      setResizeDraft(null);
      setResizeHint(null);
      setMessage(
        `已完成缩放 ${photo.name}，版面在拖动过程中已实时更新。`,
      );
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (duplicateNotice && event.key === "Escape") {
        event.preventDefault();
        setDuplicateNotice(false);
        return;
      }

      if (cropEditor) {
        if (event.key === "Escape") {
          event.preventDefault();
          setCropEditor(null);
        }
        return;
      }

      if (showSizeReference) {
        if (event.key === "Escape") {
          event.preventDefault();
          setShowSizeReference(false);
        }
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        undoLastAction();
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        const details = shortcutDetailsRef.current;
        if (details) {
          details.open = !details.open;
          details.querySelector("summary")?.focus();
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedPlacementKey(null);
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const selectedPhoto = getSelectedPhoto();
      if (!selectedPhoto) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removePhoto(selectedPhoto.id);
      } else if (event.key === "+" || event.code === "NumpadAdd") {
        event.preventDefault();
        resizePhotoByKeyboard(selectedPhoto.id, 1);
      } else if (event.key === "-" || event.code === "NumpadSubtract") {
        event.preventDefault();
        resizePhotoByKeyboard(selectedPhoto.id, -1);
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        rotatePhoto(selectedPhoto.id);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  async function shareOriginals() {
    const files = selectedPhotos.map((photo) => photo.originalFile);
    if (files.some((file) => !file) || !navigator.canShare?.({ files: files as File[] })) {
      setMessage("当前浏览器不支持分享这些原图，请下载所选原图 ZIP 后自行转发。");
      return;
    }
    try { await navigator.share({ files: files as File[] }); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setMessage("分享未完成，请下载原图后转发。"); }
  }

  async function saveOriginals(toFolder: boolean) {
    if (!selectedPhotos.length || batchBusy) return;
    type Directory = { getDirectoryHandle: (name: string, options: { create: boolean }) => Promise<Directory>; getFileHandle: (name: string, options: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> };
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<Directory> }).showDirectoryPicker;
    setBatchBusy(true);
    try {
      const root = toFolder && picker ? await picker.call(window, { mode: "readwrite" }) : null;
      const items = selectedPhotos;
      const files = await Promise.all(items.map(async (photo) => photo.originalFile ?? await (await fetch(photo.src)).blob()));
      const paths = archivePaths(items, groupByDate);
      if (root) {
        // A fresh subfolder preserves all existing user files.
        const directory = await root.getDirectoryHandle(`月末拾光-${crypto.randomUUID()}`, { create: true });
        for (let i = 0; i < files.length; i++) {
          const parts = paths[i].split("/");
          const target = parts.length === 2 ? await directory.getDirectoryHandle(parts[0], { create: true }) : directory;
          const handle = await target.getFileHandle(parts.at(-1)!, { create: true });
          const writable = await handle.createWritable();
          await writable.write(files[i]);
          await writable.close();
        }
        setMessage(`已在新文件夹中保存 ${files.length} 张原图。`);
      } else {
        const { zipSync } = await import("fflate");
        const entries: Record<string, Uint8Array> = Object.create(null);
        for (let i = 0; i < files.length; i++) entries[paths[i]] = new Uint8Array(await files[i].arrayBuffer());
        const url = URL.createObjectURL(new Blob([zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
        const link = document.createElement("a");
        link.href = url; link.download = "月末拾光-所选原图.zip"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setMessage(toFolder ? "浏览器不支持直接保存文件夹，已下载 ZIP，解压即可查看分类文件夹。" : `已导出 ${files.length} 张原图，保留原始文件及拍摄信息。`);
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) setMessage("保存未完成，文件夹中可能有部分已保存的照片，请检查后重试。");
    } finally { setBatchBusy(false); }
  }

  async function exportPdf(exportPhotos = orderedPhotos) {
    exportPhotos = orderPhotos(exportPhotos, settings.sortingEnabled ? settings.photoOrder ?? "import" : "import", settings.locationRadius ?? 100, settings.timeWindow ?? 3);
    const exportLayout = calculateLayout(exportPhotos, settings, paper.width, paper.height);
    if (!exportLayout.pages.length || exportLayout.unplaced.length) { setMessage("请先调整过大的照片尺寸，再导出 PDF。"); return; }
    setIsExporting(true);
    setMessage(`正在按 300 DPI 生成 ${paper.label} PDF，请稍候…`);

    try {
      const { jsPDF } = await import("jspdf");
      const orientation =
        settings.orientation === "portrait" ? "portrait" : "landscape";
      const pdf = new jsPDF({
        orientation,
        unit: "mm",
        format: [paper.width, paper.height],
        compress: true,
      });
      const scale = 300 / 25.4;

      for (let pageIndex = 0; pageIndex < exportLayout.pages.length; pageIndex += 1) {
        if (pageIndex > 0) {
          pdf.addPage([paper.width, paper.height], orientation);
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(paper.width * scale);
        canvas.height = Math.round(paper.height * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法建立导出画布");

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        for (const placement of exportLayout.pages[pageIndex].placements) {
          const photo = exportPhotos.find(
            (item) => item.id === placement.photoId,
          );
          if (!photo) continue;
          const image = await loadBrowserImage(photo.src);

          const x = (settings.margin + placement.x) * scale;
          const y = (settings.margin + placement.y) * scale;

          const width = placement.width * scale;
          const height = placement.height * scale;
          const totalTurns =
            (photo.rotationTurns + (placement.rotated ? 1 : 0)) % 4;
          const sourceX = photo.crop.x * image.naturalWidth;
          const sourceY = photo.crop.y * image.naturalHeight;
          const sourceWidth = photo.crop.width * image.naturalWidth;
          const sourceHeight = photo.crop.height * image.naturalHeight;
          const drawCroppedImage = (
            destinationWidth: number,
            destinationHeight: number,
          ) =>
            context.drawImage(
              image,
              sourceX,
              sourceY,
              sourceWidth,
              sourceHeight,
              0,
              0,
              destinationWidth,
              destinationHeight,
            );

          context.save();
          context.translate(x, y);
          if (totalTurns === 1) {
            context.translate(width, 0);
            context.rotate(Math.PI / 2);
            drawCroppedImage(height, width);
          } else if (totalTurns === 2) {
            context.translate(width, height);
            context.rotate(Math.PI);
            drawCroppedImage(width, height);
          } else if (totalTurns === 3) {
            context.translate(0, height);
            context.rotate(-Math.PI / 2);
            drawCroppedImage(height, width);
          } else {
            drawCroppedImage(width, height);
          }
          context.restore();
          image.src = "";
        }

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
        canvas.width = canvas.height = 0;
        setMessage(`正在生成 PDF：${pageIndex + 1} / ${exportLayout.pages.length} 页…`);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }

      const date = new Date();
      const fileName = `月末照片排版-${paper.label}-${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}.pdf`;
      pdf.save(fileName);
      setMessage(
        `PDF 已生成，共 ${exportLayout.pages.length} 页。打印时请选择“实际大小 / 100%”。`,
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

  const cropPhoto = cropEditor
    ? photos.find((photo) => photo.id === cropEditor.photoId) ?? null
    : null;
  const referencePaper = PAPER_SIZES[referencePaperKey];
  const referenceObject =
    SIZE_REFERENCES.find((item) => item.key === referenceObjectKey) ??
    SIZE_REFERENCES[0];
  const referenceGapMm = 24;
  const referenceStageWidth =
    referencePaper.width + referenceObject.width + referenceGapMm;
  const referenceStageHeight = Math.max(
    referencePaper.height,
    referenceObject.height,
  );
  const referenceObjectLongEdge = Math.max(
    referenceObject.width,
    referenceObject.height,
  );

  function resizeForNotebook(photoId: string, width: number, height: number) {
    if (![width, height].every((value) => Number.isFinite(value) && value >= 10 && value <= 400)) return;
    const current = photosRef.current.find((photo) => photo.id === photoId);
    if (!current || (current.widthMm === roundMm(width) && current.heightMm === roundMm(height))) return;
    rememberForUndo();
    setPhotos((previous) => previous.map((photo) => photo.id === photoId ? { ...photo, widthMm: roundMm(width), heightMm: roundMm(height) } : photo));
    setMessage(`${current.name} 的打印尺寸已从本子预览同步为 ${roundMm(width)} × ${roundMm(height)} mm。`);
  }

  return (
    <NotebookPreview photos={photos} selectedPhotoIds={selectedPhotos.map((photo) => photo.id)} onSizeChange={resizeForNotebook} imageStyle={cropBackgroundStyle}>
    <main
      className="app-shell"
      onCopy={(event) => {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setMessage("页面说明文字与照片已启用防误复制保护。");
      }}
      onCut={(event) => {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setMessage("页面固定内容不可剪切或修改。");
      }}
      onDragStart={(event) => {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
      }}
      onContextMenu={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest(
            ".brand-logo, .crop-image-shell",
          )
        ) {
          event.preventDefault();
          setMessage("为保护照片，图片区域已禁用右键复制与拖拽。");
        }
      }}
    >
      {duplicateNotice && (
        <section className="photo-finder-panel" role="dialog" aria-modal="false" aria-labelledby="duplicate-modal-title">
          <div className="photo-finder-heading">
            <h2 id="duplicate-modal-title">重复图片检查</h2>
            <button type="button" aria-label="关闭重复图片检查" onClick={() => setDuplicateNotice(false)} autoFocus>×</button>
          </div>
          <p>完全相同：{duplicates.length} 组（多余 {extraPhotoCount} 张）；名称疑似：{suspectedDuplicates.length} 组。点击序号定位，清理时保留每组第一张的尺寸、裁剪和打印份数。</p>
          <button type="button" disabled={!extraPhotoCount} onClick={() => removeDuplicates()}>一键消除完全相同图片（{extraPhotoCount}）</button>
          <button type="button" disabled={!undoDepth} onClick={undoLastAction}>撤销上一步</button>
          <div className="duplicate-results">
            {suspectedDuplicates.length > 0 && <p>另有 {suspectedDuplicates.length} 组原始名称相同、像素不同的疑似重复图。已忽略文件末尾的导出时间和复制编号，请核对画面后再清理。</p>}
            {suspectedDuplicates.map((group) => (
              <div className="duplicate-group" key={`suspected-${group[0].id}`}>
                <strong>疑似重复 · {originalPhotoName(group[0].name)}</strong>
                {group.map((photo) => (
                  <div key={photo.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="duplicate-preview" src={photo.previewSrc ?? photo.src} alt={photo.name} draggable={false} />
                    <span>{photo.name}{photo.id === group[0].id ? "（保留）" : ""}</span>
                    <small>{photo.naturalWidth} × {photo.naturalHeight} px</small>
                    {locations.filter((result) => result.photo.id === photo.id).map((result) => (
                      <button type="button" key={result.key} aria-pressed={activeResultKey === result.key} onClick={() => locatePhoto(result)}>
                        #{result.index + 1} · {result.label}
                      </button>
                    ))}
                  </div>
                ))}
                <button type="button" onClick={() => removeDuplicates(group)}>已核对：保留第一张，清理本组其余 {group.length - 1} 张</button>
              </div>
            ))}
            {duplicates.map((group) => (
              <div className="duplicate-group" key={group[0].id}>
                <strong>相同图片 · {group.length} 张</strong>
                {group.map((photo) => (
                  <div key={photo.id}>
                    <span>{photo.name}{photo.id === group[0].id ? "（保留）" : "（多余）"}</span>
                    {locations.filter((result) => result.photo.id === photo.id).map((result) => (
                      <button type="button" key={result.key} aria-pressed={activeResultKey === result.key} onClick={() => locatePhoto(result)}>
                        #{result.index + 1} · {result.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            {skippedDuplicates.length > 0 && (
              <div className="duplicate-group">
                <strong>本次已阻止导入 {skippedDuplicates.length} 张重复图片</strong>
                {skippedDuplicates.map((skipped, index) => (
                  <div key={index}>
                    <span>{skipped.name}（未加入版面）</span>
                    {locations.some((result) => result.photo.id === skipped.photoId)
                      ? locations.filter((result) => result.photo.id === skipped.photoId).map((result) => (
                        <button type="button" key={result.key} aria-pressed={activeResultKey === result.key} onClick={() => locatePhoto(result)}>
                          已有 #{result.index + 1} · {result.photo.name} · {result.label}
                        </button>
                      ))
                      : <small>对应图片已移除</small>}
                  </div>
                ))}
              </div>
            )}
            {!duplicates.length && !suspectedDuplicates.length && !skippedDuplicates.length && <p>未发现完全相同或原始名称相同的图片；名称不同的相似画面尚不识别。</p>}
          </div>
        </section>
      )}
      {cropEditor && cropPhoto && (
        <div
          className="crop-modal-layer"
          role="presentation"
          onMouseDown={() => setCropEditor(null)}
        >
          <section
            className="crop-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="crop-modal-title"
            aria-describedby="crop-modal-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="crop-modal-heading">
              <div>
                <span className="eyebrow">自由裁剪</span>
                <h2 id="crop-modal-title">{cropPhoto.name}</h2>
              </div>
              <button
                type="button"
                className="crop-modal-close"
                aria-label="关闭裁剪"
                onClick={() => setCropEditor(null)}
                autoFocus
              >
                ×
              </button>
            </div>
            <p id="crop-modal-description">
              拖动裁剪框可移动选区，拖动四角可自由改变裁剪范围。
            </p>
            <div className="crop-workspace">
              <div className="crop-image-shell">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cropPhoto.src}
                  alt={`裁剪 ${cropPhoto.name}`}
                  draggable={false}
                />
                <div
                  className="crop-selection"
                  style={{
                    left: `${cropEditor.draft.x * 100}%`,
                    top: `${cropEditor.draft.y * 100}%`,
                    width: `${cropEditor.draft.width * 100}%`,
                    height: `${cropEditor.draft.height * 100}%`,
                  }}
                  onPointerDown={(event) => beginCropDrag(event, "move")}
                >
                  {(["nw", "ne", "sw", "se"] as ResizeCorner[]).map(
                    (corner) => (
                      <button
                        type="button"
                        className={`crop-handle ${corner}`}
                        key={corner}
                        aria-label={`拖动${corner}角裁剪`}
                        onPointerDown={(event) =>
                          beginCropDrag(event, corner)
                        }
                      />
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="crop-modal-actions">
              <button
                type="button"
                className="crop-reset-button"
                onClick={() =>
                  setCropEditor((current) =>
                    current
                      ? {
                          ...current,
                          draft: { x: 0, y: 0, width: 1, height: 1 },
                        }
                      : current,
                  )
                }
              >
                恢复原图
              </button>
              <span />
              <button type="button" onClick={() => setCropEditor(null)}>
                取消
              </button>
              <button
                type="button"
                className="crop-apply-button"
                onClick={applyCrop}
              >
                应用裁剪
              </button>
            </div>
          </section>
        </div>
      )}
      {showSizeReference && (
        <div
          className="size-reference-layer"
          role="presentation"
          onMouseDown={() => setShowSizeReference(false)}
        >
          <section
            className="size-reference-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="size-reference-title"
            aria-describedby="size-reference-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="size-reference-heading">
              <div>
                <span className="eyebrow">真实比例参考</span>
                <h2 id="size-reference-title">纸张到底有多大？</h2>
                <p id="size-reference-description">
                  选择纸张和身边物品，图形会按照同一比例展示。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭纸张大小参考"
                onClick={() => setShowSizeReference(false)}
                autoFocus
              >
                ×
              </button>
            </div>

            <div className="reference-paper-tabs" aria-label="选择纸张规格">
              {(
                Object.entries(PAPER_SIZES) as Array<
                  [PaperSizeKey, (typeof PAPER_SIZES)[PaperSizeKey]]
                >
              ).map(([key, size]) => (
                <button
                  type="button"
                  className={referencePaperKey === key ? "is-active" : ""}
                  aria-pressed={referencePaperKey === key}
                  key={key}
                  onClick={() => setReferencePaperKey(key)}
                >
                  <strong>{size.label}</strong>
                  <small>
                    {size.width} × {size.height} mm
                  </small>
                </button>
              ))}
            </div>

            <div className="reference-object-tabs" aria-label="选择参照物">
              {SIZE_REFERENCES.map((item) => (
                <button
                  type="button"
                  className={
                    referenceObject.key === item.key ? "is-active" : ""
                  }
                  aria-pressed={referenceObject.key === item.key}
                  key={item.key}
                  onClick={() => setReferenceObjectKey(item.key)}
                >
                  <span
                    className={`reference-object-icon ${item.shape}`}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {item.width} × {item.height} mm
                    </small>
                  </span>
                </button>
              ))}
            </div>

            <div className="reference-comparison">
              <div className="reference-stage-wrap">
                <div
                  className="reference-stage"
                  style={{
                    aspectRatio: `${referenceStageWidth} / ${referenceStageHeight}`,
                    maxWidth: `${
                      (referenceStageWidth / referenceStageHeight) * 390
                    }px`,
                  }}
                >
                  <div
                    className="reference-paper-shape"
                    style={{
                      width: `${
                        (referencePaper.width / referenceStageWidth) * 100
                      }%`,
                      height: `${
                        (referencePaper.height / referenceStageHeight) * 100
                      }%`,
                    }}
                  >
                    <strong>{referencePaper.label}</strong>
                    <span className="reference-width-label">
                      宽 {referencePaper.width} mm
                    </span>
                    <span className="reference-height-label">
                      高 {referencePaper.height} mm
                    </span>
                  </div>
                  <div
                    className={`reference-object-shape ${referenceObject.shape}`}
                    role="img"
                    aria-label={`${referenceObject.label}，${referenceObject.width} × ${referenceObject.height} 毫米`}
                    style={{
                      left: `${
                        ((referencePaper.width + referenceGapMm) /
                          referenceStageWidth) *
                        100
                      }%`,
                      width: `${
                        (referenceObject.width / referenceStageWidth) * 100
                      }%`,
                      height: `${
                        (referenceObject.height / referenceStageHeight) * 100
                      }%`,
                    }}
                  >
                    <span>{referenceObject.label}</span>
                  </div>
                </div>
              </div>

              <div className="reference-readout">
                <span className="eyebrow">当前对比</span>
                <h3>
                  {referencePaper.label} 与 {referenceObject.label}
                </h3>
                <div className="reference-edge-cards">
                  <div>
                    <small>纸张宽度</small>
                    <strong>{referencePaper.width} mm</strong>
                    <span>
                      约{" "}
                      {formatReferenceCount(
                        referencePaper.width / referenceObjectLongEdge,
                      )}{" "}
                      个参照物长边
                    </span>
                  </div>
                  <div>
                    <small>纸张高度</small>
                    <strong>{referencePaper.height} mm</strong>
                    <span>
                      约{" "}
                      {formatReferenceCount(
                        referencePaper.height / referenceObjectLongEdge,
                      )}{" "}
                      个参照物长边
                    </span>
                  </div>
                </div>
                <p>
                  {referenceObject.label}：{referenceObject.width} ×{" "}
                  {referenceObject.height} mm · {referenceObject.note}
                </p>
                <small className="reference-disclaimer">
                  中性笔、课本、海绵和纸巾包会因品牌与型号不同而有偏差，仅用于建立直观尺度。
                </small>
              </div>
            </div>
          </section>
        </div>
      )}
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-identity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="brand-logo"
              src="/brand-logo-v3.png"
              alt="月末拾光"
              draggable={false}
            />
            <h1 className="visually-hidden">月末拾光</h1>
            <p>把值得纪念的照片，刚刚好地放进纸张里。</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="settings-menu">
            <button type="button" className="feedback-link" aria-expanded={showSettings} aria-controls="photo-settings" onClick={() => setShowSettings(!showSettings)}>设置</button>
            {showSettings && <section id="photo-settings" className="settings-popover" aria-label="排版设置" onKeyDown={(event) => { if (event.key === "Escape") setShowSettings(false); }}>
              <label><input type="checkbox" checked={!settings.allowRotation} onChange={(event) => updateSetting("allowRotation", !event.target.checked)} />不允许图片自动旋转</label>
              <small>保留上传时的朝向；手动旋转仍由你控制。</small>
              <label><input type="checkbox" checked={!!settings.strictColumns} onChange={(event) => updateSetting("strictColumns", event.target.checked)} />开启严格分栏</label>
              {settings.strictColumns && <label>每页栏数<select value={settings.columns ?? 2} onChange={(event) => updateSetting("columns", Number(event.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} 栏</option>)}</select></label>}
              <small>照片在各栏居中、按行对齐；过宽时提示调整尺寸。</small>
              <label><input type="checkbox" checked={!!settings.sortingEnabled} onChange={(event) => updateSetting("sortingEnabled", event.target.checked)} />开启排序筛选</label>
              <small>在左侧选择时间或地点；预览与 PDF 同步按顺序排列。</small>
              <button type="button" onClick={() => setShowSettings(false)}>收起设置</button>
            </section>}
          </div>
          <button type="button" className="feedback-link" aria-haspopup="dialog" onClick={() => setDuplicateNotice(true)}>
            重复检查{extraPhotoCount + suspectedDuplicates.length > 0 ? `（${extraPhotoCount} 张相同 · ${suspectedDuplicates.length} 组疑似）` : ""}
          </button>
          <a
            className="feedback-link"
            href="https://github.com/dawwnforu/month-end-memories/issues/new?template=feedback.yml"
            target="_blank"
            rel="noreferrer"
          >
            <span aria-hidden="true">?</span>
            问题反馈
          </a>
          <div
            className="privacy-note"
            title="原图留在本机；拍摄时间、GPS、文件名和排版参数保存到当前工作区数据库"
          >
            <span aria-hidden="true">●</span>
            原图留在本机
          </div>
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

            <label className="switch-row duplicate-policy-row">
              <span>
                <strong>是否允许图片重复</strong>
                <small>
                  {allowDuplicateImages
                    ? "是：相同图片会分别加入，不显示重复提醒"
                    : "否：不允许重复图片，并保留重复数量提醒"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={allowDuplicateImages}
                aria-label="是否允许图片重复"
                onChange={(event) => {
                  const allowed = event.target.checked;
                  setAllowDuplicateImages(allowed);
                  if (allowed) setDuplicateNotice(false);
                  setMessage(
                    allowed
                      ? "已允许重复图片，再次导入相同照片时不会提醒。"
                      : "已禁止重复图片，导入时会检测并提醒重复项。",
                  );
                }}
              />
              <span className="switch" aria-hidden="true" />
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

                <div className="photo-search" role="search" aria-label="图片名称搜索">
                  <label htmlFor="photo-search">查找图片</label>
                  <input id="photo-search" type="search" placeholder="输入图片名称…"
                    value={photoQuery} onChange={(event) => { setPhotoQuery(event.target.value); setActiveResultKey(null); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); moveSearchResult(event.shiftKey ? -1 : 1); }
                      if (event.key === "Escape") { setPhotoQuery(""); setActiveResultKey(null); }
                    }} />
                  <div className="photo-search-actions">
                    <span role="status">{photoQuery.trim() ? `${activeResultIndex + 1} / ${searchResults.length} 个位置` : "按名称查找，Enter 跳到下一处"}</span>
                    <button type="button" disabled={!searchResults.length} aria-label="上一个查找结果" onClick={() => moveSearchResult(-1)}>↑</button>
                    <button type="button" disabled={!searchResults.length} aria-label="下一个查找结果" onClick={() => moveSearchResult(1)}>↓</button>
                  </div>
                  {!!photoQuery.trim() && !searchResults.length && <p>没有找到匹配的图片</p>}
                  {!!searchResults.length && <div className="photo-search-results">
                    {searchResults.map((result) => <button type="button" key={result.key} aria-pressed={activeResultKey === result.key} onClick={() => locatePhoto(result)}>
                      #{result.index + 1} · {result.photo.name} · {result.label}
                    </button>)}
                  </div>}
                  <button type="button" onClick={() => setDuplicateNotice(true)}>检查重复图片（{extraPhotoCount} 张相同 · {suspectedDuplicates.length} 组疑似）</button>
                </div>
                <div className="batch-tools" aria-label="照片批量操作">
                  <small role="status">{databaseStatus} · 原图不入库</small>
                  <div className="batch-buttons"><strong aria-live="polite">已选 {selectedPhotos.length} 张</strong><button type="button" onClick={() => setSelectedIds(photos.map((photo) => photo.id))}>全选</button><button type="button" onClick={() => setSelectedIds([])}>取消选择</button></div>
                  <small>勾选左侧方框，或按住 Ctrl / ⌘ 点击照片多选。</small>
                  {settings.sortingEnabled && <>
                    <label>排序分类<select aria-label="照片排序分类" value={settings.photoOrder ?? "import"} onChange={(event) => updateSetting("photoOrder", event.target.value as PhotoOrder)}><option value="import">导入顺序</option><option value="oldest">拍摄时间升序</option><option value="newest">拍摄时间降序</option><option value="location">按拍摄地点分类</option><option value="smart">智能：同日相近时间、同地点优先</option></select></label>
                    <label>同地点范围<select value={settings.locationRadius ?? 100} onChange={(event) => updateSetting("locationRadius", Number(event.target.value))}>{[30, 100, 300, 1000].map((n) => <option key={n} value={n}>{n} 米</option>)}</select></label>
                    <label>相近时间<select value={settings.timeWindow ?? 3} onChange={(event) => updateSetting("timeWindow", Number(event.target.value))}>{[1, 3, 6, 12].map((n) => <option key={n} value={n}>{n} 小时内</option>)}</select></label>
                    <small>地点按 GPS 距离归组，缺失元数据不推测。智能分类把同一天、时间范围内的 A→B→A 排为 A→A→B。</small>
                  </>}
                  <label className="batch-check"><input type="checkbox" checked={groupByDate} onChange={(event) => setGroupByDate(event.target.checked)} />保存原图时按拍摄日期分文件夹</label>
                  <div className="batch-buttons">
                    <button type="button" disabled={!selectedPhotos.length || isExporting} onClick={() => void exportPdf(selectedPhotos)}>导出所选 PDF</button>
                    <button type="button" disabled={!selectedPhotos.length || batchBusy} onClick={() => void saveOriginals(false)}>下载所选原图 ZIP</button>
                    <button type="button" disabled={!selectedPhotos.length || batchBusy} onClick={() => void saveOriginals(true)}>另存为文件夹</button>
                    <button type="button" disabled={!selectedPhotos.length || batchBusy} onClick={() => void shareOriginals()}>分享所选原图</button>
                    <button type="button" disabled={!selectedPhotos.length} data-notebook-selection>在我的本子上预览所选</button>
                  </div>
                </div>
                <div className="photo-list">
                  {listedPhotos.map(({ photo, index }) => (
                    <article
                      data-photo-id={photo.id}
                      id={`photo-card-${photo.id}`}
                      className={`photo-card ${selectedIds.includes(photo.id) ? "is-batch-selected" : ""} ${matchedPhotoIds.has(photo.id) ? "is-search-match" : ""} ${
                        selectedPlacementKey?.startsWith(`${photo.id}-`) || activeResultKey === `unplaced-${photo.id}`
                          ? "is-selected"
                          : ""
                      }`}
                      key={photo.id}
                      onClick={(event) => { if ((event.ctrlKey || event.metaKey) && !(event.target as HTMLElement).closest("button,input,select")) togglePhoto(photo.id); }}
                    >
                      <input className="photo-checkbox" type="checkbox" aria-label={"多选 " + photo.name} checked={selectedIds.includes(photo.id)} onChange={() => togglePhoto(photo.id)} />
                      <div className="photo-thumb">
                        <div
                          className="photo-thumb-image"
                          role="img"
                          aria-label={photo.name}
                          style={cropBackgroundStyle(photo)}
                        />
                        <span>{String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <div className="photo-fields">
                        <div className="photo-title-row">
                          <div>
                            <strong title={photo.name}>{photo.name}</strong>
                            <small>
                              {photo.naturalWidth} × {photo.naturalHeight} px
                            </small>
                            <small>拍摄：{photo.takenAt?.replace("T", " ") || "日期未知"}</small>
                            <small>地点：{photo.latitude != null && photo.longitude != null ? `${photo.latitude.toFixed(4)}, ${photo.longitude.toFixed(4)}` : "地点未知"}</small>
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
                          <button
                            type="button"
                            className={`dimension-link ${
                              photo.lockAspectRatio ? "is-locked" : ""
                            }`}
                            aria-label={
                              photo.lockAspectRatio
                                ? `解除 ${photo.name} 的宽高比例锁定`
                                : `锁定 ${photo.name} 的宽高比例`
                            }
                            title={
                              photo.lockAspectRatio
                                ? "已锁定比例，点击后可自由调整宽高"
                                : "自由尺寸，点击恢复等比例缩放"
                            }
                            onClick={() => toggleAspectLock(photo.id)}
                          >
                            {photo.lockAspectRatio ? "∞" : "↔"}
                          </button>
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
                        <div className="photo-edit-actions">
                          <button type="button" data-notebook-open={photo.id}>在我的本子上预览</button>
                          <button
                            type="button"
                            onClick={() => openCropEditor(photo.id)}
                          >
                            ✂ 自由裁剪
                          </button>
                          <button
                            type="button"
                            className={
                              photo.lockAspectRatio ? "" : "is-active"
                            }
                            onClick={() => toggleAspectLock(photo.id)}
                          >
                            {photo.lockAspectRatio
                              ? "🔗 等比例"
                              : "↔ 自由尺寸"}
                          </button>
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
                <h2>纸张排版规则</h2>
              </div>
            </div>

            <label className="paper-size-field">
              <span>
                <strong>纸张规格</strong>
                <small>预览、排版与 PDF 会同步切换</small>
              </span>
              <select
                value={settings.paperSize}
                onChange={(event) =>
                  updateSetting(
                    "paperSize",
                    event.target.value as PaperSizeKey,
                  )
                }
              >
                {(
                  Object.entries(PAPER_SIZES) as Array<
                    [
                      PaperSizeKey,
                      (typeof PAPER_SIZES)[PaperSizeKey],
                    ]
                  >
                ).map(([key, size]) => (
                  <option key={key} value={key}>
                    {size.label} · {size.width} × {size.height} mm
                  </option>
                ))}
              </select>
            </label>

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

          </section>

          <section className="panel-section size-reference-entry">
            <span className="eyebrow">纸张实感</span>
            <h2>不清楚真实纸张大小？</h2>
            <p>
              用中性笔、手机、鼠标、充电器、课本或海绵，对照所有可用纸张规格。
            </p>
            <button
              type="button"
              onClick={() => {
                setReferencePaperKey(settings.paperSize);
                setShowSizeReference(true);
              }}
            >
              查看真实比例参考图
              <span aria-hidden="true">→</span>
            </button>
          </section>
        </aside>

        <section className="preview-panel">
          <div className="preview-header">
            <div className="preview-heading">
              <span className="eyebrow">03 · 自动排版</span>
              <h2>{paper.label} 打印预览</h2>
              <p className="preview-instruction">
                点击照片拖动四角缩放；解除比例锁定后可自由改变宽高
              </p>
              <div className="shortcut-actions">
                <button
                  type="button"
                  onClick={undoLastAction}
                  disabled={undoDepth === 0}
                  title="撤销上一步（Ctrl/⌘ + Z）"
                >
                  ↶ 撤销
                </button>
                <details
                  className="shortcut-disclosure"
                  ref={shortcutDetailsRef}
                >
                  <summary title="查看快捷键（?）">
                    <span className="shortcut-question" aria-hidden="true">
                      ?
                    </span>
                    快捷键
                  </summary>
                  <div className="shortcut-dropdown">
                    <p>先选中照片，再使用快捷键：</p>
                    <dl>
                      <div>
                        <dt><kbd>Delete</kbd><span>/</span><kbd>Backspace</kbd></dt>
                        <dd>删除照片</dd>
                      </div>
                      <div><dt><kbd>＋</kbd></dt><dd>放大 1 mm</dd></div>
                      <div><dt><kbd>－</kbd></dt><dd>缩小 1 mm</dd></div>
                      <div><dt><kbd>R</kbd></dt><dd>旋转 90°</dd></div>
                      <div>
                        <dt><kbd>Ctrl/⌘</kbd><span>＋</span><kbd>Z</kbd></dt>
                        <dd>撤销</dd>
                      </div>
                      <div><dt><kbd>Esc</kbd></dt><dd>取消选择</dd></div>
                      <div><dt><kbd>?</kbd></dt><dd>开关提示</dd></div>
                    </dl>
                    <small>
                      输入尺寸、份数、边距或缝隙时，快捷键会自动停用。
                    </small>
                  </div>
                </details>
              </div>
            </div>
            <div className="layout-stats">
              <div>
                <strong>{totalCopies}</strong>
                <span>张照片</span>
              </div>
              <div>
                <strong>{layout.pages.length || "—"}</strong>
                <span>{paper.label} 页</span>
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
                  <span>
                    {paper.width} × {paper.height} mm
                  </span>
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div>
                  <strong>先导入几张照片吧</strong>
                  <p>
                    设置尺寸后，照片会自动旋转、重排并尽量塞进更少的{" "}
                    {paper.label} 纸。
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
                      onPointerDown={() => setSelectedPlacementKey(null)}
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
                        const isSelected =
                          selectedPlacementKey === placement.key;
                        const totalTurns =
                          (photo.rotationTurns +
                            (placement.rotated ? 1 : 0)) %
                          4;
                        const isQuarterTurn =
                          totalTurns === 1 || totalTurns === 3;
                        return (
                          <div
                            data-photo-id={photo.id}
                            id={`placement-${placement.key}`}
                            className={`placed-photo ${selectedIds.includes(photo.id) ? "is-batch-selected" : ""} ${matchedPhotoIds.has(photo.id) ? "is-search-match" : ""} ${
                              isSelected ? "is-selected" : ""
                            } ${
                              resizeDraft?.key === placement.key
                                ? "is-resizing"
                                : ""
                            }`}
                            key={placement.key}
                            role="button"
                            tabIndex={0}
                            aria-label={`选择并缩放 ${photo.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (event.ctrlKey || event.metaKey) togglePhoto(photo.id);
                              else setSelectedPlacementKey(placement.key);
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" ||
                                event.key === " "
                              ) {
                                event.preventDefault();
                                if (event.ctrlKey || event.metaKey) togglePhoto(photo.id);
                                else setSelectedPlacementKey(placement.key);
                              }
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
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
                            <div
                              className={`placed-photo-image turn-${totalTurns}`}
                              role="img"
                              aria-label={photo.name}
                              style={{
                                ...cropBackgroundStyle(photo),
                                ...(isQuarterTurn
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
                                  : {}),
                              }}
                            />
                            {isSelected && (
                              <button
                                type="button"
                                className="crop-button"
                                aria-label={`自由裁剪 ${photo.name}`}
                                title="自由裁剪"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openCropEditor(photo.id);
                                }}
                                onPointerDown={(event) =>
                                  event.stopPropagation()
                                }
                              >
                                ✂
                              </button>
                            )}
                            <button
                              type="button"
                              className="rotation-button"
                              aria-label={`将 ${photo.name} 顺时针旋转 90 度`}
                              title="顺时针旋转 90°"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPlacementKey(placement.key);
                                rotatePhoto(photo.id);
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              ↻
                            </button>
                            {isSelected && (
                              <>
                                <span className="direct-size-badge">
                                  {roundMm(photo.widthMm)} ×{" "}
                                  {roundMm(photo.heightMm)} mm
                                  {photo.lockAspectRatio ? "" : " · 自由尺寸"}
                                </span>
                                {(
                                  ["nw", "ne", "sw", "se"] as ResizeCorner[]
                                ).map((corner) => (
                                  <button
                                    type="button"
                                    className={`resize-handle ${corner}`}
                                    key={corner}
                                    aria-label={`从${corner}角缩放 ${photo.name}`}
                                    onPointerDown={(event) =>
                                      beginDirectResize(
                                        event,
                                        photo,
                                        placement,
                                        corner,
                                      )
                                    }
                                  />
                                ))}
                              </>
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

          {resizeHint && (
            <div
              className="floating-resize-hint"
              style={{ left: resizeHint.x, top: resizeHint.y }}
            >
              {resizeHint.text}
            </div>
          )}

          {layout.unplaced.length > 0 && (
            <div className="warning-banner" role="alert">
              有 {layout.unplaced.length} 张照片超过当前{paper.label}{settings.strictColumns ? "栏宽或页面高度" : "可用范围"}，请调小照片{settings.strictColumns ? "或减少栏数" : "或边距"}后再导出。
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
    </NotebookPreview>
  );
}
