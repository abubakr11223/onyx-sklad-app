"use client";

// ТЗ №20 J (§11.3) — «Показать в интерьере»: камень в 3D-сцене.
//
//   • три сцены — кухня (столешница + фартук), ванная (стена + столешница
//     под раковину), холл (пол); простая геометрия в коде и базовые материалы,
//     без внешних моделей;
//   • текстура — превью 2048 px; натуральный масштаб: всё фото = одна плита
//     реального размера, плиты повторяются по поверхности (texture-scale.ts);
//   • вращение/масштаб пальцем или мышью (OrbitControls), смена сцены и камня
//     без перезагрузки страницы (текстуры кэшируются по id);
//   • режим шоу-рума — полный экран, крупные кнопки, список камней справа.
//
// three.js грузится динамически (отдельный чанк) — карточка /k не тяжелеет.
// Рендер по требованию: кадр рисуется, только пока что-то движется — планшет
// не греется, пока клиент смотрит.

import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { textureRepeat } from "@/lib/texture-scale";

export interface ViewerStone {
  textureId: string;
  code: string;
  name: string;
  detail: string | null;
  previewUrl: string;
  lengthCm: number | null;
  widthCm: number | null;
}

export type SceneKey = "kitchen" | "bath" | "hall";

export interface ViewerLabels {
  kitchen: string;
  bath: string;
  hall: string;
  loading: string;
  noWebgl: string;
  hint: string;
  stones: string;
  slab: string;
  fullscreen: string;
}

type Three = typeof import("three");

interface Engine {
  T: Three;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
  room: THREE.Group | null;
  /** Базовые текстуры камней (кэш на всё время жизни просмотра). */
  textures: Map<string, Promise<THREE.Texture>>;
  /** Геометрия, материалы и копии текстур ТЕКУЩЕЙ комнаты. */
  disposables: Array<{ dispose(): void }>;
  requestRender(): void;
}

const SCENE_KEYS: SceneKey[] = ["kitchen", "bath", "hall"];

/** Камера и точка обзора каждой сцены (метры). */
const VIEWS: Record<SceneKey, { pos: [number, number, number]; target: [number, number, number] }> = {
  kitchen: { pos: [1.6, 1.75, 2.6], target: [0, 0.95, -1.0] },
  bath: { pos: [1.2, 1.55, 2.2], target: [0, 1.1, -0.9] },
  hall: { pos: [3.2, 2.2, 3.6], target: [0, 0.2, 0] },
};

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Портретное фото → альбомное (ширина текстуры = длинная сторона плиты). */
function landscape(T: Three, img: HTMLImageElement | ImageBitmap): THREE.Texture {
  const w = img.width;
  const h = img.height;
  if (w >= h) {
    const t = new T.Texture(img as HTMLImageElement);
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement("canvas");
  c.width = h;
  c.height = w;
  const ctx = c.getContext("2d")!;
  ctx.translate(h, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const t = new T.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

function loadStoneTexture(e: Engine, stone: ViewerStone): Promise<THREE.Texture> {
  const hit = e.textures.get(stone.textureId);
  if (hit) return hit;
  const p = new Promise<THREE.Texture>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const t = landscape(e.T, img);
      t.colorSpace = e.T.SRGBColorSpace;
      t.wrapS = e.T.RepeatWrapping;
      t.wrapT = e.T.RepeatWrapping;
      t.anisotropy = Math.min(8, e.renderer.capabilities.getMaxAnisotropy());
      resolve(t);
    };
    img.onerror = () => reject(new Error("texture"));
    img.src = stone.previewUrl;
  });
  e.textures.set(stone.textureId, p);
  p.catch(() => e.textures.delete(stone.textureId));
  return p;
}

/** Материал камня для поверхности w × h метров (своя копия repeat). */
function stoneMat(e: Engine, base: THREE.Texture, stone: ViewerStone, w: number, h: number) {
  const t = base.clone();
  t.needsUpdate = true;
  const [rx, ry] = textureRepeat(w, h, stone.lengthCm, stone.widthCm);
  t.repeat.set(rx, ry);
  e.disposables.push(t);
  const m = new e.T.MeshStandardMaterial({ map: t, roughness: 0.28, metalness: 0.0 });
  e.disposables.push(m);
  return m;
}

function plain(e: Engine, color: number, roughness = 0.85) {
  const m = new e.T.MeshStandardMaterial({ color, roughness, metalness: 0 });
  e.disposables.push(m);
  return m;
}

function box(
  e: Engine,
  g: THREE.Group,
  size: [number, number, number],
  pos: [number, number, number],
  mat: THREE.Material | THREE.Material[],
) {
  const geo = new e.T.BoxGeometry(...size);
  e.disposables.push(geo);
  const mesh = new e.T.Mesh(geo, mat);
  mesh.position.set(...pos);
  g.add(mesh);
  return mesh;
}

function plane(
  e: Engine,
  g: THREE.Group,
  size: [number, number],
  pos: [number, number, number],
  rot: [number, number, number],
  mat: THREE.Material,
) {
  const geo = new e.T.PlaneGeometry(...size);
  e.disposables.push(geo);
  const mesh = new e.T.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  g.add(mesh);
  return mesh;
}

/**
 * Каменная плита-брусок: верх — w × d с натуральным масштабом, торцы — та же
 * текстура (тонкие, растяжение не заметно). Порядок граней BoxGeometry:
 * +x, −x, +y, −y, +z, −z.
 */
function stoneSlab(
  e: Engine,
  g: THREE.Group,
  tex: THREE.Texture,
  stone: ViewerStone,
  size: [number, number, number],
  pos: [number, number, number],
) {
  const [w, h, d] = size;
  const top = stoneMat(e, tex, stone, w, d);
  const front = stoneMat(e, tex, stone, w, h);
  const side = stoneMat(e, tex, stone, d, h);
  return box(e, g, size, pos, [side, side, top, top, front, front]);
}

const WOOD = 0xb08a5e;
const WOOD_DARK = 0x6e5236;
const WHITE_WALL = 0xf1ede6;
const LIGHT_FLOOR = 0xd9d0c1;
const CABINET = 0xe9e4da;
const STEEL = 0xb9bcbf;

function buildKitchen(e: Engine, tex: THREE.Texture, stone: ViewerStone): THREE.Group {
  const g = new e.T.Group();
  const H = Math.PI / 2;
  // Пол (дерево), задняя и боковая стены.
  plane(e, g, [6, 5], [0, 0, 0.5], [-H, 0, 0], plain(e, WOOD, 0.7));
  plane(e, g, [6, 2.8], [0, 1.4, -1.6], [0, 0, 0], plain(e, WHITE_WALL));
  plane(e, g, [5, 2.8], [-3, 1.4, 0.5], [0, H, 0], plain(e, WHITE_WALL));
  // Нижние шкафы + цоколь.
  box(e, g, [3.6, 0.1, 0.55], [0, 0.05, -1.3], plain(e, WOOD_DARK));
  box(e, g, [3.6, 0.76, 0.58], [0, 0.48, -1.31], plain(e, CABINET, 0.6));
  // Фасады — тонкие щели между дверцами.
  for (let i = 1; i < 6; i++) {
    box(e, g, [0.005, 0.7, 0.005], [-1.8 + i * 0.6, 0.48, -1.015], plain(e, 0x9d968a));
  }
  // Столешница (камень), 3 см, свес 2 см.
  stoneSlab(e, g, tex, stone, [3.6, 0.03, 0.62], [0, 0.875, -1.29]);
  // Фартук (камень) от столешницы до верхних шкафов.
  plane(e, g, [3.6, 0.62], [0, 1.2, -1.595], [0, 0, 0], stoneMat(e, tex, stone, 3.6, 0.62));
  // Верхние шкафы.
  box(e, g, [3.6, 0.72, 0.35], [0, 1.87, -1.42], plain(e, CABINET, 0.6));
  // Мойка и смеситель — ориентир масштаба.
  box(e, g, [0.55, 0.01, 0.42], [0.7, 0.892, -1.28], plain(e, STEEL, 0.3));
  const tap = new e.T.CylinderGeometry(0.015, 0.015, 0.3, 16);
  e.disposables.push(tap);
  const tapMesh = new e.T.Mesh(tap, plain(e, STEEL, 0.25));
  tapMesh.position.set(0.7, 1.04, -1.52);
  g.add(tapMesh);
  // Остров (дерево) со столешницей из того же камня.
  box(e, g, [1.8, 0.86, 0.8], [0.2, 0.43, 0.6], plain(e, WOOD, 0.6));
  stoneSlab(e, g, tex, stone, [1.9, 0.03, 0.9], [0.2, 0.875, 0.6]);
  return g;
}

function buildBath(e: Engine, tex: THREE.Texture, stone: ViewerStone): THREE.Group {
  const g = new e.T.Group();
  const H = Math.PI / 2;
  plane(e, g, [4, 4], [0, 0, 0.6], [-H, 0, 0], plain(e, LIGHT_FLOOR, 0.6));
  // Стена за раковиной — целиком камень.
  plane(e, g, [2.4, 2.6], [0, 1.3, -1.2], [0, 0, 0], stoneMat(e, tex, stone, 2.4, 2.6));
  // Соседние стены — белые.
  plane(e, g, [0.8, 2.6], [-1.6, 1.3, -1.2], [0, 0, 0], plain(e, WHITE_WALL));
  plane(e, g, [0.8, 2.6], [1.6, 1.3, -1.2], [0, 0, 0], plain(e, WHITE_WALL));
  plane(e, g, [3.6, 2.6], [-2, 1.3, 0.6], [0, H, 0], plain(e, WHITE_WALL));
  // Тумба (дерево) + столешница под раковину (камень).
  box(e, g, [1.2, 0.45, 0.48], [0, 0.6, -0.95], plain(e, WOOD, 0.6));
  stoneSlab(e, g, tex, stone, [1.3, 0.03, 0.52], [0, 0.84, -0.94]);
  // Накладная раковина и смеситель.
  const sinkGeo = new e.T.CylinderGeometry(0.21, 0.17, 0.13, 32);
  e.disposables.push(sinkGeo);
  const sink = new e.T.Mesh(sinkGeo, plain(e, 0xfbfbf9, 0.2));
  sink.position.set(0, 0.92, -0.92);
  g.add(sink);
  box(e, g, [0.03, 0.22, 0.03], [0, 1.0, -1.15], plain(e, STEEL, 0.25));
  // Зеркало.
  // Без карты окружения металл выглядит чёрным — зеркало светлое и гладкое.
  const mirror = new e.T.MeshStandardMaterial({ color: 0xdfe7eb, roughness: 0.12, metalness: 0.05 });
  e.disposables.push(mirror);
  box(e, g, [0.9, 0.8, 0.02], [0, 1.55, -1.185], mirror);
  return g;
}

function buildHall(e: Engine, tex: THREE.Texture, stone: ViewerStone): THREE.Group {
  const g = new e.T.Group();
  const H = Math.PI / 2;
  // Пол — камень, 6 × 6 м (плиты в натуральную величину).
  plane(e, g, [6, 6], [0, 0, 0], [-H, 0, 0], stoneMat(e, tex, stone, 6, 6));
  plane(e, g, [6, 3], [0, 1.5, -3], [0, 0, 0], plain(e, WHITE_WALL));
  plane(e, g, [6, 3], [-3, 1.5, 0], [0, H, 0], plain(e, WHITE_WALL));
  // Плинтус, дверь, скамья — ориентиры размера.
  box(e, g, [6, 0.08, 0.02], [0, 0.04, -2.99], plain(e, WOOD_DARK));
  box(e, g, [0.02, 0.08, 6], [-2.99, 0.04, 0], plain(e, WOOD_DARK));
  box(e, g, [1.0, 2.1, 0.05], [0.8, 1.05, -2.97], plain(e, WOOD_DARK, 0.5));
  box(e, g, [1.4, 0.06, 0.4], [-2.4, 0.45, -1.0], plain(e, WOOD, 0.6));
  box(e, g, [0.06, 0.42, 0.36], [-2.4, 0.21, -1.6], plain(e, WOOD_DARK));
  box(e, g, [0.06, 0.42, 0.36], [-2.4, 0.21, -0.4], plain(e, WOOD_DARK));
  return g;
}

const BUILDERS: Record<SceneKey, (e: Engine, t: THREE.Texture, s: ViewerStone) => THREE.Group> = {
  kitchen: buildKitchen,
  bath: buildBath,
  hall: buildHall,
};

/** Убрать текущую комнату: её геометрию, материалы и копии текстур. */
function disposeRoom(e: Engine) {
  if (e.room) e.scene.remove(e.room);
  e.room = null;
  for (const d of e.disposables) d.dispose();
  e.disposables = [];
}

export default function StoneViewer3D({
  stones,
  initialIndex = 0,
  initialScene = "kitchen",
  labels,
  showroom = false,
}: {
  stones: ViewerStone[];
  initialIndex?: number;
  initialScene?: SceneKey;
  labels: ViewerLabels;
  showroom?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const [noGl, setNoGl] = useState(false);
  // Что сейчас на экране и что не загрузилось: «сцена:текстура». Загрузка —
  // производное (показано ≠ выбрано), без setState в теле эффекта.
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [sceneKey, setSceneKey] = useState<SceneKey>(initialScene);
  const [index, setIndex] = useState(
    Math.min(Math.max(0, initialIndex), Math.max(0, stones.length - 1)),
  );
  const stone = stones[index] ?? null;
  const wantKey = stone ? `${sceneKey}:${stone.textureId}` : null;
  const failed = wantKey !== null && failedKey === wantKey;
  const loading = !noGl && !failed && shownKey !== wantKey;

  // ── Инициализация three.js (один раз) ──
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    (async () => {
      if (!webglAvailable()) {
        setNoGl(true);
        return;
      }
      const [T, { OrbitControls }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/controls/OrbitControls.js"),
      ]);
      if (cancelled || !host.current) return;
      const el = host.current;
      const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.touchAction = "none";
      el.appendChild(renderer.domElement);

      const scene = new T.Scene();
      scene.background = new T.Color(0xece7df);
      scene.add(new T.HemisphereLight(0xffffff, 0xb9ab95, 1.6));
      const sun = new T.DirectionalLight(0xfff4e2, 1.6);
      sun.position.set(2.5, 4, 3);
      scene.add(sun);
      const fill = new T.DirectionalLight(0xffffff, 0.5);
      fill.position.set(-3, 2, -1);
      scene.add(fill);

      const camera = new T.PerspectiveCamera(50, el.clientWidth / Math.max(1, el.clientHeight), 0.05, 50);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minDistance = 0.6;
      controls.maxDistance = 7;
      controls.maxPolarAngle = Math.PI * 0.49;

      let needs = true;
      let moving = false;
      const requestRender = () => {
        needs = true;
      };
      controls.addEventListener("change", requestRender);
      controls.addEventListener("start", () => (moving = true));
      controls.addEventListener("end", () => {
        moving = false;
        requestRender();
      });
      const loop = () => {
        raf = requestAnimationFrame(loop);
        // Затухание инерции тоже двигает камеру → "change" → новый кадр.
        controls.update();
        if (needs || moving) {
          needs = false;
          renderer.render(scene, camera);
        }
      };
      loop();

      ro = new ResizeObserver(() => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        requestRender();
      });
      ro.observe(el);

      engine.current = {
        T,
        renderer,
        scene,
        camera,
        controls,
        room: null,
        textures: new Map(),
        disposables: [],
        requestRender,
      };
      setReady(true);
    })().catch((err) => {
      console.error("[3d] init:", err);
      if (!cancelled) setNoGl(true);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      const e = engine.current;
      engine.current = null;
      if (e) {
        e.controls.dispose();
        for (const d of e.disposables) d.dispose();
        for (const p of e.textures.values()) p.then((t) => t.dispose()).catch(() => {});
        e.renderer.dispose();
        e.renderer.domElement.remove();
      }
    };
  }, []);

  // ── Сцена / камень → пересобрать комнату ──
  const lastScene = useRef<SceneKey | null>(null);
  useEffect(() => {
    const e = engine.current;
    if (!ready || !e || !stone) return;
    let stale = false;
    const key = `${sceneKey}:${stone.textureId}`;
    loadStoneTexture(e, stone)
      .then((tex) => {
        if (stale || engine.current !== e) return;
        disposeRoom(e);
        e.room = BUILDERS[sceneKey](e, tex, stone);
        e.scene.add(e.room);
        // Камеру ставим заново только при смене сцены: при смене камня клиент
        // остаётся там же, где смотрел.
        if (lastScene.current !== sceneKey) {
          const v = VIEWS[sceneKey];
          e.camera.position.set(...v.pos);
          e.controls.target.set(...v.target);
          e.controls.update();
          lastScene.current = sceneKey;
        }
        e.requestRender();
        setShownKey(key);
        // Соседние камни — заранее, чтобы переключение было мгновенным.
        for (const s of [stones[index + 1], stones[index - 1]]) {
          if (s) loadStoneTexture(e, s).catch(() => {});
        }
      })
      .catch(() => {
        if (!stale) setFailedKey(key);
      });
    return () => {
      stale = true;
    };
  }, [ready, sceneKey, stone, index, stones]);

  const toggleFullscreen = useCallback(() => {
    const el = wrap.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!el) return;
    const doc = document as Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      (document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc))?.();
    } else {
      (el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el))?.();
    }
  }, []);

  if (stones.length === 0) return null;

  const btn = showroom
    ? "min-h-14 rounded-card px-5 text-lg font-semibold"
    : "min-h-10 rounded-card px-3 text-sm font-semibold";
  const sceneLabel: Record<SceneKey, string> = {
    kitchen: labels.kitchen,
    bath: labels.bath,
    hall: labels.hall,
  };

  const stoneList = stones.length > 1 && (
    <div
      className={
        showroom
          ? "flex max-h-full flex-col gap-2 overflow-y-auto p-3"
          : "flex gap-2 overflow-x-auto pb-1"
      }
      role="listbox"
      aria-label={labels.stones}
    >
      {stones.map((s, i) => (
        <button
          key={s.textureId}
          type="button"
          role="option"
          aria-selected={i === index}
          onClick={() => setIndex(i)}
          className={
            (showroom ? "flex w-full items-center gap-3 p-2 text-left " : "shrink-0 px-3 py-2 text-left ") +
            "rounded-card border transition-colors " +
            (i === index
              ? "border-gold bg-gold/15 text-ink"
              : "border-line bg-paper-2 text-ink/80 hover:border-gold/60")
          }
        >
          {showroom && ready && !loading && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.previewUrl}
              alt=""
              loading="lazy"
              className="h-16 w-16 shrink-0 rounded-card object-cover"
            />
          )}
          <span className="min-w-0">
            <span className={(showroom ? "text-base " : "text-sm ") + "block font-semibold"}>{s.name}</span>
            {s.detail && <span className="block truncate text-xs text-ink/55">{s.detail}</span>}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={wrap}
      className={
        showroom
          ? "flex h-[100dvh] w-full bg-paper text-ink"
          : "flex w-full flex-col gap-3"
      }
    >
      <div className={showroom ? "relative min-w-0 flex-1" : "relative"}>
        <div
          ref={host}
          className={
            showroom
              ? "absolute inset-0"
              : "relative aspect-[4/3] w-full overflow-hidden rounded-card border border-line bg-[#ece7df] sm:aspect-[16/10]"
          }
        />
        {(noGl || failed || loading) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="rounded-card bg-paper/85 px-4 py-2 text-sm font-medium text-ink">
              {noGl ? labels.noWebgl : failed ? labels.noWebgl : labels.loading}
            </p>
          </div>
        )}
        {/* Сцены — поверх картинки, крупно в шоу-руме. */}
        <div className="absolute left-2 top-2 flex flex-wrap gap-2">
          {SCENE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === sceneKey}
              onClick={() => setSceneKey(k)}
              className={
                btn +
                " border border-line " +
                (k === sceneKey ? "bg-gold text-on-gold" : "bg-paper/85 text-ink hover:bg-paper")
              }
            >
              {sceneLabel[k]}
            </button>
          ))}
        </div>
        {showroom && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className={btn + " absolute right-2 top-2 bg-paper/85 text-ink border border-line hover:bg-paper"}
          >
            {labels.fullscreen}
          </button>
        )}
        {stone && (
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-between gap-2">
            <p className="rounded-card bg-paper/85 px-3 py-1.5 text-sm text-ink border border-line">
              <span className="font-semibold">{stone.name}</span>
              {stone.lengthCm && stone.widthCm && (
                <span className="text-ink/60">
                  {" · "}
                  {labels.slab} {stone.lengthCm} × {stone.widthCm} см
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {showroom ? (
        stones.length > 1 && (
          <aside className="w-72 shrink-0 border-l border-line bg-paper-2 lg:w-80">{stoneList}</aside>
        )
      ) : (
        <>
          <p className="text-xs text-ink/55">{labels.hint}</p>
          {stoneList}
        </>
      )}
    </div>
  );
}
