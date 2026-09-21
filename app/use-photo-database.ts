"use client";

import { useEffect, useRef, useState } from "react";
import type { Photo } from "./page";

export function usePhotoDatabase(photos: Photo[]) {
  const [status, setStatus] = useState("等待导入照片");
  const token = useRef("");
  const started = useRef(false);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (!photos.length && !started.current) return;
    started.current = true;
    if (!token.current) {
      token.current = sessionStorage.getItem("photo-workspace") || Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) => v.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem("photo-workspace", token.current);
    }
    const timer = setTimeout(() => {
      const records = photos.map((p) => ({ id: p.id, name: p.name, fingerprint: p.fingerprint, takenAt: p.takenAt ?? null, latitude: p.latitude ?? null, longitude: p.longitude ?? null, naturalWidth: p.naturalWidth, naturalHeight: p.naturalHeight, widthMm: p.widthMm, heightMm: p.heightMm, quantity: p.quantity, edits: JSON.stringify({ rotationTurns: p.rotationTurns, manualRotation: p.manualRotation, crop: p.crop, lockAspectRatio: p.lockAspectRatio }) }));
      queue.current = queue.current.then(async () => {
        setStatus("正在保存照片索引…");
        try {
          const response = await fetch("/api/photos", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.current}` }, body: JSON.stringify(records) });
          if (!response.ok) throw new Error("save failed");
          setStatus(`已保存 ${records.length} 条照片索引`);
        } catch { setStatus("照片索引未保存；本机排版仍可使用，下一次编辑将重试"); }
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [photos]);
  return status;
}
