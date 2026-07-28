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

type Photo = {
  id: string;
  name: string;
  src: string;
  fingerprint: string;
  ratio: number;
  rotationTurns: number;
  manualRotation: boolean;
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

async function fingerprintFile(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
  const [settings, setSettings] = useState<Settings>({
    orientation: "portrait",
    margin: 5,
    gap: 2,
    allowRotation: true,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicateNotice, setDuplicateNotice] = useState<{
    count: number;
  } | null>(null);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
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
  const knownFingerprints = useRef(new Map<string, number>());
  const isImporting = useRef(false);
  const undoHistory = useRef<UndoSnapshot[]>([]);
  const photosRef = useRef(photos);
  const settingsRef = useRef(settings);
  const selectedPlacementKeyRef = useRef(selectedPlacementKey);

  useEffect(() => {
    photosRef.current = photos;
    settingsRef.current = settings;
    selectedPlacementKeyRef.current = selectedPlacementKey;
  }, [photos, settings, selectedPlacementKey]);

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

  function rebuildKnownFingerprints(nextPhotos: Photo[]) {
    const nextFingerprints = new Map<string, number>();
    nextPhotos.forEach((photo) => {
      nextFingerprints.set(
        photo.fingerprint,
        (nextFingerprints.get(photo.fingerprint) ?? 0) + 1,
      );
      objectUrls.current.add(photo.src);
    });
    knownFingerprints.current = nextFingerprints;
  }

  function rememberForUndo() {
    undoHistory.current.push({
      photos: photosRef.current.map((photo) => ({ ...photo })),
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
    rebuildKnownFingerprints(snapshot.photos);
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
    setMessage("正在检查照片是否重复…");

    try {
      const fingerprintedFiles = await Promise.all(
        files.map(async (file) => ({
          file,
          fingerprint: await fingerprintFile(file),
        })),
      );
      const incomingCounts = fingerprintedFiles.reduce(
        (counts, { fingerprint }) => {
          counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
          return counts;
        },
        new Map<string, number>(),
      );
      const acceptedFingerprints = new Set<string>();
      const duplicateGroupTotals: number[] = [];
      const uniqueFiles = fingerprintedFiles.filter(({ fingerprint }) => {
        const existingCount = knownFingerprints.current.get(fingerprint) ?? 0;
        const isDuplicate =
          existingCount > 0 || acceptedFingerprints.has(fingerprint);

        if (isDuplicate) {
          duplicateGroupTotals.push(
            existingCount + (incomingCounts.get(fingerprint) ?? 0),
          );
          return false;
        }

        acceptedFingerprints.add(fingerprint);
        return true;
      });

      if (duplicateGroupTotals.length > 0) {
        setDuplicateNotice({
          count: Math.max(...duplicateGroupTotals),
        });
      }

      const loaded = await Promise.all(
        uniqueFiles.map(
          ({ file, fingerprint }) =>
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
                fingerprint,
                ratio,
                rotationTurns: 0,
                manualRotation: false,
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
      if (validPhotos.length > 0) {
        rememberForUndo();
      }
      validPhotos.forEach((photo) => {
        knownFingerprints.current.set(
          photo.fingerprint,
          (knownFingerprints.current.get(photo.fingerprint) ?? 0) + 1,
        );
      });
      setPhotos((current) => [...current, ...validPhotos]);

      const duplicateCount = files.length - uniqueFiles.length;
      const unreadableCount = uniqueFiles.length - validPhotos.length;
      if (validPhotos.length === 0 && duplicateCount > 0 && unreadableCount === 0) {
        setMessage(`已跳过 ${duplicateCount} 张重复照片。`);
      } else if (duplicateCount > 0 || unreadableCount > 0) {
        setMessage(
          `已加入 ${validPhotos.length} 张，跳过 ${duplicateCount} 张重复照片${
            unreadableCount > 0 ? `，另有 ${unreadableCount} 张无法读取` : ""
          }。`,
        );
      } else {
        setMessage(
          `已加入 ${validPhotos.length} 张照片，正在重新计算最省纸排法。`,
        );
      }
    } catch {
      setMessage("图片重复检查失败，请重新选择。");
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
    setPhotos((current) => {
      knownFingerprints.current.delete(target.fingerprint);
      return current.filter((photo) => photo.id !== photoId);
    });
    setMessage(`已删除 ${target.name}，可按 Ctrl/⌘ + Z 撤销。`);
  }

  function clearPhotos() {
    if (!photosRef.current.length) return;
    rememberForUndo();
    knownFingerprints.current.clear();
    setPhotos([]);
    setSelectedPlacementKey(null);
    setMessage("已清空照片，可按 Ctrl/⌘ + Z 撤销。");
  }

  function applyLongEdge(longEdge: number) {
    if (!photosRef.current.length) return;
    rememberForUndo();
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
      const currentDistance = Math.hypot(
        moveEvent.clientX - opposite.x,
        moveEvent.clientY - opposite.y,
      );
      const scale = Math.max(
        minScale,
        Math.min(maxScale, currentDistance / startDistance),
      );
      const widthMm = roundMm(startWidth * scale);
      const heightMm = roundMm(startHeight * scale);
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

      if (duplicateNotice) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDuplicateNotice(null);
        }
        return;
      }

      if (showShortcutHelp) {
        if (event.key === "Escape" || event.key === "?") {
          event.preventDefault();
          setShowShortcutHelp(false);
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
        setShowShortcutHelp(true);
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

          const width = placement.width * scale;
          const height = placement.height * scale;
          const totalTurns =
            (photo.rotationTurns + (placement.rotated ? 1 : 0)) % 4;

          context.save();
          context.translate(x, y);
          if (totalTurns === 1) {
            context.translate(width, 0);
            context.rotate(Math.PI / 2);
            context.drawImage(image, 0, 0, height, width);
          } else if (totalTurns === 2) {
            context.translate(width, height);
            context.rotate(Math.PI);
            context.drawImage(image, 0, 0, width, height);
          } else if (totalTurns === 3) {
            context.translate(0, height);
            context.rotate(-Math.PI / 2);
            context.drawImage(image, 0, 0, height, width);
          } else {
            context.drawImage(image, 0, 0, width, height);
          }
          context.restore();
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
      {duplicateNotice && (
        <div
          className="duplicate-modal-layer"
          role="presentation"
          onMouseDown={() => setDuplicateNotice(null)}
        >
          <section
            className="duplicate-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-modal-title"
            aria-describedby="duplicate-modal-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="duplicate-modal-mark" aria-hidden="true">
              !
            </span>
            <h2 id="duplicate-modal-title">检测到客官上传了重复图片</h2>
            <p id="duplicate-modal-description">
              此图片已存在（共{duplicateNotice.count}张）
            </p>
            <button
              type="button"
              onClick={() => setDuplicateNotice(null)}
              autoFocus
            >
              知道了
            </button>
          </section>
        </div>
      )}
      {showShortcutHelp && (
        <div
          className="shortcut-modal-layer"
          role="presentation"
          onMouseDown={() => setShowShortcutHelp(false)}
        >
          <section
            className="shortcut-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcut-modal-title"
            aria-describedby="shortcut-modal-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="shortcut-modal-heading">
              <div>
                <span className="eyebrow">键盘操作</span>
                <h2 id="shortcut-modal-title">快捷键帮助</h2>
              </div>
              <button
                type="button"
                className="shortcut-modal-close"
                aria-label="关闭快捷键帮助"
                onClick={() => setShowShortcutHelp(false)}
                autoFocus
              >
                ×
              </button>
            </div>
            <p id="shortcut-modal-description">
              先在 A4 预览中选中照片，再使用下列快捷键。
            </p>
            <dl className="shortcut-list">
              <div>
                <dt><kbd>Delete</kbd><kbd>Backspace</kbd></dt>
                <dd>删除选中照片</dd>
              </div>
              <div>
                <dt><kbd>＋</kbd></dt>
                <dd>长边增加 1 mm</dd>
              </div>
              <div>
                <dt><kbd>－</kbd></dt>
                <dd>长边减少 1 mm</dd>
              </div>
              <div>
                <dt><kbd>R</kbd></dt>
                <dd>顺时针旋转 90°</dd>
              </div>
              <div>
                <dt><kbd>Ctrl</kbd><span>/</span><kbd>⌘</kbd><span>＋</span><kbd>Z</kbd></dt>
                <dd>撤销上一步</dd>
              </div>
              <div>
                <dt><kbd>Esc</kbd></dt>
                <dd>取消选择或关闭帮助</dd>
              </div>
              <div>
                <dt><kbd>?</kbd></dt>
                <dd>打开或关闭本帮助</dd>
              </div>
            </dl>
            <div className="shortcut-safety-note">
              宽、高、份数、边距或缝隙输入框获得焦点时，所有页面快捷键都会自动停用。
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
            />
            <h1 className="visually-hidden">月末拾光</h1>
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
                    <article
                      className={`photo-card ${
                        selectedPlacementKey?.startsWith(`${photo.id}-`)
                          ? "is-selected"
                          : ""
                      }`}
                      key={photo.id}
                    >
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
            <div className="preview-heading">
              <span className="eyebrow">03 · 自动排版</span>
              <h2>A4 打印预览</h2>
              <p className="preview-instruction">
                点击照片，拖动四角控制点即可等比例缩放
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
                <button
                  type="button"
                  onClick={() => setShowShortcutHelp(true)}
                  title="查看快捷键（?）"
                >
                  ⌨ 快捷键
                </button>
              </div>
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
                            className={`placed-photo ${
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
                              setSelectedPlacementKey(placement.key);
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" ||
                                event.key === " "
                              ) {
                                event.preventDefault();
                                setSelectedPlacementKey(placement.key);
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
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.src}
                              alt={photo.name}
                              className={`turn-${totalTurns}`}
                              style={
                                isQuarterTurn
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
