# Onyx — Ma'lumotlar modeli spetsifikatsiyasi

> **Task:** S1-B · **Muallif:** T2 · **Sana:** 2026-07-03
> **Asos:** TZ §4 (uch daraja), §4.2–4.7, §5, §7; ADR-001…ADR-006.
> **Maqsad:** S1-C (Prisma domen sxemasi) uchun to'liq entity-spetsifikatsiya. Bu hujjat — kod emas, shartnoma: sxema shu yerdagi qarorlarga mos bo'lishi kerak. Nomlar kodda ishlatiladigan ko'rinishda (English), UI atamalari ruscha (TZ §8).

---

## 0. Modelning o'zagi — uch daraja va lazy ajratish

TZ §4.1 / ADR-004 bo'yicha uch daraja:

```
StoneType (Вид камня)  ←— katalog darajasi, klient shuni tanlaydi
   └── Batch (Партия)  ←— asosiy hisob birligi, priyomkada faqat shu kiritiladi
          ├── BatchLocation[]  ←— bitta partiya bir nechta joyda (TZ §4.5)
          ├── Slab[]   ←— plita partiyadan FAQAT kerak bo'lganda ajratiladi (ADR-004)
          └── Piece[]  ←— бой/остаток, har doim poshtuchno, o'z gabaritlari bilan (TZ §4.2)
```

**Qat'iy tamoyillar:**

1. Priyomkada `Slab` yozuvlari YARATILMAYDI — faqat `Batch` + `BatchLocation`. Plita fotozapros / B2C tanlov paytida ajratiladi.
2. B2B sotuv `Slab` yaratmasdan to'g'ridan-to'g'ri partiya miqdorini kamaytiradi (TZ §6.2, §7.6).
3. Hisob birligi — **dona VA m² birga** (ADR-002): `Batch` ikkala maydonni saqlaydi.
4. Har bir sotiladigan birlik (`Slab`, `Piece`, hamda `Batch` hajmi) doim aniq bitta statusga ega (TZ §4.3).

---

## 1. Entitylar

Tip yozuvi Prisma uslubida: `String`, `Int`, `Decimal`, `Boolean`, `DateTime`, `Json`, `?` = nullable. Barcha entitylarda default: `id String @id` (cuid), `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt` — jadvallarda takrorlanmaydi.

### 1.1 StoneType — Вид (sort) камня

TZ §4.1 L1, §6.7 (QR), §6.8 (dizayner fayllari).

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `name` | String | ✔ | «Травертин Classic». Katalogdagi nom. |
| `rockType` | String | ✔ | Porода: мрамор / гранит / оникс / травертин… S1-C da enum emas, string — yangi porodalar joyida qo'shiladi (TZ §5.1: yangi vid «на месте» kiritiladi). |
| `color` | String? | | Qidiruv filtri uchun (TZ §5.2: «вид/тип, размеры, цвет»). |
| `description` | String? | | Tavsif, xossalar matni. |
| `properties` | Json? | | Erkin xossalar (qattiqlik, kelib chiqish davlati…) — sxemani muzlatmaslik uchun. |
| `basePrice` | Decimal? | | Bazaviy sotuv narxi (TZ §4.1). Rol bo'yicha ko'rinadi. |
| `purchasePrice` | Decimal? | | Zakup narxi. FAQAT Owner + ruxsatli Manager ko'radi (§3, §5.8). |
| `textureFileUrl` | String? | | Dizayner yuklab oladigan 3D-tekstura fayli (TZ §6.8.2). |
| `qrSlug` | String | ✔, unique | QR-kod manzili (TZ §6.7). Bitta QR — rolga qarab turli ko'rinish (§4.6), ya'ni QR rolga emas, vidga bog'lanadi. |
| `isArchived` | Boolean | ✔, default false | Katalogdan yashirish; o'chirish YO'Q (tarix saqlanadi). |

**Bog'lar:** `photos Photo[]` (namuna + AI-interyer rasmlari), `batches Batch[]`.
**Index/unique:** `@@unique([name])`, `@@unique([qrSlug])`, `@@index([rockType])`, `@@index([color])`.

---

### 1.2 Batch — Партия

TZ §4.1 L2 — asosiy hisob birligi. ADR-002: dona + m² birga.

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `stoneTypeId` | FK → StoneType | ✔ | |
| `arrivedAt` | DateTime | ✔ | Kelish sanasi (TZ §4.1). |
| `supplierNote` | String? | | Yetkazib beruvchi / hujjat rekviziti. TZ §11.5 ochiq savol — hozircha erkin matn, keyin strukturalanadi. |
| `slabsTotal` | Int? | * | Kelgan plita soni. |
| `areaTotalM2` | Decimal? | * | Kelgan maydon, m². |
| `slabsSoldDirect` | Int | ✔, default 0 | B2B: partiyadan to'g'ridan-to'g'ri sotilgan plitalar (Slab yaratmasdan). |
| `areaSoldDirectM2` | Decimal | ✔, default 0 | B2B: to'g'ridan-to'g'ri sotilgan maydon. |
| `slabsAdjusted` | Int | ✔, default 0 | Inventarizatsiya/peresort tuzatishlari (±, faqat maxsus amal orqali, AuditLog majburiy). |
| `areaAdjustedM2` | Decimal | ✔, default 0 | Xuddi shu, m². |
| `purchasePrice` | Decimal? | | Partiya zakup narxi (marja hisobi uchun; rol bilan cheklangan). |
| `needsCheck` | Boolean | ✔, default false | «Проверить» belgisi — peresort (TZ §7.4). Statusdan alohida flag, chunki tekshiruv statusni o'zgartirmaydi. |

\* **CHECK:** `slabsTotal` va `areaTotalM2` dan **kamida bittasi** to'ldirilgan bo'lishi shart (TZ §5.1: «плиты и/или площадь»). ADR-002 ikkalasini tavsiya qiladi, lekin priyomka tezligi muqaddas (TZ §9) — bittasi bilan ham kiritish mumkin.

**Bog'lar:** `locations BatchLocation[]`, `slabs Slab[]`, `pieces Piece[]`, `reservations Reservation[]`.
**Index:** `@@index([stoneTypeId])`, `@@index([arrivedAt])`, `@@index([stoneTypeId, needsCheck])`.

**Partiya statusi saqlanmaydi — hisoblanadi:** erkin qoldiq > 0 → «В наличии»; erkin = 0 va hammasi sotilgan → «Продан». Saqlangan status bilan hisob har doim sinxron bo'lmaydi; hisoblangan status yolg'on gapirmaydi. (Slab/Piece'da esa status saqlanadi — §2.)

---

### 1.3 BatchLocation — Partiya lokatsiyasi

TZ §4.5: bitta partiya bir vaqtning o'zida bir nechta joyda — bu NORMA. Tizim toshni qayerga qo'yishni boshqarmaydi, faqat qayda yotganini qayd etadi.

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `batchId` | FK → Batch | ✔ | onDelete: Restrict (partiya tarixi o'chmaydi). |
| `block` | String | ✔ | Blok harfi: «А», «Б», «В»… |
| `landmark` | String | ✔ | Orientir: «2» yoki oraliq «1–2» («между ориентирами 1 и 2»). Erkin format — flaglar jismoniy obyekt, sxema ularni oldindan bilmaydi. |
| `slabsHere` | Int? | | Shu joyda taxminan nechta plita. Ixtiyoriy — sklad joy-joyiga sanashga majburlanmaydi (TZ §9: soddalik). |
| `areaHereM2` | Decimal? | | Xuddi shu, m², ixtiyoriy. |
| `note` | String? | | «Yo'l chetida», «ustma-ust» kabi izoh. |

**Index:** `@@index([batchId])`, `@@index([block, landmark])` — «Blok A da nima bor?» qidiruvi uchun.
**Unique YO'Q** `(batchId, block, landmark)` bo'yicha: bitta partiya bitta blokda ikki uyum bo'lib yotishi mumkin — cheklab qo'ymaymiz.

> Alohida `Block`/`Landmark` jadvali S1 da YARATILMAYDI: bloklar ~10–20 ta harf, orientirlar — yerga qadalgan flaglar. String yetarli, soddalik ustuvor (TZ §9). Agar keyin karta-vizualizatsiya kerak bo'lsa, ref-jadval migratsiya bilan kiritiladi.

---

### 1.4 Slab — Плита (ekzemplyar)

TZ §4.1 L3 + ADR-004: yozuv faqat «ajratish» paytida tug'iladi (fotozapros natijasi / B2C tanlov).

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `batchId` | FK → Batch | ✔ | Plita HAR DOIM partiyadan ajratiladi. |
| `stoneTypeId` | FK → StoneType | ✔ | Denormalizatsiya (batch orqali ham bor) — qidiruv «vid + status» bitta indexdan o'tishi uchun (TZ §8: qidiruv — sekundlar). |
| `label` | String | ✔ | Inson o'qiydigan nom: «Плита №2» — fotozaprosdagi raqamlash (TZ §6.1.8). Partiya ichida unique. |
| `status` | Enum `UnitStatus` | ✔ | §2 ga qarang. |
| `lengthMm` | Int? | | O'lchamlar ajratish paytida ma'lum bo'lmasligi mumkin — fotodan keyin kiritiladi. |
| `widthMm` | Int? | | |
| `thicknessMm` | Int? | | |
| `areaM2` | Decimal? | | Kiritilmagan bo'lsa hisobda partiya o'rtachasi ishlatiladi (§3, `isAreaEstimated=true`). |
| `isAreaEstimated` | Boolean | ✔, default true | `areaM2` haqiqiy o'lchovmi yoki partiya o'rtachasimi. |
| `block` / `landmark` | String / String | ✔ | Ajratish paytida partiya lokatsiyalaridan biri tanlanadi; keyin mustaqil ko'chirilishi mumkin (TZ §5.7). |
| `needsCheck` | Boolean | ✔, default false | Peresort (TZ §7.4). |
| `photoRequestId` | FK → PhotoRequest? | | Qaysi fotozapros natijasida ajratilgan (kelib chiqish tarixi). |
| `separatedById` | FK → User | ✔ | Kim ajratdi. |

**Bog'lar:** `photos Photo[]`, `reservations Reservation[]`, `pieces Piece[]` (bo'linganda).
**Index/unique:** `@@unique([batchId, label])`, `@@index([stoneTypeId, status])`, `@@index([batchId])`, `@@index([block, landmark])`.

---

### 1.5 Piece — Бой / остаток / обрезок

TZ §4.2: alohida sushnost, poshtuchno, O'Z gabaritlari bilan — aynan gabarit bo'yicha qidiriladi va **birinchi taklif qilinadi** (TZ §5.2, §6.5).

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `stoneTypeId` | FK → StoneType | ✔ | Qaysi vidga tegishli. |
| `batchId` | FK → Batch? | | Kelib chiqishi ma'lum bo'lsa. Priyomkada topilgan «uyesiz» boy uchun null. |
| `originSlabId` | FK → Slab? | | Konkret plitadan chiqqan bo'lsa (TZ §6.4). Hisob uchun muhim — §3. |
| `kind` | Enum `PieceKind` | ✔ | `BROKEN` (бой) \| `OFFCUT` (остаток/обрезок). Ikkalasi bitta jadvalda — hayot sikli bir xil, faqat kelib chiqishi farq. |
| `status` | Enum `UnitStatus` | ✔ | §2. `BROKEN_OFFCUT` statusiga o'ta olmaydi (allaqachon shu). |
| `sidesMm` | Json | ✔ | Har tomon uzunligi, mm: `[1180, 640, 950, 610]` — AI chertyoj + skladchi kiritadi (TZ §5.5). Tomonlar soni erkin (shakl notekis). |
| `boundingLengthMm` | Int | ✔ | Ichiga sig'adigan eng katta to'rtburchak taxmini — **qidiruv shu maydonlar bo'yicha** (TZ §5.2 dopusk bilan qidiruv; Json ichida indexli qidirib bo'lmaydi). Kiritishda hisoblanadi/qo'lda tasdiqlanadi. |
| `boundingWidthMm` | Int | ✔ | |
| `thicknessMm` | Int? | | |
| `areaM2` | Decimal? | | Taxminiy maydon (hisob uchun). |
| `drawingUrl` | String? | | AI chizgan chertyoj fayli (TZ §5.5). |
| `block` / `landmark` | String / String | ✔ | O'z lokatsiyasi (TZ §4.2). |
| `needsCheck` | Boolean | ✔, default false | |
| `createdById` | FK → User | ✔ | Odatda skladchi. |

**Bog'lar:** `photos Photo[]`, `reservations Reservation[]`.
**Index:** `@@index([stoneTypeId, status])`, `@@index([status, boundingLengthMm, boundingWidthMm])` — «1200×700 ga mos qoldiq bor-mi» so'rovi to'g'ridan-to'g'ri indexdan; `@@index([batchId])`, `@@index([block, landmark])`.

---

### 1.6 Reservation — Бронь

TZ §4.4 + ADR-003. Uch xil nishonga bron qilinadi: konkret plita (B2C), konkret qoldiq, yoki partiyadan hajm (B2B «250 m² ushlab tur»).

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `targetType` | Enum `ReservationTarget` | ✔ | `SLAB` \| `PIECE` \| `BATCH_VOLUME`. |
| `slabId` | FK → Slab? | * | |
| `pieceId` | FK → Piece? | * | |
| `batchId` | FK → Batch? | * | `BATCH_VOLUME` uchun. |
| `qtySlabs` | Int? | | Faqat `BATCH_VOLUME`: nechta plita ushlab turilyapti. |
| `qtyAreaM2` | Decimal? | | Faqat `BATCH_VOLUME`: qancha m². Kamida bittasi to'ldiriladi. |
| `managerId` | FK → User | ✔ | KIM bron qildi — anonim rezerv yo'q (TZ §4.4). |
| `customerName` | String | ✔ | KIMGA — majburiy, «на всякий случай» brondan himoya. |
| `customerContact` | String? | | Tel/username. |
| `expiresAt` | DateTime | ✔ | Yaratishda `now + AppConfig.reservationDays` (default 3 kun, ADR-003). |
| `status` | Enum `ReservationStatus` | ✔ | `ACTIVE` \| `COMPLETED` (sotuvga aylandi) \| `CANCELLED` (qo'lda) \| `EXPIRED` (muddat). |
| `resolvedAt` | DateTime? | | ACTIVE dan chiqqan payt. |

\* **CHECK:** `targetType` ga mos FK to'ldirilgan, qolganlari null.

**Unique (kritik):** partial unique index — `slabId WHERE status='ACTIVE'` va `pieceId WHERE status='ACTIVE'`. Bitta birlikda bir vaqtda faqat bitta faol bron — «bitta tosh ikki klientga» (TZ §7.5) DB darajasida yechiladi: birinchi INSERT o'tadi, ikkinchisi constraint xatosi oladi.
**`BATCH_VOLUME` invarianti:** faol volume-bronlar yig'indisi ≤ partiya erkin qoldig'i — tranzaksiyada tekshiriladi (§3).
**Muddat tugashi:** cron (yoki har o'qishda lazy tekshiruv) `ACTIVE && expiresAt < now` → `EXPIRED` + AuditLog. Birlik statusi avtomatik `AVAILABLE` ga qaytadi (§2).
**Index:** `@@index([status, expiresAt])` (cron uchun), `@@index([managerId, status])` (rahbariyat: «kim nimani muzlatgan» — TZ §4.4).

---

### 1.7 User — Foydalanuvchi va 4 rol

TZ §3. Auth mexanikasi (parol/Telegram initData) — keyingi sprint; model hozirdan ikkala kirishga tayyor (TZ §5.9).

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `name` | String | ✔ | |
| `role` | Enum `Role` | ✔ | `OWNER` \| `MANAGER` \| `WAREHOUSE` \| `PARTNER` (дизайнер/прораб/подрядчик). |
| `phone` | String? | unique | |
| `telegramId` | String? | unique | Telegram kirish (mini-app + bot vazifalari). Skladchi uchun amalda majburiy — fotozadachalar shu orqali keladi. |
| `email` | String? | unique | Sayt kirishi uchun (keyingi sprint). |
| `passwordHash` | String? | | Sayt kirishi uchun (keyingi sprint). |
| `canSeePurchasePrice` | Boolean | ✔, default false | TZ §3/§5.8: menejer zakup/marjani ko'rishi SOZLANADI. Owner uchun e'tiborga olinmaydi (doim ko'radi). |
| `isActive` | Boolean | ✔, default true | Bloklash; o'chirish yo'q (AuditLog FK butun qolishi kerak). |

**Rol-huquq matritsasi (model darajasida nima ko'rinadi):**

| Ma'lumot | OWNER | MANAGER | WAREHOUSE | PARTNER |
|---|---|---|---|---|
| Katalog (StoneType, foto, tekstura) | ✔ | ✔ | ✔ | ✔ |
| Наличие / lokatsiyalar (Batch, qoldiqlar) | ✔ | ✔ | ✔ | faqat «bor / yo'q», aniq raqamsiz (TZ §3) |
| Sotuv narxi (`basePrice`) | ✔ | ✔ | ✖ | ✖ (so'rovi menejerga boradi) |
| Zakup / marja (`purchasePrice`) | ✔ | `canSeePurchasePrice` bo'lsa | ✖ | ✖ |
| Sotuv / bron amallari | ✔ | ✔ | ✖ | ✖ |
| Priyomka, boy, ko'chirish, foto | ✔ | ✖ (ko'radi) | ✔ | ✖ |
| AuditLog, barcha bronlar | ✔ | o'ziniki | o'ziniki | ✖ |

> Bu — API/UI qatlami shartnomasi (TZ §4.6: bitta obyekt, turli ko'rinish). Modelda alohida permission jadvali KERAK EMAS; `Role` enum + `canSeePurchasePrice` yetadi. Granulyar huquqlar jadvali — YAGNI, TZ §9 soddalikni talab qiladi.

---

### 1.8 PhotoRequest — Fotozapros (Telegram vazifasi)

TZ §5.3, §6.1: menejer → sklad → foto → tizim.

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `managerId` | FK → User | ✔ | Kim so'radi. |
| `assigneeId` | FK → User? | | Konkret skladchi; null = umumiy navbat (sklad guruhi oladi). |
| `batchId` | FK → Batch | ✔ | Qaysi partiya toshini suratga olish. |
| `batchLocationId` | FK → BatchLocation? | | Qaysi joydan («Блок А, ориентир 2» — TZ §6.1.4). |
| `slabId` | FK → Slab? | | Mavjud plitani QAYTA suratga olish so'rovi (eski foto — TZ §5.3 «переснять»). |
| `comment` | String? | | «3 ta yorug' plitani oling» kabi. |
| `status` | Enum `PhotoRequestStatus` | ✔ | `PENDING` \| `DONE` \| `CANCELLED`. `IN_PROGRESS` YO'Q — skladchi «qabul qildim» bosishga majburlanmaydi (TZ §9: ortiqcha tugma intizomni o'ldiradi). |
| `completedAt` | DateTime? | | |

**TZ §7.2 (javobsiz so'rov):** `PENDING` yozuv o'z-o'zidan «osilib turadi» — skladchi ro'yxatida, rahbar panelida va menejer kartochkasida ko'rinadi. Muddati o'tganlik `createdAt` dan hisoblanadi, alohida maydon kerak emas.
**Natija bog'i:** skladchi yuborgan fotolar `Photo.photoRequestId` bilan, ajratilgan plitalar `Slab.photoRequestId` bilan bog'lanadi.
**Index:** `@@index([status, createdAt])` (navbat), `@@index([assigneeId, status])`, `@@index([managerId])`.

---

### 1.9 Photo — Foto

TZ §5.3: foto abadiy saqlanadi va qayta ishlatiladi; sanasi ko'rinadi; toshga adashmasdan bog'lanadi.

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `storageKey` | String | ✔ | Fayl manzili (S3-key / URL — saqlash joyi bo'yicha ADR foto sprintida, ADR-001). |
| `kind` | Enum `PhotoKind` | ✔ | `SLAB` \| `PIECE` \| `SAMPLE` (vid namunasi) \| `INTERIOR_AI` (QR-kartochka interyerlari, TZ §6.7) \| `DRAWING` (boy chertyoji). |
| `takenAt` | DateTime | ✔ | Suratga olingan sana — UI da ko'rsatiladi; «bir necha oydan eski → возможно, переснять» belgisi shu maydondan hisoblanadi (TZ §5.3). |
| `takenById` | FK → User? | | Skladchi. AI-generatsiya uchun null. |
| `stoneTypeId` | FK → StoneType? | * | |
| `slabId` | FK → Slab? | * | |
| `pieceId` | FK → Piece? | * | |
| `photoRequestId` | FK → PhotoRequest? | | Qaysi so'rov natijasi. |

\* **CHECK:** `stoneTypeId / slabId / pieceId` dan kamida bittasi to'ldirilgan — «egasiz» foto bo'lmaydi (TZ §5.3: съёмkada DARHOL toshga bog'lanadi, adashish mumkin emas).

**O'chirish yo'q:** foto hech qachon DELETE qilinmaydi (TZ §5.3 «навсегда») — faqat yangisi qo'shiladi.
**Index:** `@@index([slabId])`, `@@index([pieceId])`, `@@index([stoneTypeId, kind])`.

---

### 1.10 AuditLog — Harakatlar tarixi

TZ §8: «продажа, бой, перемещение, бронь — кто, что, когда».

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `userId` | FK → User? | | Kim. **Nullable:** avtomatik amallarda bajaruvchi user yo'q — masalan, bron muddati tugaganda cron yozadigan `RESERVE_EXPIRE` (№5 o'tish, §2). `userId IS NULL` = tizim amali. |
| `action` | Enum `AuditAction` | ✔ | `INTAKE` (priyomka) \| `SALE` \| `RESERVE` \| `RESERVE_CANCEL` \| `RESERVE_EXPIRE` \| `SEPARATE_SLAB` \| `BREAK` (boy) \| `SPLIT` (raspil) \| `MOVE` \| `PHOTO_REQUEST` \| `PHOTO_UPLOAD` \| `RETURN` \| `ADJUSTMENT` (inventarizatsiya/peresort) \| `STATUS_CHANGE`. |
| `entityType` | String | ✔ | «Batch», «Slab», «Piece»… |
| `entityId` | String | ✔ | |
| `payload` | Json | ✔ | Miqdorlar, oldingi/keyingi status, mijoz nomi, izoh — amalga bog'liq. `ADJUSTMENT` uchun delta MAJBURIY (hisob auditi §3 shu yerdan tiklanadi). |

**Yozish qoidasi:** log yozuvi asosiy amal bilan BITTA tranzaksiyada — «amal bo'ldi, log yo'q» holati mumkin emas.
**Index:** `@@index([entityType, entityId, createdAt])` (birlik tarixi), `@@index([userId, createdAt])`, `@@index([action, createdAt])`.

---

### 1.11 AppConfig — Sozlamalar (yordamchi)

ADR-003: bron muddati sozlanadigan. Kalit-qiymat jadvali: `key String @unique`, `value String`. S1 kalitlari: `reservationDays` (default «3»), `photoStaleMonths` (default «4» — «переснять» belgisi chegarasi). Onyx aniqlik kiritsa faqat qiymat o'zgaradi, migratsiya kerak emas.

---

### 1.12 SaleRecord — Sotuv yozuvi

**ADR-006 bilan tasdiqlangan** — S1-C sxemasiga kiradi. TZ §5.4: «история: что, когда, кому ушло» — hisobotlar Json (AuditLog) ichidan emas, strukturali jadvaldan.

| Maydon | Tip | Majburiy | Izoh |
|---|---|---|---|
| `managerId` | FK → User | ✔ | Kim sotdi. |
| `customerName` | String | ✔ | Kimga ketdi (TZ §5.4). |
| `customerContact` | String? | | Tel/username. |
| `targetType` | Enum `SaleTarget` | ✔ | `SLAB` \| `PIECE` \| `BATCH_VOLUME` (B2B, plita ajratmasdan — TZ §6.2). |
| `slabId` | FK → Slab? | * | |
| `pieceId` | FK → Piece? | * | |
| `batchId` | FK → Batch? | * | `BATCH_VOLUME` uchun. |
| `qtySlabs` | Int? | | Faqat `BATCH_VOLUME`: nechta plita sotildi. |
| `qtyAreaM2` | Decimal? | | Faqat `BATCH_VOLUME`: qancha m². Kamida bittasi to'ldiriladi. |
| `price` | Decimal? | | Kelishilgan narx (rol bilan cheklangan ko'rinish). |
| `soldAt` | DateTime | ✔ | Sotuv payti (TZ §5.4: yozib chiqarish sotuv MOMENTIDA). |

\* **CHECK:** `targetType` ga mos FK to'ldirilgan (Reservation bilan bir xil naqsh, §1.6).

**Tranzaksiya qoidasi (ADR-006):** sotuv amali = birlik statusining `SOLD` ga o'tishi (yoki `slabsSoldDirect`/`areaSoldDirect` oshishi) + `SaleRecord` + `AuditLog` — uchchalasi BITTA tranzaksiyada.
**Index:** `@@index([managerId, soldAt])`, `@@index([soldAt])`, `@@index([batchId])`, `@@index([slabId])`, `@@index([pieceId])`.

> Dizayner zayavkasi (TZ §6.8 «har qanday so'rov — lid») keyingi sprintda alohida entity bo'ladi — S1 modeliga ataylab kiritilmadi.

---

## 2. Status modeli — `UnitStatus` enum va o'tishlar

TZ §4.3. Bitta enum `Slab` va `Piece` uchun umumiy (Batch statusi hisoblanadi — §1.2):

| Enum qiymat | UI (ruscha) | Ma'nosi |
|---|---|---|
| `AVAILABLE` | В наличии | Sotuvga ochiq, qidiruvda ko'rinadi. Priyomka/ajratishda avtomatik. |
| `RESERVED` | Забронирован | Faol bron bor. Boshqa menejer sota olmaydi. |
| `SOLD` | Продан | Yozib chiqilgan, tarixda. |
| `BROKEN_OFFCUT` | Бой / остаток | Faqat `Slab` uchun: plita boy/qoldiqqa aylangan, davomi bog'langan `Piece`larda. `Piece` bu statusga KIRMAYDI — u tug'ilishidan shu. |
| `RETURNED` | Возврат | Klientdan qaytgan, tekshiruvgacha sotuvda YO'Q. |

**Ruxsat etilgan o'tishlar:**

| № | O'tish | Kim | Izoh |
|---|---|---|---|
| 1 | `AVAILABLE → RESERVED` | menejer | Bron yaratish bilan atomar (§1.6 partial unique). |
| 2 | `AVAILABLE → SOLD` | menejer | To'g'ridan-to'g'ri sotuv. |
| 3 | `AVAILABLE → BROKEN_OFFCUT` | skladchi | Boy/raspil (TZ §6.4); `Piece` yaratish bilan bitta tranzaksiyada. |
| 4 | `RESERVED → SOLD` | faqat bron egasi (yoki Owner) | Bron `COMPLETED` ga o'tadi. |
| 5 | `RESERVED → AVAILABLE` | avtomatik (muddat) yoki bron egasi/Owner | Bron `EXPIRED`/`CANCELLED`. |
| 6 | `RESERVED → BROKEN_OFFCUT` | skladchi | Bronlangan tosh ham sinishi mumkin — real hayot. Bron avto-`CANCELLED` + menejerga xabar. |
| 7 | `SOLD → RETURNED` | menejer | Vozvrat (TZ §4.3). |
| 8 | `RETURNED → AVAILABLE` | menejer/Owner | Tekshiruvdan o'tdi. |
| 9 | `RETURNED → BROKEN_OFFCUT` | skladchi | Buzilgan holda qaytdi. |

**Taqiqlangan o'tishlar (kodda EXPLICIT xatolik qaytariladi):**

| Taqiq | Sabab (TZ) |
|---|---|
| `RESERVED → SOLD` boshqa menejer tomonidan | §4.3/§7.5: birovning broni ostidan sotish mumkin emas. |
| `BROKEN_OFFCUT → *` (Slab uchun terminal status) | §4.3: boy «butun» sifatida sotilmaydi. Sotiladigan narsa — bog'langan `Piece`. |
| `SOLD → AVAILABLE` / `SOLD → RESERVED` to'g'ridan-to'g'ri | Faqat `RETURNED` orqali — «sotildi/sotilmadi» chalkashligiga qarshi (§4.3). |
| `AVAILABLE → RETURNED` | Sotilmagan narsa qaytmaydi. |
| `needsCheck=true` birlikda sotuv yo'nalishidagi o'tish (`→ SOLD`, `→ RESERVED`) | §7.4: «проверить» hal bo'lmaguncha sotuvga qo'yilmaydi. (Flag statusni bloklaydi, lekin o'zi status emas.) |

**Amalga oshirish talabi (S1-C/S1-D ga meros):** har qanday statusga o'tish — `UPDATE … WHERE id = ? AND status = <kutilgan>` ko'rinishidagi shartli yozuv, bitta DB tranzaksiyasida (yoki `SELECT … FOR UPDATE`). 0 qator yangilansa — birlik allaqachon boshqa holatda, foydalanuvchiga aniq xato: «уже продан». Bu TZ §7.1 (ikki menejer bir plitani sotadi) ning DB-darajali yechimi.

---

## 3. Hisob invarianti — «partiya doim sxoditsya»

ADR-002 + ADR-004. Erkin qoldiq SAQLANMAYDI — hisoblanadi (saqlangan qoldiq vaqt o'tib drift beradi; hisoblangani yolg'on gapira olmaydi):

```
slabsFree(batch) = slabsTotal
                 + slabsAdjusted                                  // inventarizatsiya ±
                 − slabsSoldDirect                                // B2B, plita ajratmasdan
                 − count(Slab WHERE batchId = X)                  // ajratilgan — HAR QANDAY statusda
                 − count(Piece WHERE batchId = X AND originSlabId IS NULL)
                                                                  // partiyadan to'g'ridan-to'g'ri boy

areaFreeM2(batch) = areaTotalM2 + areaAdjustedM2 − areaSoldDirectM2
                  − Σ slab.areaM2   (batchId = X)
                  − Σ piece.areaM2  (batchId = X, originSlabId IS NULL)
```

**Nega ajratilgan plita statusidan qat'i nazar minus:** plita ajratilgach, u partiyaning «umumiy massasi»dan chiqdi — endi o'z hayotini o'z statusida yashaydi (bron/sotuv/boy). Ikki marta hisoblash yo'q: plitadan chiqqan `Piece` (`originSlabId` to'ldirilgan) formulada QATNASHMAYDI — u allaqachon minus qilingan plitaning davomi.

**O'lchov noaniqligi:** ajratilgan plitaning haqiqiy o'lchami kiritilmaguncha `areaM2 = areaTotalM2 / slabsTotal` (partiya o'rtachasi), `isAreaEstimated = true`. Haqiqiy o'lchov kiritilganda farq avtomatik `areaFree` ga singadi — bu norma, tosh tabiiy material (TZ §1.1).

**`slabsTotal = null` semantikasi (faqat m² kiritilgan partiya):** dona bo'yicha formula hisoblab bo'lmaydi → `slabsFree = null`, **dona-nazorat o'chadi** — himoya faqat `areaFreeM2` bo'yicha ishlaydi. Plita ajratish TAQIQLANMAYDI (B2C tanlov baribir kerak bo'lishi mumkin), lekin har ajratishda area tekshiruvi majburiy: ajratilayotgan plitaning `areaM2` (haqiqiy yoki taxminiy) erkin `areaFreeM2` dan oshsa — rad. O'rtacha maydon ham hisoblanmaydi (`slabsTotal` yo'q), shuning uchun bunday partiyadan ajratishda o'lcham kiritish MAJBURIY bo'ladi (aks holda `areaM2` aniqlab bo'lmaydi). Ko'zgu holat (`areaTotalM2 = null`, faqat dona): m²-nazorat o'chadi, dona-nazorat ishlaydi, `areaM2` maydonlari null qolaveradi.

**Himoya qoidalari (barchasi tranzaksiya ichida):**

- `slabsFree < 0` yoki `areaFreeM2 < 0` qiladigan amal RAD etiladi («partiyada buncha yo'q»).
- B2B sotuv (`slabsSoldDirect`/`areaSoldDirect` oshirish) va plita ajratish erkin qoldiqni tekshirib bajariladi.
- Faol `BATCH_VOLUME` bronlar yig'indisi erkin qoldiqdan oshmaydi; volume-bron bor partiyada erkin qoldiqni bron hajmidan pastga tushiradigan sotuv (bron egasidan boshqaga) rad etiladi.
- «Partiyani optom butunlay sotib olishdi» (TZ §7.6): bitta amal — erkin qoldiq to'lasiga `slabsSoldDirect`/`areaSoldDirect` ga o'tkaziladi; plitalarga bo'lish YO'Q.

Inventarizatsiya (TZ §9) shu formulani fakt bilan solishtiradi; farq `slabsAdjusted`/`areaAdjustedM2` ga `ADJUSTMENT` (AuditLog bilan) sifatida yoziladi.

---

## 4. TZ §7 krayniy holatlar — modelda nima qoplaydi

| TZ §7 holat | Modeldagi yechim |
|---|---|
| **7.1 Ikki menejer bir vaqtda oxirgi plitani sotadi** | Statusga shartli o'tish (§2): `UPDATE … WHERE status='AVAILABLE'` tranzaksiyada — birinchisi o'tadi, ikkinchisiga «уже продан». B2B'da hisob invarianti (§3) manfiy qoldiqni rad etadi. |
| **7.2 Skladchi fotozaprosga javob bermadi** | `PhotoRequest.status='PENDING'` o'z-o'zidan «osilgan vazifa» (§1.8): skladchi navbatida, rahbar panelida (`@@index([status, createdAt])`), menejer foto tayyor emasligini ko'radi. Yozuv DB da — hech narsa yo'qolmaydi. |
| **7.3 Skladda internet yo'q paytda amal** | Bu qatlam modeldan tashqarida (klient tomonida offline-navbat), lekin model tayyor: barcha yozuv amallari **klient generatsiya qilgan `id` (cuid) bilan idempotent** — takror yuborilgan so'rov dublikat yaratmaydi (PK to'qnashuvi → «allaqachon qabul qilingan»). S1-D+ API shartnomasiga kiradi. |
| **7.4 Peresort — tizimda bor, faktda yo'q** | `needsCheck=true` flag (Batch/Slab/Piece) + sotuv yo'nalishidagi o'tishlar bloklanadi (§2). Aniqlangach: `ADJUSTMENT` (§3) yoziladi yoki flag olib tashlanadi. Flag statusdan alohida — tekshiruv bron/sotuv tarixini buzmaydi. |
| **7.5 Bitta tosh ikki klientga kerak** | Partial unique index: birlikka faqat bitta `ACTIVE` bron (§1.6). Birinchi bo'lgan — oldi; ikkinchi menejerga tizim faol bronni (kim, qachongacha) ko'rsatadi va o'xshash variantlarni taklif qiladi (qidiruv qatlami). «Kim birinchi to'ladi» — №4 o'tish faqat bron egasiga. |
| **7.6 Partiyani optom butunlay sotib olishdi** | Bitta amal: erkin qoldiq to'lasiga `slabsSoldDirect`/`areaSoldDirect` ga (§3), Slab yozuvlari YARATILMAYDI (ADR-004). AuditLog'da bitta `SALE`. |

---

## 5. S1-C uchun ochiq savollar

1. ~~**SaleRecord** — alohida entity yoki AuditLog yetarli?~~ **HAL QILINDI (ADR-006):** alohida entity, §1.12 normativ.
2. `Piece.drawingUrl` (AI-chertyoj) oqimi qaysi sprintda — S1 da maydon bo'sh turadi, lekin sxemada bo'lsin (migratsiya tejaladi).
3. `PARTNER` roli S1 da yaratiladi, kirish oqimi (auth) qaysi sprintda — model tayyor, faqat tartib masalasi.
4. *(S2+ backlog, P review'dan)* Qoldiqdan qoldiq (Piece qayta bo'linishi) modelda yo'q — kerak bo'lganda `originPieceId` self-ref migratsiya bilan qo'shiladi (YAGNI).

---

*S1-B · T2 · Bu hujjat S1-C (Prisma sxemasi) merge bo'lgach «muzlaydi»; keyingi o'zgarishlar ADR orqali kiritiladi.*
