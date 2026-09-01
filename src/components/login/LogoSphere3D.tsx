"use client";

// TZ №8 v2 §6 — /login sahifasidagi 3D logotip.
//
// MUHIM O'ZGARISH (2026-09-01): oldin bu yerda three.js + @react-three/fiber
// bilan PROTSEDURAL sfera chizilardi (8 ta TubeGeometry lenta). Ega uni ko'rib
// "logotipga umuman o'xshamaydi" dedi — va haq edi: formula bilan chizilgan
// shakl haqiqiy logotipning nusxasi bo'la olmaydi.
//
// Endi ekranda kompaniyaning HAQIQIY logotipi turadi: `/logo/onyx-sphere.jpg`
// (541×541, sfera o'lchangan doira bo'yicha kesilgan). Hech nima chizilmagan —
// har bir piksel asl fayldan.
//
// Sfera "tirik" ko'rinishi uchun rasm tekis emas, hajm sifatida hisoblanadi:
//   • ekrandagi har bir nuqta uchun sfera normali topiladi;
//   • normal teskari burilib, rasmdagi mos piksel olinadi (haqiqiy parallaks);
//   • rasmga "pishirilgan" yorug'lik o'lchangan va olib tashlangan, o'rniga
//     harakatlanuvchi chiroq qo'yilgan — shu sabab shar burilganda soya u bilan
//     birga burilib ketmaydi, aksincha metall jonlanadi;
//   • gravyura relyefi rasmning o'z gradientidan olinadi — naqsh nurni ushlaydi.
//
// O'lchangan qiymatlar (asl 640×640 fayl uchun) — ular shu yerdagi
// o'zgarmaslarga aylangan:
//   doira: markaz (315.45, 324.66), R = 269.27 px, mos kelish xatosi 1.17 px
//   pishirilgan yorug'lik: yo'nalish (0.007, 0.877, −0.480), kuchi 0.175, fon 0.368
//
// Nima uchun to'liq 360° aylanmaydi: bitta suratdan sferaning ORQA tomonini
// tiklab bo'lmaydi. Lentalarning takrorlanishi tekshirildi — korrelyatsiya 0.42,
// ya'ni naqsh qat'iy davriy emas. To'liq aylantirish o'ylab topilgan pikselni
// talab qiladi; buning o'rniga shar ko'rinadigan yarim sfera doirasida ±10°
// chayqaladi va yorug'lik aylanadi.
//
// three.js/@react-three/fiber/drei bog'liqliklari OLIB TASHLANDI — ular faqat
// shu fayl uchun turardi (~600 KB JS login yo'nalishida).

import { useEffect, useRef } from "react";
import { LOGO_SPHERE_SRC } from "./logo-asset";

interface LogoSphere3DProps {
  /**
   * FPS probe callback. Canvas mount bo'lgach 1 soniya davomida frame counter
   * yuritiladi va FPS <45 bo'lsa `onLowFps()` chaqiriladi — LoginPageClient
   * Canvas'ni unmount qilib statik logo'ga o'tadi (TZ §8.2b).
   */
  onLowFps?: () => void;
  size?: number;
}

const VS = `attribute vec2 aP; varying vec2 vUv;
void main(){ vUv = aP; gl_Position = vec4(aP, 0., 1.); }`;

// uInv — kameradan obyektga o'tish (aylanishning teskarisi).
// BL/BK/BA — rasmdan O'LCHANGAN yorug'lik (yo'nalish / kuchi / fon).
const FS = `precision highp float;
varying vec2 vUv;
uniform sampler2D uTex; uniform mat3 uInv; uniform vec3 uL; uniform float uS; uniform vec2 uAsp;
const vec3 BL = vec3(.007, .877, -.480);
const float BK = .175, BA = .368;
float lum(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
vec3 tap(vec3 o){ vec2 t = o.xy * .9963 * .5 + .5; t.y = 1. - t.y; return texture2D(uTex, t).rgb; }
void main(){
  vec2 p = vUv * uAsp * uS;   /* kanvas kvadrat bo'lmasa ham sfera dumaloq qoladi */
  float r2 = dot(p, p);
  if (r2 > 1.) discard;
  float z = sqrt(max(1. - r2, 0.));
  vec3 n = vec3(p, z);
  vec3 o = uInv * n;

  /* suratda bo'lmagan yupqa yarim oy: tekselni cho'zmaymiz, soyaga o'tkazamiz */
  float back = smoothstep(.042, -.028, o.z);
  vec3 os = (o.z < .042) ? normalize(vec3(normalize(o.xy) * .9991, .042)) : o;
  vec3 base = tap(os);

  /* chetda detal siqiladi — mahalliy kontrastni qaytaramiz */
  float e = .0062;
  vec3 t1 = tap(normalize(os + vec3(e, 0., 0.))), t2 = tap(normalize(os - vec3(e, 0., 0.)));
  vec3 t3 = tap(normalize(os + vec3(0., e, 0.))), t4 = tap(normalize(os - vec3(0., e, 0.)));
  vec3 avg = (t1 + t2 + t3 + t4) * .25;
  float sharp = .34 + 1.35 * (1. - smoothstep(.06, .55, os.z)) + .70 * (1. - smoothstep(.08, .50, z));
  base = clamp(base + (base - avg) * sharp, 0., 1.3);

  /* rasmning o'z yorug'ligini olib tashlab, harakatlanuvchisini qo'yamiz */
  float baked = BA + BK * max(dot(os, BL), 0.);
  vec3 alb = base * (.55 / max(baked, .10));

  /* gravyura relyefi — rasmning o'z gradientidan */
  float gx = lum(t1) - lum(t2), gy = lum(t3) - lum(t4);
  vec3 nb = normalize(n + vec3(-gx, -gy, 0.) * 2.3);

  float dif = .46 + .62 * max(dot(nb, uL), 0.);
  float shin = smoothstep(.26, .68, lum(base));   /* lentalar silliq, to'qima — yo'q */
  vec3 H = normalize(uL + vec3(0., 0., 1.));
  float spe = pow(max(dot(nb, H), 0.), 52.) * shin;
  float swp = pow(max(dot(nb, normalize(uL * .4 + vec3(0., 0., 1.))), 0.), 9.) * shin * .22;
  float fres = pow(1. - z, 3.2);

  vec3 gold = vec3(1., .865, .615);
  vec3 c = alb * dif + gold * spe * 1.05 + gold * swp + gold * fres * .16 * shin;
  c += vec3(.94, .76, .46) * pow(1. - z, 7.) * .13;
  c += gold * pow(1. - z, 14.) * .30 * (.35 + .65 * shin);   /* silliqlangan kant */
  c = mix(c, c * vec3(.30, .255, .205), back);
  float lg = lum(c); c = mix(vec3(lg), c, 1.10);
  c = pow(clamp(c, 0., 1.), vec3(1. / 1.02));
  float aa = smoothstep(1., .982, r2);
  gl_FragColor = vec4(c * aa, aa);
}`;

export default function LogoSphere3D({ onLowFps, size = 320 }: LogoSphere3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  // Hover tilt — faqat desktopda; rAF ichida o'qiladi, shuning uchun ref.
  const tilt = useRef({ x: 0, y: 0 });
  const onLowFpsRef = useRef(onLowFps);
  onLowFpsRef.current = onLowFps;

  // TZ §7.4 — hover tilt FAQAT desktop'da (hover + fine pointer). Touch'da
  // umuman ulanmaydi (mobil qurilma o'z gestlarini erkin qilsin).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!mql.matches) return;
    const el = wrapRef.current;
    if (!el) return;
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tilt.current.x = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1));
      tilt.current.y = Math.max(-1, Math.min(1, ((ev.clientY - r.top) / r.height) * 2 - 1));
    };
    const onLeave = () => {
      tilt.current.x = 0;
      tilt.current.y = 0;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const gl = cv.getContext("webgl", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      // WebGL yo'q — LoginPageClient statik logotipga o'tsin.
      onLowFpsRef.current?.();
      return;
    }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("[LogoSphere3D]", gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, "aP");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[LogoSphere3D]", gl.getProgramInfoLog(prog));
      onLowFpsRef.current?.();
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uInv = gl.getUniformLocation(prog, "uInv");
    const uL = gl.getUniformLocation(prog, "uL");
    const uS = gl.getUniformLocation(prog, "uS");
    const uAsp = gl.getUniformLocation(prog, "uAsp");
    gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Rasm kelguncha — iliq qorong'i piksel (oq chaqnash bo'lmasin).
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
      new Uint8Array([20, 14, 8]));

    let ready = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Mip-darajalar ATAYLAB yo'q: chetda GPU qo'pol darajani tanlab, butun
      // siluet bo'ylab xira halqa hosil qilardi (2026-09-01 da tuzatildi).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      ready = true;
    };
    img.onerror = () => onLowFpsRef.current?.();
    img.src = LOGO_SPHERE_SRC;

    const DPR = Math.min(3, window.devicePixelRatio || 1);
    const resize = () => {
      const w = cv.clientWidth || size;
      const h = cv.clientHeight || size;
      // Buferga shift: zaif telefonda pikselga besh marta murojaat qilinadi.
      const k = Math.min(DPR, 900 / Math.max(w, h));
      const px = Math.round(w * k);
      if (cv.width !== px) {
        cv.width = px;
        cv.height = Math.round(h * k);
      }
      gl.viewport(0, 0, cv.width, cv.height);
    };

    let raf = 0;
    let t0: number | null = null;
    let probeStart: number | null = null;
    let frames = 0;
    let reported = false;
    // Silliq hover: rAF ichida maqsad qiymatga yaqinlashamiz.
    let hx = 0;
    let hy = 0;

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      if (t0 === null) t0 = ts;
      const t = (ts - t0) / 1000;
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (!ready) return;

      // FPS probe. MUHIM: yashirin (background) tabda brauzer rAF'ni ataylab
      // sekinlashtiradi — o'lchov u yerda yolg'on chiqadi va logotip bekorga
      // statik holatga tushib qolardi. Shuning uchun sahifa ko'rinmayotgan
      // bo'lsa o'lchov to'xtaydi va qaytganda boshidan boshlanadi.
      if (!reported) {
        if (typeof document !== "undefined" && document.hidden) {
          probeStart = null;
        } else if (probeStart === null) {
          probeStart = ts;
          frames = 0;
        } else {
          frames += 1;
          const el = ts - probeStart;
          if (el >= 1000) {
            reported = true;
            // Kam kadr = o'lchov ishonchsiz (birinchi kadrlar kompilyatsiya va
            // rasm yuklanishiga ketadi) — bunday holatda qaror qabul qilmaymiz.
            if (frames >= 10 && (frames * 1000) / el < 45) onLowFpsRef.current?.();
          }
        }
      }

      hx += (tilt.current.x - hx) * 0.06;
      hy += (tilt.current.y - hy) * 0.06;
      // ±10°: shundan katta burchakda suratda bo'lmagan yarim oy sezilib qoladi.
      const yaw = Math.sin(t * 0.5) * 0.175 + hx * 0.1;
      const pit = Math.sin(t * 0.34 + 1.1) * 0.088 + hy * 0.06;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pit), sp = Math.sin(pit);
      // R = Ry(yaw)·Rx(pit); sheyderga teskarisi (transponirovka) uzatiladi.
      const R = [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp];
      gl.uniformMatrix3fv(uInv, false,
        new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]));

      const la = t * 0.85;
      const lx = Math.sin(la) * 0.62, ly = 0.5 + Math.sin(la * 0.7) * 0.16, lz = 0.78;
      const ln = Math.hypot(lx, ly, lz);
      gl.uniform3f(uL, lx / ln, ly / ln, lz / ln);
      const mn = Math.min(cv.width, cv.height) || 1;
      gl.uniform2f(uAsp, cv.width / mn, cv.height / mn);
      gl.uniform1f(uS, 1.055);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      img.onload = null;
      img.onerror = null;
      // WEBGL_lose_context ATAYLAB chaqirilmaydi. React (dev, StrictMode)
      // effektni ikki marta ishga tushiradi: mount → cleanup → mount. Bitta
      // <canvas> esa har doim BITTA GL kontekst qaytaradi — cleanup uni
      // o'ldirsa, ikkinchi mount o'lik kontekstni oladi va sheyder umuman
      // kompilyatsiya bo'lmaydi (logotip jimgina statikka tushib qolardi).
      // Kontekst canvas elementi bilan birga tabiiy yo'q qilinadi.
    };
  }, [size]);

  return (
    <div ref={wrapRef} style={{ width: size, height: size }} aria-hidden>
      <canvas ref={cvRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
