# Arxitektura qarorlari (ADR)

> Planner (P) tomonidan yuritiladi. Har bir qaror: kontekst → qaror → sabab. O'zgartirish kerak bo'lsa — yangi yozuv bilan bekor qilinadi, tarix o'chirilmaydi.

---

## ADR-001 — Texnologik stek (2026-07-02)

**Kontekst:** TZ ikki kirish nuqtasini talab qiladi (Telegram mini-app + veb-sayt), yagona ma'lumotlar bazasi, rus tilidagi interfeys, ~1000 tosh turi / o'n minglab plitalar hajmida tez qidiruv, rollarga bo'lingan kirish, foto saqlash, zaif internetga chidamlilik.

**Qaror:**

| Qatlam | Tanlov |
|---|---|
| Framework | **Next.js (App Router) + TypeScript (strict)** — veb-sayt ham, Telegram Mini App ham bitta ilova (Mini App = shu saytning Telegram ichidagi ko'rinishi) |
| Ma'lumotlar bazasi | **PostgreSQL** (lokal dev: docker-compose; prod: mavjud VPS'dagi Docker yoki managed Postgres — deploy bosqichida aniqlanadi) |
| ORM | **Prisma** — migratsiyalar + type-safety |
| Telegram bot | **grammY** (fotozapros vazifalari, bildirishnomalar) — alohida modul, keyingi sprintlarda |
| UI | Tailwind CSS (+ keyinroq shadcn/ui), interfeys tili — **ruscha** |
| Test | Vitest |
| Foto saqlash | Keyinroq hal qilinadi (S3-compatible yoki VPS disk) — foto sprintida ADR yoziladi |

**Sabab:** bitta kod bazasi ikkala kirishni ham qoplaydi (TZ §5.9); Postgres+Prisma murakkab domen modeli (partiya/plita/boy/bron) va tranzaksion ro'yxatdan chiqarish (double-sale himoyasi, TZ §7) uchun tabiiy tanlov; jamoada Next.js/Vercel ekotizimi tayyor.

## ADR-002 — Hisob birligi: dona + m² birga (2026-07-02)

TZ §4.7 dagi Mulk Pro tavsiyasi default sifatida qabul qilindi: partiyada **plita soni HAM maydon (m²) HAM** saqlanadi. B2C donalab, B2B m² lab sotadi. Zavsklad boshqacha demasa shu qoladi (TZ §11.1 ochiq savol).

## ADR-003 — Bron muddati: default 3 kun, sozlanadigan (2026-07-02)

TZ §4.4/§11.3: bron muddati konfiguratsiyada saqlanadi (default 3 kun), muddat o'tsa avtomatik «В наличии»ga qaytadi. Onyx aniqlashtirsa faqat config o'zgaradi.

## ADR-004 — Plita «kerak bo'lganda ajratiladi» — modelning o'zagi (2026-07-02)

TZ §4.1 qat'iy talabi: priyomkada faqat partiya kiritiladi; plita (slab) yozuvi faqat fotozapros/B2C tanlov paytida partiyadan «ajratib» yaratiladi. Sxema shu tamoyilga qurilishi SHART — partiya miqdori = erkin qoldiq + ajratilgan plitalar + sotilganlar, hisob doim sxoditsya bo'lishi kerak.

## ADR-005 — Partiya statusi va erkin qoldiq saqlanmaydi, hisoblanadi (2026-07-03)

**Kontekst:** S1-B review'da T2 taklifi (docs/data-model.md §1.2, §3): saqlangan qoldiq/status vaqt o'tib fakt bilan drift beradi.

**Qaror:** `Batch` uchun status va erkin qoldiq alohida ustunda SAQLANMAYDI — har doim formuladan hisoblanadi (data-model.md §3 dagi invariant). Faqat `Slab`/`Piece` statusi saqlanadi. Erkin qoldiqni manfiy qiladigan har qanday amal tranzaksiya ichida rad etiladi.

**Sabab:** hisoblangan qiymat yolg'on gapira olmaydi (TZ §9 — tizimga ishonch bosh risk); ikki manba (saqlangan + fakt) sinxron ushlab turish xato manbai.

## ADR-006 — SaleRecord alohida entity; bron uchun BATCH_VOLUME turi (2026-07-03)

**Kontekst:** S1-B review qaroriy nuqtalari (data-model.md §1.12, §1.6).

**Qaror:**
1. **SaleRecord** — alohida jadval, S1-C sxemasiga KIRADI (faqat AuditLog Json'ida emas): `managerId, customerName, customerContact?, targetType, slabId?/pieceId?/batchId?, qtySlabs?, qtyAreaM2?, price?, soldAt`. Sotuv amali, SaleRecord va AuditLog yozuvi — bitta tranzaksiyada.
2. **Reservation.BATCH_VOLUME** — tasdiqlandi: B2B «hajmni ushlab turish» broni modelda qoladi (TZ §4.4 ning B2B'ga tabiiy davomi).

**Sabab:** TZ §5.4 «история: что, когда, кому ушло» hisobot talab qiladi — Json ichidan qidirish o'rniga birinchi kundan strukturali jadval arzon; keyin qo'shish — ma'lumot ko'chirish og'rig'i.

## ADR-007 — Partiya-darajali pessimistik qulf (`SELECT … FOR UPDATE`) qoldiqqa ta'sir qiluvchi barcha tranzaksiyalarda (2026-07-04)

**Kontekst:** ADR-005 bo'yicha partiyaning erkin qoldig'i saqlanmay, §3 formuladan hisoblanadi. Turli amallar formulaning turli kirishlarini o'zgartiradi (hajm-sotuv — soldDirect hisoblagichlari; to'g'ridan-to'g'ri boy — Piece originSlabId=null). Bir amalning «o'qish → tekshirish → yozish» oralig'ida ikkinchi amal boshqa kirishni o'zgartirsa, ikkalasi ham tekshiruvdan o'tib qoldiqni manfiyga tushirishi mumkin (S2-B reviewda topilgan, regression bilan ko'paytirilgan: qoldiq −1/−2 ga tushgan).

**Qaror:** Partiyaning §3 hisobiga ta'sir qiluvchi HAR QANDAY tranzaksiya boshida — birinchi operator sifatida — partiya satri `lockBatchForUpdate(tx, batchId)` (`SELECT id FROM "Batch" WHERE id = ${id} FOR UPDATE`) bilan qulflanadi, so'ng qoldiq qulf ostida qayta o'qib tekshiriladi. Yagona yordamchi: `src/lib/batch-lock.ts`. Hozir qamrab olingan: `sellBatchVolume`, `sellWholeBatch`, `reserveBatchVolume`, `registerDirectPiece`. Qoldiqqa neytral amallar (`sellUnit`, `breakSlab`, `splitSlab` — allaqachon ajratilgan birlik statusini o'zgartiradi, formula kirishini emas) qulflanmaydi.

**MAJBURIYAT (kelajakdagi ishlar uchun):** yangi qoldiq-o'zgartiruvchi yozuv yo'li qo'shilganda — ayniqsa **SEPARATE_SLAB** (B2C fotozapros oqimida plita ajratish, `count(Slab)` ni o'zgartiradi) va **ADJUSTMENT** (inventarizatsiya, slabsAdjusted/areaAdjusted) — u ham `lockBatchForUpdate` ni chaqirishi SHART. Aks holda oversell oynasi qayta ochiladi.

**Sabab:** ilova-darajali qulf sxema o'zgarishisiz (migratsiya yo'q) modullararo poyga oynasini yopadi; har tranzaksiya ko'pi bilan bitta partiyani qulflaydi — deadlock xavfi yo'q. Muqobil (barcha tranzaksiyalarni Serializable) ko'proq retry va murakkablik keltirardi.
