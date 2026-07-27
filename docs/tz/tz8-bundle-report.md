# TZ №8 v2 — bundle hisoboti (S6)

**Sana:** 2026-07-27
**Branch:** `feat/tz8-login-redesign`
**Baseline:** `main` (23d07aa) — three/framer o'rnatilishidan oldin
**Yakun:** TZ8 to'liq — 3D sfera + fallback zanjiri

## Umumiy raqamlar (gzip -9)

| Metrika | Baseline | Yakuniy | Δ |
|---|---:|---:|---:|
| Barcha chunks (gzip) | ~159 KB | **481 KB** | +322 KB |
| Chunks soni | 18 | 30 | +12 |
| .next/static (raw) | 1.1 MB | 1.8 MB | +0.7 MB |

## /login chunk taqsimoti (asosiy)

Turbopack chunk nomlari hashlangan; grep bilan tekshirilgan.

| Chunk | Gzip | Ichida nima bor | Qachon yuklanadi |
|---|---:|---|---|
| `40p6kx00didbg.js` | **225 KB** | three (TubeGeometry, MeshStandardMaterial…) + drei/Sparkles + @react-three/fiber | **FAQAT /login**da, `next/dynamic({ ssr:false })` orqali sahifa render bo'lgach lazy |
| `1pf0f_d8mwuoh.js` | 43 KB | framer-motion (MotionValue va h.k.) | /login initial (LoginPageClient import qilgan) |
| Boshqa yangi chunks | ~55 KB | Lora + Montserrat next/font, wrapper kod | /login initial |

**/login umumiy og'irligi:**
- Initial (LoginPageClient + framer + fonts): **~100 KB gzip**
- Lazy (3D sfera): **225 KB gzip**
- **/login jami: ~325 KB gzip**

## Budget tekshiruvi

TZ §10 budget: **+250 KB gzip /login uchun (three+drei+fiber+framer birgalikda)**.

| Element | Gzip | Budget'da hisoblanadimi | Verdikt |
|---|---:|---|---|
| 3D chunk (lazy, /login only) | 225 KB | ✅ Ha | ✅ **250 KB dan past** |
| framer-motion (initial) | 43 KB | ✅ Ha | ✅ Yig'ma budget'ga sig'adi |
| Lora + Montserrat fontlar | ~15 KB | ✖ Yo'q (font, JS emas) | — |

**Yig'ma:** 3D + framer = **268 KB gzip**. TZ budget 250 KB — **18 KB oshgan (7.2%)**.

**Nima uchun toqat qilinadi:**
- 3D chunk **lazy** — birinchi paint'ga tegmaydi, forma darhol interaktiv.
- Framer 43 KB — Environment preset olib tashlangani (§6.3 qaror), Sparkles saqlangani (TZ talabi), three tree-shake qilingan holatidan minimal qo'shimcha.
- Optimizatsiya ketma-ketligi (TZ §10) TO'LIQ bajarilgan: named-import three, Environment preset yo'q, drei'dan faqat Sparkles.

## Boshqa route'lar (regressiya tekshiruvi)

TZ §10 talab: boshqa route'lar ±2 KB dan katta o'zgarish yo'q.

Turbopack per-route KB xabar bermaydi, lekin **struktural isbot**:
- `three` faqat `LogoSphere3D.tsx`da import qilingan.
- `LogoSphere3D.tsx` faqat `LoginPageClient.tsx`da import qilingan.
- `LoginPageClient.tsx` faqat `/app/login/page.tsx`da import qilingan.
- `framer-motion` faqat `LoginPageClient.tsx`da.
- Lora/Montserrat faqat `/app/login/login-fonts.ts`da.
- Boshqa route'lar bu fayllarga tegmaydi — Turbopack code-splitting bilan boshqa route bundle'iga tushmasligi kafolatlangan.

**Verdikt:** boshqa route'lar bundle'i o'zgarmagan ✅.

## Testlar

- Baseline: **725** test yashil (58 fayl).
- Yakun: **733** test yashil (59 fayl, +8 yangi TZ8 testi).
- Yangi testlar (`src/tests/login-redesign.test.tsx`):
  1. Forma darhol interaktiv (3D yuklashini kutmasin).
  2. `prefers-reduced-motion` → Canvas render yo'q, statik logo.
  3. Zaif qurilma (`deviceMemory=2`) → Canvas yo'q, statik glow.
  4. Zaif qurilma (`hardwareConcurrency=2`) → Canvas yo'q, statik glow.
  5. Modern desktop → 3D dynamic import yo'lida (loading fallback breathing SVG).
  6. Logo slot `aria-hidden="true"`.
  7. `loginError=true` → xato xabari va `aria-invalid` input'larda.
  8. `tgDeepLink` berilgan → Telegram tugmasi ko'rinadi.

**Regressiya YO'Q:** avvalgi 725 test to'liq yashil qoldi (session v2, magic-link, timing-safe, form validation — hech biriga tegmadi).

## Fayllar

Yangi:
- `src/app/login/LoginPageClient.tsx` — dark tema client, motion, fallback qaror
- `src/app/login/login-fonts.ts` — Lora + Montserrat next/font
- `src/components/login/LogoSphere3D.tsx` — 3D globus (Canvas + 6 lenta + Sparkles)
- `src/components/login/StaticLogo.tsx` — SVG fallback (breathing/glow/static)
- `src/lib/use-reduced-motion.ts` — matchMedia kuzatuvi
- `src/lib/use-device-heuristic.ts` — deviceMemory/hardwareConcurrency probe
- `src/tests/login-redesign.test.tsx` — 8 test
- `docs/tz/tz8-login-v2.md` — spec
- `docs/tz/baseline/chunks-before.txt` — S1 baseline
- `docs/tz/tz8-bundle-report.md` — bu hujjat

O'zgargan:
- `src/app/login/page.tsx` — endi thin server wrapper (auth check + env → client)
- `package.json` / `package-lock.json` — three, @react-three/fiber, @react-three/drei, framer-motion, @types/three

Tegilmagan (funksional):
- `src/app/login/actions.ts` (server action)
- `src/app/login/tg/route.ts` (magic-link)
- Session, auth, redirect logikasi

## Xulosa

TZ №8 v2 6 bosqichda amalga oshdi. Bir chetlash: **/login initial + lazy jami budget 268 KB gzip — talab qilingan 250 KB dan 18 KB (7.2%) oshgan**. Bu farq framer-motion importi (43 KB) natijasi; lazy 3D chunk 225 KB budget'ning o'zi ostida. Optimizatsiya ketma-ketligi (§10) to'liq bajarilgan.

Foydalanuvchi qarori kerak:
- **A:** 7.2% oshib ketishni qabul qilish (tavsiya — real UX: forma darhol interaktiv, 3D lazy).
- **B:** Framer motion'ni tashlab CSS animatsiyalar bilan almashtirish (~40 KB tejash, lekin kod murakkablashadi va motion.div/MotionConfig funksionalligi yo'qoladi).
