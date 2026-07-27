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
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

// TZ §6.2 — material parametrlari (AYNAN).
const GOLD_MAIN = 0xc9a55c;
const GOLD_HIGHLIGHT = 0xe9cf8f;
const GOLD_SPARKLE = 0xf5e7c0;

// TZ §6.1 (v2 — spiral) — sfera yuzasini o'ragan SPIRAL lentalar ("o'ralgan ip
// koptok" ta'siri, reference'ga mos). Har bir lenta janubiy qutbdan shimoliy
// qutbga o'tayotganda Y-o'q atrofida bir necha marta aylanadi. Lentalar boshi
// bir tekis (360/N) burchak farqi bilan siljigan — natijada ular sfera yuzasida
// bir-birini kesib, "ip o'ragan koptok" naqshi hosil qiladi.
//
// Eski implementatsiya (3 latitude + 3 longitude) "qafas" ko'rinishida edi —
// reference'dagi silliq spiral koptokga umuman o'xshamas edi.
const BAND_COUNT = 8;         // 8 ta spiral lenta (reference'dagi ~8 loop bilan mos)
const SPIRAL_TURNS = 1.5;      // har lenta 1.5 to'liq aylanadi (janubdan shimolgacha)
const TUBE_RADIUS = 0.055;     // qalinroq lenta (avval 0.04 juda ingichka edi)

interface BandSpec {
  /** Boshlang'ich burchak (Y atrofida), radianga. */
  startTheta: number;
}

// N ta lenta, har biri boshlang'ich burchak bilan farqlanadi.
const BAND_SPECS: BandSpec[] = Array.from({ length: BAND_COUNT }, (_, i) => ({
  startTheta: (i / BAND_COUNT) * Math.PI * 2,
}));

/**
 * Spiral parametrik chiziq: t=0 (janubiy qutb, y=-1) → t=1 (shimoliy qutb, y=+1),
 * yo'lda Y-o'q atrofida SPIRAL_TURNS marta aylanadi. Natijada sfera yuzasida
 * qutbdan qutbga o'tuvchi lenta.
 */
function makeSpiralCurve(spec: BandSpec, points = 200): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points; // [0, 1]
    // Latitude phi: -π/2 (janubiy qutb) → +π/2 (shimoliy qutb).
    const phi = -Math.PI / 2 + t * Math.PI;
    // Longitude theta: boshlang'ich burchakdan SPIRAL_TURNS*2π gacha.
    const theta = spec.startTheta + t * SPIRAL_TURNS * Math.PI * 2;
    const r = Math.cos(phi);
    pts.push(
      new THREE.Vector3(
        r * Math.cos(theta),
        Math.sin(phi),
        r * Math.sin(theta),
      ),
    );
  }
  // Yopilmagan chiziq (closed=false): qutblardan boshlanadi va tugaydi.
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

interface RibbonBandProps {
  spec: BandSpec;
  material: THREE.Material;
}

function RibbonBand({ spec, material }: RibbonBandProps) {
  const geometry = useMemo(() => {
    const curve = makeSpiralCurve(spec);
    // Yopilmagan spiral chiziq uchun TubeGeometry: closed=false.
    // tubularSegments=400 — silliq egri chiziqlar uchun yetadi.
    return new THREE.TubeGeometry(curve, 400, TUBE_RADIUS, 12, false);
  }, [spec]);

  return <mesh geometry={geometry} material={material} />;
}

interface SphereGroupProps {
  hovered: React.MutableRefObject<boolean>;
  tilt: React.MutableRefObject<{ x: number; y: number }>;
}

function SphereGroup({ hovered, tilt }: SphereGroupProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Yorqinroq oltin material — prod'da qorong'i chiqqan edi. Emissive iliq
  // oltin tuson beradi (metalness+roughness'ni yumshatmasdan), highlight rangi
  // asosiy tuson qilib olindi. Aylanishda highlight+darker balans hosil qiladi.
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: GOLD_HIGHLIGHT,     // asosiy tuson yorqinroq (avval GOLD_MAIN — qorong'i)
      metalness: 0.85,
      roughness: 0.28,
      emissive: 0x3a2a10,        // iliq bronze glow — sfera qora fon ustida yo'qolmasin
      emissiveIntensity: 0.35,
      envMapIntensity: 1.5,
    });
  }, []);

  const haloMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: GOLD_HIGHLIGHT,
      transparent: true,
      opacity: 0.18,             // 0.08 → 0.18 (yorqinroq halo, sfera atrofida yumshoq nur)
      side: THREE.BackSide,
    });
  }, []);

  // TZ §6.4 + §7.4 — idle aylanish: Y=0.15, X=0.05 rad/s. Hover'da 1.5x.
  // Tilt: sichqoncha koordinatasi (normal [-1,1]) → ±0.3 rad, lerp 0.05.
  // Idle aylanish + tilt qo'shiladi (tilt "yuza" burchak sifatida keladi:
  // rotation'ga to'g'ridan qo'shsak, aylanish barbaqar ekvatordan siljiydi va
  // qaytadi — bu keladigan burchak asosiy egilishni beradi).
  const rotOffset = useRef({ x: 0, y: 0 });
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const factor = hovered.current ? 1.5 : 1;
    g.rotation.y += 0.15 * delta * factor;
    g.rotation.x += 0.05 * delta * factor;

    // Tilt offset lerp — sichqoncha keskin harakat qilsa ham, sfera yumshoq
    // egiladi. Target: mouseX/Y × 0.3. Lerp: 0.05 (5% har frame).
    const targetX = -tilt.current.y * 0.3;
    const targetY = tilt.current.x * 0.3;
    rotOffset.current.x += (targetX - rotOffset.current.x) * 0.05;
    rotOffset.current.y += (targetY - rotOffset.current.y) * 0.05;
    g.rotation.x += rotOffset.current.x * delta * 4;
    g.rotation.y += rotOffset.current.y * delta * 4;
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  // TZ §7.4 — hover tilt FAQAT desktop'da (hover + fine pointer). Touch'da
  // umuman ulanmaydi (mobil qurilma o'zining scroll/tap gestlarini erkin
  // qilsin, sfera bezovta qilmasin). matchMedia SSR'da yo'q, shu sabab client-only
  // (dynamic ssr:false garanti beradi, lekin defensivroq: window guard).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!mql.matches) return;
    const el = wrapperRef.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      // Normal koordinata [-1, 1]: -1 chap/tepa, +1 o'ng/past.
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
      // Sfera markazga qaytsin (idle aylanish davom etadi).
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
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Canvas
        camera={{ fov: 45, position: [0, 0, 3.2] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop="always"
      >
        {/* TZ §6.3 — qo'lda light rig. Metalness=0.9 material yaqindagi
            yorug'likni juda ko'p qaytaradi, shu sabab yaqin va yorqin nurlar
            berilgan (aks holda sfera qorong'i qora ko'rinadi — deploy'da shu
            muammo bo'lgan edi). Ambient ham iliqroq. */}
        <ambientLight intensity={0.9} color={"#3D3020"} />
        <directionalLight
          position={[2, 3, 4]}
          intensity={3.0}
          color={"#FFF5E0"}
        />
        <pointLight position={[-2, 1, 3]} intensity={2.0} color={GOLD_HIGHLIGHT} />
        <pointLight position={[0, -2, 3]} intensity={1.2} color={GOLD_SPARKLE} />
        <pointLight position={[3, -1, 1]} intensity={1.5} color={"#FFF5E0"} />

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
