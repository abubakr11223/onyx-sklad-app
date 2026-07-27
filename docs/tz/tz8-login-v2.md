# TZ №8 v2 — /login redizayn: dark premium + 3D logo-sfera

**Status:** APPROVED (2026-07-27)
**Sana:** 2026-07-27
**Skop:** faqat `/login` sahifasi vizuali. Funksional (auth, submit, redirect, routelar) tegilmaydi.

---

## §1. Maqsad

`/login` sahifasini "korporativ default"dan **premium dark identity**ga o'tkazish: markazda oltin-oq 3D logo-sfera aylanadi, uning ostida shisha-effektli login karta. Bosh brend taassuroti — birinchi 2 soniyada.

## §2. Non-goals (TEGILMAYDI)

- `loginWithPassword` server-action va uning validation'i.
- `/login/tg` magic-link route.
- Session cookie, `tokenVersion`, redirect logikasi.
- Boshqa route'lar (`/`, `/accounts`, `/photos` va h.k.) — dark tema global qilinmaydi, faqat `/login`.
- Uch.js har qanday boshqa sahifada — FAQAT `/login`.

**Yashil qolishi shart:** mavjud login-oid barcha testlar (session v2, magic-link, timing-safe compare, form validation). Har commit'da to'liq `npm test` — regression bo'lmasin.

## §3. Ranglar va dizayn tokenlari (AYNAN)

Barcha ranglar `/login/page.tsx` scope'ida (CSS variable yoki Tailwind arbitrary values). Global `globals.css`ga chiqarilmaydi.

| Token | Qiymat | Ishlatilishi |
|---|---|---|
| `--login-bg-base` | `#0B0B0D` | Sahifa foni (bazoviy) |
| `--login-bg-radial` | `radial-gradient(ellipse at 50% 30%, #1A1712 0%, #0B0B0D 60%)` | Radial gradient overlay |
| `--login-gold-main` | `#C9A55C` | ASOSIY oltin — sfera material, tekst gradient asosi |
| `--login-gold-hi-1` | `#E9CF8F` | Highlight ochroq (halo, glow, hover) |
| `--login-gold-hi-2` | `#F5E7C0` | Highlight eng ochig'i (sparkle, focus glow) |
| `--login-gold-glow` | `rgba(233, 207, 143, 0.35)` | Halo va tekst glow (E9CF8F asosida) |
| `--login-card-bg` | `rgba(20, 18, 28, 0.6)` | Shisha karta foni |
| `--login-card-border` | `rgba(201, 165, 92, 0.15)` | Karta gardishi (C9A55C asosida) |
| `--login-card-blur` | `24px` | `backdrop-filter: blur(...)` |
| `--login-text-primary` | `#F5F0E8` | Sarlavha va label |
| `--login-text-muted` | `rgba(245, 240, 232, 0.6)` | Yordamchi matn |
| `--login-input-bg` | `rgba(255, 255, 255, 0.04)` | Input foni |
| `--login-input-border` | `rgba(201, 165, 92, 0.2)` | Input gardishi |
| `--login-input-border-focus` | `#E9CF8F` | Focus gardish (highlight) |
| `--login-error` | `#FF6B6B` | Xato matni |

## §4. Layout

- Full-viewport (`100dvh`). `overflow: hidden`.
- Markazlashgan flex-column: `[3D sfera 40vh]` + `[karta max-w 420px]`.
- Mobil (≤640px): sfera 32vh, karta padding kamaytiriladi (24 → 20).
- Karta: `border-radius: 20px`, ichki padding `40px 32px` (desktop) / `28px 20px` (mobil).

## §5. Tipografiya

Fontlar `next/font/google` orqali (self-hosted, external network yo'q, CLS himoyasi):

- **"ONYX"** wordmark: **Lora** (weight 400 yoki 500). Hajm `44px` (desktop) / `36px` (mobil). `letter-spacing: 0.15em`. Oltin gradient: `background: linear-gradient(135deg, #E9CF8F 0%, #C9A55C 50%, #F5E7C0 100%); -webkit-background-clip: text; background-clip: text; color: transparent;`. `text-shadow: 0 0 32px var(--login-gold-glow)` (element ustida qo'shimcha `<span>` bilan, aks holda gradient bilan ziddiyat).
- **"stones boutique"** subtitle: **Montserrat** (weight 300). Hajm `11px` (desktop) / `10px` (mobil), `letter-spacing: 0.4em`, `text-transform: uppercase`. Rangi `--login-text-muted`.
- Form label / input / button: mavjud sans (system) — qo'shimcha font YO'Q (bundle himoyasi).

**Font sub-set:** Lora `latin` + Cyrillic (aslida `latin` yetadi — "ONYX" faqat Lotin). Montserrat `latin`. `display: 'swap'` — 3D yuklanguncha matn oldindan chiqadi.

## §6. 3D sfera — parametrlar (AYNAN)

Fayl: `src/components/login/LogoSphere3D.tsx`. Import faqat `next/dynamic({ ssr: false })` orqali.

### 6.1. Geometriya — TubeGeometry lenta-globus
- `THREE.TubeGeometry(curve, tubularSegments=400, radius=0.04, radialSegments=8, closed=true)`
- `curve` = 6 ta `CatmullRomCurve3` chiziqli superpozitsiyasi: har biri sfera yuzasi (radius 1) bo'ylab parametric spiral (`theta`, `phi` funksiyalari), inclination `[15°, 30°, 45°, 60°, 75°, 90°]`.
- Natija: sfera yuzasini o'rab olgan **6 ta oltin lenta**, ular kesishib globus taassurotini beradi. To'liq to'lgan shar EMAS.

### 6.2. Material
- `THREE.MeshStandardMaterial`
- `color: 0xC9A55C` (ASOSIY oltin — highlight #E9CF8F/#F5E7C0 yorug'lik reflex'ida chiqadi)
- `metalness: 0.9`
- `roughness: 0.25`
- `envMapIntensity: 1.2`

### 6.3. Sahna
- Camera: `PerspectiveCamera(fov=45, position=[0, 0, 3.2])`
- Yorug'lik: **avval `<Environment preset="studio">` (drei) sinaladi**. Bundle audit'da bu preset katta ekanligi aniqlansa — `preset="sunset"` bilan solishtiriladi (screenshot). Ikkalasi ham +250 KB budget'ni sindirsa — Environment o'chiriladi va **qo'lda light rig** ishlatiladi:
  - `ambientLight(intensity=0.4, color=#2A2418)` (iliq soya)
  - `directionalLight(position=[3, 4, 3], intensity=1.4, color=#FFF5E0)` (asosiy kalit nur)
  - `pointLight(position=[-3, 2, 2], intensity=0.6, color=#E9CF8F)` (oltin rim-light)
  - `pointLight(position=[0, -3, 2], intensity=0.3, color=#F5E7C0)` (pastdan yumshoq to'ldirish)
  Qaror bundle-report bosqichida yoziladi.
- Halo: sfera atrofida `<mesh>` — `SphereGeometry(radius=1.15)`, `MeshBasicMaterial({ color: 0xE9CF8F, transparent: true, opacity: 0.08, side: BackSide })` — yumshoq nur (highlight rangi).
- Sparkles (drei): `count=40`, `scale=[3, 3, 3]`, `size=2`, `speed=0.3`, `color=#F5E7C0`. **Sparkles TZ talabidir, olib tashlanmaydi.**

### 6.4. Aylanish (idle)
- Y-axis: `0.15 rad/s` (default).
- X-axis: `0.05 rad/s` (default).
- Uzluksiz, `useFrame` orqali.

### 6.5. Canvas
- `dpr={[1, 2]}` (retinada 2x, aks holda 1x — bundle emas, GPU tejash).
- `gl={{ antialias: true, alpha: true }}`
- `frameloop: "always"` (idle animatsiya uchun).

## §7. Motion va interaksiya (AYNAN)

Framer Motion faqat karta va matnda; 3D sfera Three'ning `useFrame` bilan.

### 7.1. Karta paydo bo'lishi
- Karta: `initial={{ opacity: 0, y: 20 }}`, `animate={{ opacity: 1, y: 0 }}`, `transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}` (out-expo).
- Sarlavha `delay: 0.2`, karta ichki elementlar stagger `0.08`.

### 7.2. Input focus
- `border-color` transition: `0.2s ease-out` (`--login-input-border` → `--login-input-border-focus`).
- Focus glow: `box-shadow: 0 0 0 3px rgba(245, 217, 142, 0.15)` (transition 0.2s).

### 7.3. Button (Submit)
- Idle: gradient `linear-gradient(135deg, #F5D98E 0%, #B8894A 100%)`, matn `#0A0A0F`, `font-weight: 500`.
- Hover (desktop): `scale: 1.02`, `box-shadow: 0 8px 24px rgba(245, 217, 142, 0.25)`, transition `0.2s`.
- Active: `scale: 0.98`.
- Loading: matn "Кираяпмиз..." + spinner (SVG); button disabled.

### 7.4. Sfera hover tilt (FAQAT desktop)
- `window.matchMedia("(hover: hover) and (pointer: fine)")` true bo'lganda faqat.
- Sichqoncha koordinati sfera markazidan farqiga proporsional Y/X-axis tilt: `±0.3 rad`, lerp `0.05`.
- Hover'da aylanish tezligi 1.5x oshadi (0.15 → 0.225 rad/s).
- Touch qurilmasida umuman ulanmaydi.

## §8. Fallback zanjiri (majburiy)

Tartib: yuqoridan pastga. Har biri o'zining trigger'iga qarab tanlanadi.

1. **3D yuklanmoqda** (Suspense fallback): sfera o'rniga statik SVG logo (aynan bir xil rangda — `--login-gold-1` filled circle + 6 elliptic outline for band imitation). O'lchami sfera bilan bir xil. `animate={{ opacity: [0.4, 0.8, 0.4] }}` — yumshoq nafas oluvchi glow.
2. **Zaif qurilma — GIBRID (statik + probe)**:
   - **Bosqich 2a (statik, mount'gacha)**: `navigator.deviceMemory <= 4` (undefined bu shartni ISHGA TUSHIRMAYDI — modern desktop'lar undefined qaytarishi mumkin) YOKI `navigator.hardwareConcurrency <= 4` → **Canvas umuman mount qilinmaydi**, darhol statik logo + CSS glow (box-shadow pulse, 3s, ease-in-out). Bu "bir zumga ko'rinish" muammosini oldini oladi.
   - **Bosqich 2b (dinamik FPS probe)**: Statik tekshiruv o'tsa, Canvas mount bo'ladi. `useFrame` ichida 1s davomida FPS o'lchanadi (frame counter / delta). Agar 1s dan keyin FPS <45 bo'lsa — Canvas unmount, statik logo + CSS glow'ga o'tadi. Aks holda animatsiya davom etadi.
3. **`prefers-reduced-motion: reduce`**: Canvas umuman render qilinmaydi. Statik SVG logo, hech qanday animatsiya (glow ham yo'q).
4. **JS o'chirilgan / hydration xatosi**: `<noscript>` orqali statik SVG logo. Form baribir HTML level'da submit qiladi (bu allaqachon shunday).

## §9. Accessibility

- Sfera decorative — `aria-hidden="true"`.
- Sarlavha `<h1>` — screen reader uchun "Onyx" birinchi bo'lib o'qiladi.
- Contrast: karta ustidagi barcha matn WCAG AA (4.5:1 minimum) — `--login-text-primary` (#F5F0E8) `--login-card-bg` (~#14121C) ustida ~13:1.
- Input `<label>` bog'langan (mavjud kod).
- Focus outline: `--login-input-border-focus` — ko'rinadigan (2px).
- Keyboard: Tab tartibi email → parol → submit → magic-link (agar bor bo'lsa) — o'zgarmaydi.

## §10. Performance budgets

- `/login` route JS: **+250 KB gzip'dan oshmasin** (three + drei + fiber + framer birgalikda). Baseline `npm run build` orqali oldindan yozib olinadi.
- Boshqa route'lar bundle size'i: **±2 KB dan katta o'zgarish yo'q** (three faqat `/login`da bo'lishi kerak). Build hisobotida tekshiriladi.
- **Optimizatsiya tartibi (agar +250 KB oshsa):**
  1. `three` dan faqat kerakli sub-modullarni named-import (masalan `import { WebGLRenderer } from 'three'` — Vite/webpack tree-shake).
  2. `<Environment>` preset'ini qo'lda light rig (§6.3) bilan almashtirish.
  3. drei'dan faqat `<Sparkles>` qoladi (u TZ talabi, saqlanadi).
  4. Baribir sig'masa — foydalanuvchiga raqamlar bilan qaytish, birga qaror.
- 3D chunk lazy: `next/dynamic(..., { ssr: false, loading: () => <StaticLogo /> })`.
- Karta va form DARHOL interaktiv (3D yuklanishini kutmasin).

## §11. Fayl tuzilishi

Yangi fayllar:
```
src/app/login/page.tsx              — o'zgartiriladi (dark tema, layout)
src/components/login/LogoSphere3D.tsx — Canvas + sfera
src/components/login/StaticLogo.tsx  — SVG fallback
src/components/login/LoginCard.tsx   — glass karta + Framer motion
src/lib/use-device-heuristic.ts     — deviceMemory/FPS probe hook
src/lib/use-reduced-motion.ts       — matchMedia hook
```

O'zgaradigan fayllar:
```
package.json                        — deps: three, @react-three/fiber, @react-three/drei, framer-motion
src/app/login/page.tsx              — dark redesign
```

**Auth logika, server-action, form fields, error handling** — o'zgarmaydi. Faqat wrapper JSX va CSS.

## §12. Testlash

Mavjud testlar yashil qolishi shart (session v2, magic-link, timing-safe, form validation).

Yangi testlar (Vitest, `src/tests/login-redesign.test.tsx`):
1. **Reduced-motion render**: `matchMedia('(prefers-reduced-motion: reduce)')` mock true → `LogoSphere3D` render qilinmaydi, `StaticLogo` ko'rinadi.
2. **Fallback render (SSR/no-JS shim)**: `LogoSphere3D` dynamic import → `loading` fallback (`StaticLogo`) darhol DOM'da.
3. **Forma darhol mavjud**: `render(<LoginPage />)` → `getByLabelText(/email/i)` va `getByLabelText(/парол/i)` immediately mavjud (3D yuklanishini kutmasdan).
4. **Zaif qurilma heuristikasi**: `navigator.deviceMemory = 2` mock → Canvas render qilinmaydi.
5. **Aria-hidden**: 3D wrapper `aria-hidden="true"`.

## §13. Qadamlar (har biri commit + full suite)

- **S1**: deps qo'shish (three, @react-three/fiber, @react-three/drei, framer-motion) + baseline bundle olish (docs/tz/tz8-bundle-baseline.txt).
- **S2**: dark tema, radial gradient, glass karta, Framer paydo bo'lish, input/button holatlari — §3/§6/§7 parametrlari AYNAN.
- **S3**: 3D sfera (TubeGeometry + material + Environment + halo + Sparkles).
- **S4**: hover tilt/tezlashish (faqat desktop).
- **S5**: fallback zanjiri (§8) + reduced-motion + mobil heuristika.
- **S6**: yangi testlar + build + route-size hisobot (docs/tz/tz8-bundle-report.md).

Har qadamdan keyin: `npm test` (to'liq) + `npm run build` (route size fayl'ga yoziladi) + commit.

## §14. Acceptance criteria

Yakuniy PR quyidagilarni qanoatlantirishi shart:
- [ ] Barcha eski testlar yashil (session v2, magic-link, timing, form).
- [ ] Yangi 5 test yashil.
- [ ] `npm run build` xatosiz.
- [ ] Route-size hisoboti: `/login` +250 KB gzip'dan kam; boshqa routelar ±2 KB.
- [ ] `/login` sahifasi vizual DoD: dark fon + radial gradient + shisha karta + 3D sfera aylanmoqda (desktop, tez brauzer) YOKI statik logo (mobil / reduced-motion).
- [ ] Forma birinchi frame'dan interaktiv.
- [ ] Auth flow avvalgidek ishlaydi (login → session cookie → redirect).
- [ ] PR ochilgan, MERGE QILINMAGAN.
