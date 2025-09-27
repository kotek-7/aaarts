"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MetObject = {
  primaryImage?: string;
  primaryImageSmall?: string;
  title?: string;
  artistDisplayName?: string;
  objectDate?: string;
};

const MET = {
  search:
    "https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&isPublicDomain=true&q=painting",
  object: (id: number) => `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
};

export default function MasterpiecesSlideshow() {
  const idsRef = useRef<number[]>([]);
  const timerRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    title: string;
    artist: string;
    date: string;
  } | null>(null);
  const [isFS, setIsFS] = useState(false);

  // ズーム・パン制御
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const scaleRef = useRef(1);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: typeof window !== "undefined" ? window.innerWidth : 0,
    h: typeof window !== "undefined" ? window.innerHeight : 0,
  });
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    offsetXRef.current = offsetX;
  }, [offsetX]);
  useEffect(() => {
    offsetYRef.current = offsetY;
  }, [offsetY]);

  // ビューポートサイズの追跡（フルスクリーンやウィンドウサイズ変更に対応）
  useEffect(() => {
    const onResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const ensureIds = useCallback(async () => {
    if (idsRef.current.length) return;
    const r = await fetch(MET.search, { cache: "no-store" });
    const j = (await r.json()) as { objectIDs?: number[] };
    idsRef.current = j.objectIDs ?? [];
  }, []);

  const pick = useCallback((n = 1) => {
    const arr = idsRef.current;
    if (!arr.length) return [] as number[];
    return Array.from({ length: n }, () => arr[(Math.random() * arr.length) | 0]);
  }, []);

  const loadOne = useCallback(async () => {
    try {
      await ensureIds();
      if (!idsRef.current.length) return;

      const candidates = await Promise.all(
        pick(5).map(async (id) => {
          try {
            const r = await fetch(MET.object(id), { cache: "no-store" });
            const o = (await r.json()) as MetObject;
            return o.primaryImage || o.primaryImageSmall ? o : null;
          } catch {
            return null;
          }
        }),
      );

      const o = candidates.find(Boolean) as MetObject | null;
      if (!o) return;

      const src = o.primaryImage || o.primaryImageSmall || null;
      if (!src) return;

      setImgSrc(src);
      setMeta({
        title: o.title || "Untitled",
        artist: o.artistDisplayName || "Unknown",
        date: o.objectDate || "",
      });
      // 初回ロード完了
      // 新しい画像に切り替わったらズーム・パンをリセット
      setScale(1);
      setOffsetX(0);
      setOffsetY(0);
    } catch {
      // 失敗時は静かにスキップ（次の周期で再試行）
    }
  }, [ensureIds, pick]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadOne();
      if (!mounted) return;
      timerRef.current = window.setInterval(loadOne, 60_000);
    })();
    const onFSChange = () => setIsFS(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFSChange);
    return () => {
      mounted = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
      document.removeEventListener("fullscreenchange", onFSChange);
    };
  }, [loadOne]);

  const onToggleFS = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // フルスクリーン失敗は無視
    }
  }, []);

  const captionContent = useMemo(() => {
    if (!meta) return null;
    return (
      <>
        <b>{meta.title}</b> — {meta.artist}
        {meta.date ? ` (${meta.date})` : ""} · The Met
      </>
    );
  }, [meta]);

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  // 画像のベース表示サイズ（scale=1 のときの contain 結果）
  const baseSize = useMemo(() => {
    if (!naturalSize) return { w: viewportSize.w, h: viewportSize.h };
    const { w: cw, h: ch } = viewportSize;
    const k = Math.min(cw / naturalSize.w, ch / naturalSize.h);
    return { w: naturalSize.w * k, h: naturalSize.h * k };
  }, [naturalSize, viewportSize]);

  // パン範囲のクランプ
  const clampPanOffset = useCallback(
    (nextOffsetX: number, nextOffsetY: number, nextScale: number) => {
      const { w: cw, h: ch } = viewportSize;
      const contentW = baseSize.w * nextScale;
      const contentH = baseSize.h * nextScale;
      const maxX = Math.max(0, (contentW - cw) / 2);
      const maxY = Math.max(0, (contentH - ch) / 2);
      return {
        offsetX: clamp(nextOffsetX, -maxX, maxX),
        offsetY: clamp(nextOffsetY, -maxY, maxY),
      };
    },
    [baseSize, viewportSize],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const P = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      };
      const delta = -e.deltaY; // 上回しで拡大
      const factor = Math.exp(delta * 0.001);
      const scale0 = scaleRef.current;
      const scale1 = clamp(scale0 * factor, 1, 8);
      const ratio = scale1 / scale0;
      const offsetX0 = offsetXRef.current;
      const offsetY0 = offsetYRef.current;
      // カーソル位置を起点にズーム（translate は scale 後のピクセル量）
      // T1 = (1 - ratio) * P + ratio * T0
      let nextOffsetX = (1 - ratio) * P.x + ratio * offsetX0;
      let nextOffsetY = (1 - ratio) * P.y + ratio * offsetY0;
      if (scale1 === 1) {
        nextOffsetX = 0;
        nextOffsetY = 0;
      } else {
        const c = clampPanOffset(nextOffsetX, nextOffsetY, scale1);
        nextOffsetX = c.offsetX;
        nextOffsetY = c.offsetY;
      }
      setScale(scale1);
      setOffsetX(nextOffsetX);
      setOffsetY(nextOffsetY);
    },
    [clampPanOffset],
  );

  const dragState = useRef({ active: false, startX: 0, startY: 0, baseOffsetX: 0, baseOffsetY: 0 });
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (scaleRef.current <= 1) return; // 等倍ではパン無効
    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseOffsetX: offsetXRef.current,
      baseOffsetY: offsetYRef.current,
    };
    setDragging(true);
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {}
  }, []);
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLImageElement>) => {
      if (!dragState.current.active) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      const nextOffsetX = dragState.current.baseOffsetX + dx;
      const nextOffsetY = dragState.current.baseOffsetY + dy;
      const c = clampPanOffset(nextOffsetX, nextOffsetY, scaleRef.current);
      setOffsetX(c.offsetX);
      setOffsetY(c.offsetY);
    },
    [clampPanOffset],
  );
  const endDrag = useCallback((e?: React.PointerEvent<HTMLImageElement>) => {
    dragState.current.active = false;
    setDragging(false);
    try {
      if (e) (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {}
  }, []);

  return (
    <div>
      <div
        ref={wrapRef}
        className="sl-wrap select-none"
        onWheel={onWheel}
        style={{ overflow: "hidden", touchAction: "none" }}
      >
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={`sl-img ${dragging ? "dragging" : ""}`}
            ref={imgRef}
            src={imgSrc}
            alt="Masterpiece"
            draggable={false}
            style={{
              transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
              transformOrigin: "center center",
              cursor: scale <= 1 ? "default" : dragging ? "grabbing" : "grab",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
              }
            }}
          />
        ) : (
          <div style={{ color: "#aaa", fontSize: 14 }}>Loading…</div>
        )}
      </div>
      <div className="sl-caption">{captionContent}</div>
      <button className="sl-fsbtn" onClick={onToggleFS} aria-pressed={isFS}>
        ⛶ {isFS ? "Exit Fullscreen" : "Fullscreen"}
      </button>
    </div>
  );
}

