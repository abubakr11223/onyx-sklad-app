"use client";

// TZ №8 v2 §6 — 3D lenta-globus sfera. FAQAT /login sahifasida ishlatiladi va
// FAQAT `next/dynamic({ ssr: false })` orqali import qilinadi (SSR'da three
// yuklanmasin). Fallback zanjiri LoginPageClient da: static → weak-device →
// reduced-motion → noscript.
//
// Geometriya: 6 ta CatmullRomCurve (inclination 15°→90°), har biri TubeGeometry
// bilan lentaga aylantiriladi. Material — MeshStandardMaterial oltin
// (metalness 0.9, roughness 0.25). Yorug'lik — qo'lda light rig (Environment
// preset yo'q — bundle budget uchun). Halo — ichkariga qaragan BackSide sfera.
// Sparkles — drei @react-three/drei.

import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

// TZ §6.2 — material parametrlari (AYNAN).
const GOLD_MAIN = 0xc9a55c;
const GOLD_HIGHLIGHT = 0xe9cf8f;
const GOLD_SPARKLE = 0xf5e7c0;

// TZ §6.1 — 6 ta lenta = globus. 3 ta latitude (parallel, sfera atrofida
// gorizontal halqalar turli balandliklarda) + 3 ta longitude (meridian,
// qutbdan qutbga o'tuvchi vertikal halqalar turli phi burchaklarida).
// Ular kesishadi va toza globus taassurotini beradi.
type BandKind = "latitude" | "longitude";
interface BandSpec {
  kind: BandKind;
  /** latitude uchun: 0 = ekvator, ±π/2 = qutb. longitude uchun: 0 = grennich meridiani. */
  offsetRad: number;
}

// 3 latitude: ekvatorda + shim/jan ~30°. 3 longitude: 3 meridian 60° oralig'da.
const BAND_SPECS: BandSpec[] = [
  { kind: "latitude", offsetRad: 0 },              // ekvator
  { kind: "latitude", offsetRad: Math.PI / 6 },     // 30° shim
  { kind: "latitude", offsetRad: -Math.PI / 6 },    // 30° jan
  { kind: "longitude", offsetRad: 0 },
  { kind: "longitude", offsetRad: Math.PI / 3 },    // 60°
  { kind: "longitude", offsetRad: (2 * Math.PI) / 3 }, // 120°
];

/**
 * Sfera (R=1) yuzasidagi great/small circle uchun CatmullRomCurve3 nuqtalari.
 * - latitude: y = sin(offset) qatlamda gorizontal halqa (kichik doira).
 * - longitude: qutbdan qutbga o'tuvchi vertikal halqa (katta doira), offset — phi.
 */
function makeBandCurve(spec: BandSpec, points = 128): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * Math.PI * 2;
    let x: number, y: number, z: number;
    if (spec.kind === "latitude") {
      const lat = spec.offsetRad;
      const r = Math.cos(lat);
      x = r * Math.cos(t);
      y = Math.sin(lat);
      z = r * Math.sin(t);
    } else {
      const phi = spec.offsetRad;
      x = Math.cos(phi) * Math.cos(t);
      y = Math.sin(t);
      z = Math.sin(phi) * Math.cos(t);
    }
    pts.push(new THREE.Vector3(x, y, z));
  }
  return new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
}

interface RibbonBandProps {
  spec: BandSpec;
  material: THREE.Material;
}

function RibbonBand({ spec, material }: RibbonBandProps) {
  const geometry = useMemo(() => {
    const curve = makeBandCurve(spec);
    // TZ §6.1 — tubularSegments=400, radius=0.04, radialSegments=8, closed=true.
    return new THREE.TubeGeometry(curve, 400, 0.04, 8, true);
  }, [spec]);

  return <mesh geometry={geometry} material={material} />;
}

interface SphereGroupProps {
  hovered: React.MutableRefObject<boolean>;
  tilt: React.MutableRefObject<{ x: number; y: number }>;
}

function SphereGroup({ hovered, tilt }: SphereGroupProps) {
  const groupRef = useRef<THREE.Group>(null);

  // TZ §6.2 — sharedmaterial (barcha 6 lenta uchun bitta material).
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: GOLD_MAIN,
      metalness: 0.9,
      roughness: 0.25,
      envMapIntensity: 1.2,
    });
  }, []);

  const haloMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: GOLD_HIGHLIGHT,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
  }, []);

  // TZ §6.4 — idle aylanish: Y=0.15, X=0.05 rad/s. Hover'da 1.5x (§7.4).
  // Tilt (hover-driven) lerp bilan yumshatiladi.
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const factor = hovered.current ? 1.5 : 1;
    g.rotation.y += 0.15 * delta * factor;
    g.rotation.x += 0.05 * delta * factor;

    // Hover tilt — S4 da desktop'ga ulanadi (mouse handler LoginPageClient'da).
    // Bu yerda faqat lerp — `tilt.current` LoginPageClient tomonidan yozib turiladi.
    g.rotation.x += (tilt.current.x - (g.rotation.x % (Math.PI * 2))) * 0.05 * 0;
    g.rotation.y += (tilt.current.y - (g.rotation.y % (Math.PI * 2))) * 0.05 * 0;
  });

  return (
    <group ref={groupRef}>
      {BAND_SPECS.map((spec, i) => (
        <RibbonBand key={i} spec={spec} material={material} />
      ))}
      {/* TZ §6.3 — halo (BackSide) */}
      <mesh material={haloMaterial}>
        <sphereGeometry args={[1.15, 32, 32]} />
      </mesh>
    </group>
  );
}

interface LogoSphere3DProps {
  /**
   * FPS probe callback. Canvas mount bo'lgach 1 soniya davomida frame counter
   * yuritiladi va FPS <45 bo'lsa `onLowFps()` chaqiriladi — LoginPageClient
   * Canvas'ni unmount qilib statik logo'ga o'tadi (TZ §8.2b).
   */
  onLowFps?: () => void;
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
      if (fps < 45 && onLowFps) onLowFps();
    }
  });
  return null;
}

export default function LogoSphere3D({ onLowFps, size = 320 }: LogoSphere3DProps) {
  const hovered = useRef(false);
  const tilt = useRef({ x: 0, y: 0 });

  // Hover — S4 da mouse tracking LoginPageClient tomonidan bog'lanadi.
  // Hozircha idle aylanish + Sparkles + halo.
  return (
    <div
      style={{ width: size, height: size }}
      onPointerEnter={() => (hovered.current = true)}
      onPointerLeave={() => (hovered.current = false)}
      aria-hidden
    >
      <Canvas
        camera={{ fov: 45, position: [0, 0, 3.2] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop="always"
      >
        {/* TZ §6.3 — qo'lda light rig (bundle budget uchun Environment o'rniga). */}
        <ambientLight intensity={0.4} color={"#2A2418"} />
        <directionalLight
          position={[3, 4, 3]}
          intensity={1.4}
          color={"#FFF5E0"}
        />
        <pointLight position={[-3, 2, 2]} intensity={0.6} color={GOLD_HIGHLIGHT} />
        <pointLight position={[0, -3, 2]} intensity={0.3} color={GOLD_SPARKLE} />

        <SphereGroup hovered={hovered} tilt={tilt} />

        {/* TZ §6.3 — Sparkles (drei), oltin highlight. */}
        <Sparkles
          count={40}
          scale={[3, 3, 3]}
          size={2}
          speed={0.3}
          color={GOLD_SPARKLE}
        />

        {onLowFps ? <FpsMonitor onLowFps={onLowFps} /> : null}
      </Canvas>
    </div>
  );
}
