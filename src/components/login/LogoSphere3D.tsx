"use client";

// TZ №8 v3 — /login 3D "woven-ribbon sphere" (referens: onyx_login_3d_logo_preview.html).
// Geometriya AYNAN referens'dagi kabi: 7 ta meridional lenta janubdan shimolga,
// har biri cosine-twist bilan → to'qilgan koptok naqshi. Qo'shimcha 2 ta
// ekvatorial oltin halqa. Orqada canvas-radial halo sprite. Nurlar va sparkles
// ham referens'dagi qiymatlarda.
//
// Faqat /login sahifasida `next/dynamic({ ssr: false })` orqali chaqiriladi.
// Fallback zanjiri LoginPageClient'da: reduced-motion → weak-device → low-fps.

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

// Referens ranglar.
const GOLD_MAIN = 0xc9a55c;
const GOLD_HIGHLIGHT = 0xe9cf8f;

// Referens geometriya konstantalari.
const BAND_COUNT = 7;
const SPIRAL_TURNS = 1.0;      // referens'da `turns=1.0`
const TUBE_RADIUS = 0.055;
const SPHERE_R = 1.25;
const RING_YS = [-0.35, 0.35]; // ekvator halqalari (referens'dagi kabi)
const RING_TUBE = 0.05;

/**
 * Referens'dagi curve: qutbdan qutbga, cosine-twist bilan.
 * `ang = t·π`, `r = sin(ang)·R`, `y = cos(ang)·R`,
 * `twist = phase + cos(ang)·turns·π` — qutb yaqinida burilish tez, ekvatorda
 * sekin → lentalar bir-birini kesib "to'qilgan" naqsh hosil qiladi.
 */
function makeWovenMeridian(phase: number, seg = 90): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s <= seg; s++) {
    const t = s / seg;
    const ang = t * Math.PI;
    const r = Math.sin(ang) * SPHERE_R;
    const twist = phase + Math.cos(ang) * SPIRAL_TURNS * Math.PI;
    pts.push(
      new THREE.Vector3(
        Math.cos(twist) * r,
        Math.cos(ang) * SPHERE_R,
        Math.sin(twist) * r,
      ),
    );
  }
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

interface RibbonBandProps {
  phase: number;
  material: THREE.Material;
}

function RibbonBand({ phase, material }: RibbonBandProps) {
  const geometry = useMemo(() => {
    const curve = makeWovenMeridian(phase);
    // Referens: TubeGeometry(curve, 120, 0.055, 8, false).
    return new THREE.TubeGeometry(curve, 120, TUBE_RADIUS, 8, false);
  }, [phase]);
  return <mesh geometry={geometry} material={material} />;
}

interface EquatorRingProps {
  y: number;
  material: THREE.Material;
}

function EquatorRing({ y, material }: EquatorRingProps) {
  const geometry = useMemo(() => {
    // Referens: rr = sqrt(R^2 - (y·R)^2) * 0.96, TorusGeometry(rr, 0.05, 10, 80).
    const rr =
      Math.sqrt(Math.max(0.001, SPHERE_R * SPHERE_R - (y * SPHERE_R) * (y * SPHERE_R))) *
      0.96;
    return new THREE.TorusGeometry(rr, RING_TUBE, 10, 80);
  }, [y]);
  return (
    <mesh
      geometry={geometry}
      material={material}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, y * SPHERE_R, 0]}
    />
  );
}

/**
 * Halo — orqa fondagi iliq oltin radial gradient sprite (referens'dagi kabi).
 * `AdditiveBlending`, `depthWrite=false`, opacity `0.85 + sin(t·1.4)·0.15` bilan
 * yumshoq nafas oladi.
 */
function HaloSprite() {
  const spriteRef = useRef<THREE.Sprite>(null);
  const material = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    const grd = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, "rgba(201,165,92,0.55)");
    grd.addColorStop(0.4, "rgba(201,165,92,0.18)");
    grd.addColorStop(1, "rgba(201,165,92,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    return new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  useFrame((state) => {
    const s = spriteRef.current;
    if (!s) return;
    const t = state.clock.getElapsedTime();
    (s.material as THREE.SpriteMaterial).opacity = 0.85 + Math.sin(t * 1.4) * 0.15;
  });

  return (
    <sprite ref={spriteRef} material={material} scale={[6, 6, 1]} position={[0, 0, -1]} />
  );
}

/**
 * Sparkles — 140 ta oltin nuqta, past→yuqori sekin harakat (referens'dagi kabi).
 */
function Sparkles140() {
  const pointsRef = useRef<THREE.Points>(null);
  const { geometry, material, speeds } = useMemo(() => {
    const count = 140;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let p = 0; p < count; p++) {
      positions[p * 3] = (Math.random() - 0.5) * 8;
      positions[p * 3 + 1] = (Math.random() - 0.5) * 7;
      positions[p * 3 + 2] = (Math.random() - 0.5) * 4;
      speeds[p] = 0.002 + Math.random() * 0.006;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: GOLD_HIGHLIGHT,
      size: 0.045,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: geo, material: mat, speeds };
  }, []);

  useFrame(() => {
    const p = pointsRef.current;
    if (!p) return;
    const attr = p.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < speeds.length; i++) {
      arr[i * 3 + 1] += speeds[i];
      if (arr[i * 3 + 1] > 3.6) arr[i * 3 + 1] = -3.6;
    }
    attr.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

interface SphereGroupProps {
  hovered: React.MutableRefObject<boolean>;
  tilt: React.MutableRefObject<{ x: number; y: number }>;
}

function SphereGroup({ hovered, tilt }: SphereGroupProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Referens material: MeshStandardMaterial oltin.
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: GOLD_MAIN,
      metalness: 0.95,
      roughness: 0.28,
      emissive: 0x3a2a0c,
      emissiveIntensity: 0.35,
    });
  }, []);

  // Idle aylanish + hover tilt. Referens loop:
  //   rotation.y = dt·0.5, rotation.x = sin(dt·0.4)·0.09.
  // Bizda `useFrame` delta-tayanchi bor: rotation.y ni monoton oshiramiz,
  // rotation.x — clock asosida (sin) hisoblanadi.
  const startTimeRef = useRef<number | null>(null);
  const rotOffset = useRef({ x: 0, y: 0 });
  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    if (startTimeRef.current == null) {
      startTimeRef.current = state.clock.getElapsedTime();
    }
    const dt = state.clock.getElapsedTime() - startTimeRef.current;
    const factor = hovered.current ? 1.5 : 1;
    g.rotation.y = dt * 0.5 * factor;
    g.rotation.x = Math.sin(dt * 0.4 * factor) * 0.09;

    // Hover tilt (desktop only) — lerp qo'shiladi.
    const targetX = -tilt.current.y * 0.3;
    const targetY = tilt.current.x * 0.3;
    rotOffset.current.x += (targetX - rotOffset.current.x) * 0.05;
    rotOffset.current.y += (targetY - rotOffset.current.y) * 0.05;
    g.rotation.x += rotOffset.current.x;
    g.rotation.y += rotOffset.current.y;
    void delta;
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {Array.from({ length: BAND_COUNT }, (_, i) => {
        const phase = (i / BAND_COUNT) * Math.PI * 2;
        return <RibbonBand key={`b${i}`} phase={phase} material={material} />;
      })}
      {RING_YS.map((y, i) => (
        <EquatorRing key={`r${i}`} y={y} material={material} />
      ))}
    </group>
  );
}

interface LogoSphere3DProps {
  onLowFps?: () => void;
  /**
   * Deprecated: sfera endi parent container'ni to'liq to'ldiradi (referens
   * onyx_login_3d_logo_preview.html'dagi kabi `position:absolute; inset:0`).
   * Prop faqat backward-compat uchun qoldirilgan — hech qanday effekt bermaydi.
   */
  size?: number;
}

function FpsMonitor({ onLowFps }: { onLowFps?: () => void }) {
  const startRef = useRef<number | null>(null);
  const framesRef = useRef(0);
  const reportedRef = useRef(false);
  useFrame(() => {
    if (reportedRef.current) return;
    if (startRef.current == null) {
      startRef.current = performance.now();
      framesRef.current = 0;
      return;
    }
    framesRef.current += 1;
    const elapsed = performance.now() - startRef.current;
    if (elapsed >= 1000) {
      const fps = (framesRef.current * 1000) / elapsed;
      reportedRef.current = true;
      if (fps < 20 && onLowFps) onLowFps();
    }
  });
  return null;
}

export default function LogoSphere3D({ onLowFps }: LogoSphere3DProps) {
  const hovered = useRef(false);
  const tilt = useRef({ x: 0, y: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!mql.matches) return;
    const el = wrapperRef.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      tilt.current.x = Math.max(-1, Math.min(1, nx));
      tilt.current.y = Math.max(-1, Math.min(1, ny));
    };
    const onEnter = () => {
      hovered.current = true;
    };
    const onLeave = () => {
      hovered.current = false;
      tilt.current.x = 0;
      tilt.current.y = 0;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      aria-hidden
    >
      <Canvas
        camera={{ fov: 45, position: [0, 0, 6] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop="always"
      >
        {/* Referens nurlar — 3 ta yumshoq (juda ko'p yorug'lik bermaymiz, aks
            holda gold sheen yo'qoladi). */}
        <ambientLight intensity={0.7} color={0x552f10} />
        <pointLight position={[4, 5, 6]} intensity={1.6} distance={50} color={0xffe6a8} />
        <pointLight position={[-5, -2, 3]} intensity={1.1} distance={50} color={GOLD_MAIN} />

        <HaloSprite />
        <SphereGroup hovered={hovered} tilt={tilt} />
        <Sparkles140 />

        {onLowFps ? <FpsMonitor onLowFps={onLowFps} /> : null}
      </Canvas>
    </div>
  );
}
