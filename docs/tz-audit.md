# Onyx — TZ qamrov auditi (spec vs kod)

**Sana:** 2026-07-21 · **Manba:** `tz-onyx-sklad.md` (to'liq TZ) · **Metod:** 6 parallel read-only audit, har talab kodga qarshi tekshirilgan (dalil: `file:line`).
**Belgilar:** ✅ bajarilgan · ⚠️ qisman · ❌ yo'q · 🐞 xato.

> Qisqacha: ombor **yadrosi** (приёмка → поиск → бронь → продажа → разбить) yaxshi va mustahkam qilingan. TZ'ning bir necha **butun bo'limi** hali yo'q (QR+интерьер, дизайнер/лид, оффлайн, Telegram mini-app, возврат, on-demand plita, tarix UI). Plus 5 ta real xato. Quyida to'liq.

---

## 1. Yaxshi ishlaydigan yadro (✅ solid)

| Soha | Tafsilot | Asosiy dalil |
|---|---|---|
| Ma'lumot modeli (§4.1, §4.7) | StoneType/Batch/BatchLocation/Slab/Piece; plita **va** m² (DB CHECK «kamida bittasi»); partiya bir nechta lokatsiyada | `schema.prisma:112,138,169,188,224`; `inventory.ts:65-99` |
| Приёмка (§5.1, §6.3) | tez, batch-darajasida, plita yozilmaydi; yangi tosh turini joyida yaratish; ko'p lokatsiya | `priemka/actions.ts:145-186`; `IntakeForm.tsx:188-233,298-367` |
| Поиск (§5.2, §6.5) | вид/тип/цвет; габарит **допusk 20mm + 90° rotation**; **остатки/бой FIRST** (alohida blok, eng kichik mos birinchi) | `inventory.ts:8,108-121`; `poisk/page.tsx:270-308,385-428` |
| Бронь (§4.4, §6.6, §7) | срок (default 3, cap 60); kim/kim uchun (NOT NULL); owner hammasini ko'radi; ikki-marta sotish/bron himoyasi (conditional update + FOR UPDATE + partial unique); forbidden transitions; пересорт `needsCheck` | `reservations.ts:204-283,546-609`; `sales.ts:121-138,457-471`; `bron/page.tsx:124-128,320-325` |
| Продажа (§5.4, §6.2, §7) | darhol списание (bitta tranzaksiya); B2C plita / B2B m² / оптом целиком; **учёт to'g'ri sxoditsya** (phantom stock yo'q) | `sales.ts:412-514,697-716,786-865`; `inventory.ts:65-99` |
| Разбить/бой (§5.6, §6.4) | plita→BROKEN_OFFCUT + Pieces (габарит); AI-shape → chertyoj → tomonlar; **API-key'siz graceful degrade** | `breaking.ts:388-503`; `singan/*`; `ai-shape.ts:91-170` |
| Фото (§5.3) | «возможно, переснять» eskilik flagi (test bilan); foto **abadiy + reuse**; BUG-04 delivery status/retry | `photos.ts:64`; `PhotoLightbox.tsx:136-141`; `photo-requests.ts` |
| Роллар (§3) | 4 rol enum + capability matrix + deny-by-default + sahifa/action gate (test bilan) | `permissions.ts:80-138`; `nav-access.ts:13-30`; `karta-sklada/page.tsx:48` |
| Auth | Telegram magic-link login | `login/tg/route.ts`; `telegram-webhook.ts:274-324` |

---

## 2. ❌ Butunlay yo'q — katta funksiyalar (TZ da bor, kodda yo'q)

1. **QR-katalog + AI-interyer (§6.7).** `qrSlug` yoziladi (`priemka/actions.ts:137`), lekin **hech qachon o'qilmaydi** (`grep qrSlug src/` → read yo'q); scan/slug route yo'q; `PhotoKind.INTERIOR_AI` (`schema.prisma:80`) ishlatilmaydi; interyer generatsiyasi yo'q (`ai-shape.ts` — faqat siniq tosh silueti). Mijoz uchun QR-differensiatsiya ham yo'q.
2. **Dizayner/partner oqimi (§6.8).** `PARTNER` — faqat enum; `requestsRouteToManager` (`permissions.ts:131`) kodda ishlatilmaydi. Partner UI yo'q, fayl (textura/3D) yuklab olish yo'q, hajm-so'rov formasi yo'q, **Lead/заявка modeli yo'q** → «ни один интерес не теряется» bajarilmagan.
3. **Offline-chidamlilik (§7, §8).** `grep offline|service-worker|outbox|indexeddb|queue|navigator.onLine` → **0**. PWA manifest yo'q. Zaif internetda bajarilgan amal **yo'qoladi**. (`PhotoDispatch` retry — bu server-tomon Telegram, klient offline emas.)
4. **Telegram mini-app pariteti (§5.9).** `grep mini-app|WebApp|initData` → **0**. Telegram — faqat bildirishnoma + login + foto-vazifa boti. Barcha funksiya (поиск/продажа/бронь/приёмка/разбить) **faqat saytda**. §5.9 «одинаково в двух средах» bajarilmagan.
5. **Mijozdan qaytarish — Возврат (§4.3).** `RETURNED` status enum'da bor (`schema.prisma:29`) va sotuvда bloklanган, lekin **hech qanaqa kod uni o'rnatmaydi** (grep → 0 writer). Qaytarish oqimi va «проверка → В наличии» o'tishi yo'q.
6. **Plita on-demand «ajratish» (§4.1 3-daraja).** Schema tayyor (`Slab.separatedById`, `photoRequestId`, `SEPARATE_SLAB` enum), lekin **kod hech qachon `slab.create` qilmaydi** (faqat `prisma/seed.ts`). Fotozapros javobida foto `slabId=null` bilan biriktriladi (`telegram-webhook.ts:508-547`) → «клиент выбрал плиту №2» ishlamaydi. Bu TZ «внедряемость» yadrosi.
7. **Tarix ko'ruvchi UI (§8).** AuditLog to'g'ri va tranzaksion to'ldiriladi (INTAKE/SALE/RESERVE/BREAK/MOVE/SPLIT…), lekin **uni o'qiydigan UI yo'q** (`grep auditLog.find src/app` → 0). Faqat bron tarixi bor (`bron/page.tsx:371`). Egа «действия сотрудников»ni ko'ra olmaydi.

---

## 3. 🐞 Xatolar — mavjud narsada (correctness)

1. **Foto noto'g'ri toshga biriktriladi (§5.3).** `telegram-webhook.ts:508-519` — eng eski PENDING so'rovga (FIFO `createdAt asc`), складчик qaysi toshni suratga olganini ko'rsata olmaydi. ≥2 ochiq so'rovda foto boshqa tosh/menejerga ketadi. «Складчик не может перепутать» buziladi.
2. **Tosh kartochkasi mijoz/partnerga qoldiq+lokatsiya ko'rsatadi (§4.6, §6.7).** `kamen/[id]/page.tsx:295-364` `canSeeExactRemainder`ni tekshirmaydi — наличие/plita/блок/ориентир hamma rolga chiqadi; faqat **narx** gated. «Клиент не видит складских остатков» buziladi.
3. **Zakup narxi/marja hech kimga ko'rsatilmaydi, sozlash o'lik (§5.8).** `permissions.ts:100`da «настраивается» ulanган, lekin `kamen/[id]/page.tsx:662` «purchasePrice не показываем»; marja hisobi yo'q; `User.canSeePurchasePrice`ni o'zgartiradigan settings UI yo'q. Ega ham marjani ko'rmaydi.
4. **Поискда material filtri размер bilan tushib qoladi (§5.2/§6.5).** `poisk/page.tsx:272-301` остатки so'rovi `q` (вид/тип/цвет) filtrini qo'llamaydi → вид «мрамор» + размер qidirilса, «предложить первыми» blokda **boshqa jinsdagi** остатки chiqadi (butun plita ro'yxati esa filtrlangan — nomuvofiqlik).
5. **Bron avto-tugashi cron'siz (§4.4).** `expireOverdueReservations()` faqat `/bron` yoki `/fotozapros` render'ida ishlaydi (lazy sweep); cron/scheduled job yo'q (`reservations.ts:540` «cron YO'Q» izohi). Hech kim `/bron` ochmasa, muddati o'tган bron DB'da `RESERVED` bo'lib qoladi va /poisk/kamen'da bron ko'rinadi. (Sotuv/yangi-bron yo'llari «expired=free» bilan himoyalanган, ya'ni noto'g'ri blok bo'lmaydi, lekin «автоматически возвращается» to'liq emas.)

---

## 4. ⚠️ Qisman / kichik

- **Поискда butun plita natijalarida lokatsiya yo'q (§5.2)** — faqat остаткида блок+ориентир ko'rsatiladi; butun plita uchun `/kamen`ga o'tish kerak. `poisk/page.tsx:461-496`.
- **«Разбить»да sotilgan qism SaleRecord bermaydi (§5.6/§8)** — `breaking.ts:482-485` faqat AuditLog(SPLIT)ga yozadi; sotuv tarixida ko'rinmaydi. Учёт to'g'ri, faqat revenue/buyer tarixda yo'q.
- **Sotuv tarixi faqat oxirgi 20** (`prodazha/page.tsx:126`); to'liq tarix/filtr/sana-diapazon yo'q.
- **Складчик web-fotozapros ro'yxatiga kira olmaydi** — bosh sahifada «Фото в очереди» count ko'radi, lekin `/fotozapros` WAREHOUSE'ni rad etadi (`permissions.ts:115`); count global, «uning» vazifasi emas.
- **«руководитель» tushunchasi yo'q** — `User` modelида ierarxiya yo'q; osilgan vazifani rahbarga ko'rsatib bo'lmaydi (§7).
- **Menejerга «mijozga yuborish» tugmasi yo'q** — faqat ochiq foto-URL (`api/photo/[id]`); in-system forward/share yo'q (§6.1.7).
- **Til:** Telegram vazifa matni va складчик xabarlari **o'zbekcha**, TZ §8 ruscha talab qiladi.
- **Minor:** `takenAt` = webhook qabul vaqti (EXIF emas); yangi tosh turida `properties/description/basePrice` yig'ilmaydi; lokatsiya `slabsHere/areaHereM2` yig'indisi batch totalга tekshirilmaydi.

---

## 5. 🔒 Xavfsizlik eslatmasi (muhim)

**Demo-role cookie shim** (`session.ts:16-20`, `DemoRoleSwitcher.tsx`): hozir har qanaqa tashrifchi `onyx_demo_role` cookie orqali **istalgan rolni (OWNER ham) o'ziga bera oladi**. Kod buni R6 (login) gача vaqtincha deб belgilaydi, lekin **jonli production'da bu ochiq** — narx/marja/boshqaruv sahifalari himoyasiz. Deploy production bo'lgani uchun bu ustuvor.

---

## 6. Tavsiya etilgan tartib

**To'lqin 1 — xatolar (arzon, xavfli):** §3.5 bron cron (yoki Vercel cron) · §3.2 tosh kartochka qoldiqni rolга ko'ra yashirish · §5 demo-role production'da o'chirish/himoyalash · §3.4 poisk material filtri · §3.1 foto-so'rov disambiguation.
**To'lqin 2 — o'rta funksiyalar:** §2.7 tarix UI · §2.5 возврат oqimi · §2.6 on-demand plita ajratish + foto→slab · §4 «разбить» SaleRecord · til RU.
**To'lqin 3 — katta yangi bo'limlar:** §2.1 QR+интерьер · §2.2 дизайнер/лид · §2.3 offline (PWA/outbox) · §2.4 Telegram mini-app.

> Metod (avvalgi 6 bug kabi): har biriga o'rganish → developer → adversarial reviewer → jonli tekshiruv → approval → commit.
