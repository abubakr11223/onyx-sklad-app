# Zaxira nusxa va tiklash

> Bu hujjat 2026-09-02 dagi auditdan keyin yozildi. Undan oldin zaxira haqidagi
> ma'lumot kod izohlariga sochilgan edi va bir qismi **rost emas edi** — izohlar
> Google Drive'ga nusxa ketishini yozardi, aslida esa bunday vazifa umuman yo'q
> edi. Bu hujjat faqat HAQIQATDA ishlaydigan narsani yozadi.

## 1. Hozir nima himoyalangan

| Qatlam | Nima saqlanadi | Qayerda | Qanchalik tez-tez |
|---|---|---|---|
| Bazaning o'z tiklashi | butun baza | baza xizmati ichida | uzluksiz |
| Kunlik zaxira | **hamma jadval** (matn) | Telegram — egalarga | kuniga 1 marta |
| Ikkinchi nusxa | o'sha fayl | **siz sozlaysiz** (2-bo'lim) | kuniga 1 marta |
| Rasmlar | surat fayllari | **siz sozlaysiz** (3-bo'lim) | kuniga 1 marta |

**Bazaning o'z tiklashi vaqtinchalik.** U hozirgi hosting bilan birga keladi va
o'z serveringizga ko'chgan kuni **yo'qoladi**. Shundan keyin qolgani — quyidagi
uch qatlam. Shuning uchun ular ko'chirishdan OLDIN sozlanishi kerak.

### Eng yomon holatda qancha ish yo'qoladi

**24 soat.** Zaxira kuniga bir marta olinadi, ya'ni falokat kechqurun bo'lsa —
o'sha kunning barcha sotuvi, qabuli va bronlari yo'qoladi. Bu ataylab qabul
qilingan qaror: kuniga bir marta — sodda va ishonchli. Agar 24 soat ko'p bo'lsa,
`docker-compose.prod.yml` dagi `CRON_BACKUP_UTC` ni bir necha marta chaqirishga
o'zgartiring yoki bazaning uzluksiz jurnalini yoqing.

## 2. Ikkinchi nusxa — Telegram'dan mustaqil

Hozir zaxira **faqat Telegram chatida**. Bot tokeni almashsa, chat tozalansa
yoki akkaunt qo'ldan ketsa — hamma zaxira bir vaqtda yo'qoladi. Shuning uchun
ikkinchi manzil kerak.

Alohida mashinada (yoki ega serverida) kuniga bir marta:

```sh
curl -fsS -H "Authorization: Bearer $EXPORT_SECRET" \
  https://<domen>/api/export/snapshot \
  -o /srv/backups/onyx-$(date -u +%F).json.gz
```

`EXPORT_SECRET` — cron kalitidan **alohida** (`.env.production`). Sabab: bu kalit
qo'lda buyruqlarda ishlatiladi va terminal tarixida qoladi.

Keyin `/srv/backups` papkasini tashqi diskka yoki boshqa bulutga ko'chiring.
Eski fayllarni tozalash: 30 kundan eskilarini o'chirish yetadi.

## 3. Rasmlar — alohida, chunki ular bazada emas

Kunlik JSON zaxirada rasmning faqat **manzili** bor, rasmning o'zi yo'q.
Baytlar uch joyda yotadi: tashqi omborda, Telegram serverida yoki bizning
diskimizda. Bazani tiklab, rasmlarni tiklamasangiz — ombordagi **har bir surat
ochilmaydigan havolaga aylanadi**. Sotilgan toshni qayta suratga olib bo'lmaydi.

```sh
npm run backup:photos -- --out=/srv/backups/photos
```

- Rasmlar oylik papkalarga tushadi, yoniga `manifest.json` yoziladi
  (qaysi fayl qaysi partiyaga tegishli, sha256 bilan).
- **Takror yurgizish arzon**: allaqachon ko'chirilgani qayta yuklanmaydi.
  Birinchi marta uzoq, keyingilari tez — cron'ga qo'ysa bo'ladi.
- Agar biror rasmning baytlari topilmasa, skript ularni ro'yxat qilib chiqaradi
  va **xato kodi bilan tugaydi** (cron logi qizil bo'lsin).

O'z serveringizda rasmlar `/data/photos` volume'ida bo'ladi — uni ham kunlik
arxivga qo'shing.

## 4. Ishlayotganini tekshirish

Uch qatlam avtomatik:

1. **Zaxira o'zi.** Muvaffaqiyatli tugagach `AppConfig.lastBackupOkAt` yoziladi.
2. **O'lik odam tugmasi.** Ikkinchi cron (bron tozalash) shu sanani tekshiradi.
   36 soatdan eski bo'lsa — egaga Telegram xabari: «резервные копии не приходят».
   Bu BOSHQA cron, boshqa vaqtda: zaxira croни butunlay o'lsa ham bu tirik qoladi.
3. **Jurnal.** Har bir zaxira va eksport `История` sahifasiga tushadi
   («Резервная копия» / «Выгрузка базы»).

**Haftada bir marta o'zingiz qarang:** `/srv/backups` papkasidagi oxirgi fayl
qaysi sanada? Agar kechagi bo'lmasa — nimadir buzilgan.

## 5. Zaxira fayli ichida nima bor

Fayl uch shaklda bo'lishi mumkin, tiklash skripti uchalasini ham taniydi:

| Fayl | Qachon | Ichida |
|---|---|---|
| `.json` | eski zaxiralar | hamma narsa, siqilmagan |
| `.json.gz` | `BACKUP_ENCRYPTION_KEY` **yo'q** | hamma narsa, **parol xeshlarisiz** |
| `.json.gz.enc` | kalit **bor** | hamma narsa, shifrlangan (AES-256) |

Kalitsiz rejimda parol xeshlari ataylab olib tashlanadi: shifrlanmagan fayl
Telegram serverida abadiy yotadi, unda parol bo'lmasligi kerak. Bunday zaxiradan
tiklaganda hisoblar tiklanadi, lekin parolsiz — `npm run seed:owner` bilan
egaga yangi parol qo'yiladi, qolganlariniki `Сотрудники` sahifasidan.

> **Kalitni yo'qotmang.** Usiz eski shifrlangan fayllar ochilmaydi. Nusxasini
> ilovadan tashqarida saqlang.

## 6. Tiklash

### Odatiy holat — yo'qolgan yozuvlarni qaytarish

```sh
ONYX_RESTORE_ALLOW=I_UNDERSTAND_WRITE npm run restore -- --file=onyx-backup-2026-09-02.json.gz
```

Bu **quruq yurgizish**: nima bo'lishini ko'rsatadi, hech narsa yozmaydi.
Rozi bo'lsangiz `--execute --yes` qo'shing.

Mavjud yozuvlarga tegilmaydi (`skipDuplicates`) — tiklash takrorlansa ma'lumot
ikkilanmaydi.

### Agar bazani BUZISHGAN bo'lsa

Bu boshqa holat va odatiy tiklash bu yerda **yetmaydi**. Agar o'g'ri yozuvlarni
o'chirmasdan **o'zgartirgan** bo'lsa (narx, qarz, sotuv summasi), odatiy tiklash
ekranga «✅ Tiklandi» deb yozadi, buzilgan raqamlar esa joyida qoladi. Bu eng
yomon turdagi xato — jim va ishonch uyg'otadigan.

**To'g'ri yo'l — toza bazaga tiklash:**

1. Yangi **bo'sh** baza yarating.
2. Migratsiyalarni qo'llang: `npm run migrate:deploy`
3. Toza zaxiradan tiklang (buzilishdan **oldingi** fayl):
   `ONYX_RESTORE_ALLOW=I_UNDERSTAND_WRITE npm run restore -- --file=... --execute --yes`
4. `DATABASE_URL` ni yangi bazaga qarating va ilovani qayta ishga tushiring.
5. Eski bazani **o'chirmang** — tergov uchun kerak bo'ladi.

**Ikkinchi yo'l** (baza almashtirib bo'lmasa): `--overwrite` — fayldagi holat
mavjud yozuvlar ustidan yoziladi. Sekinroq, lekin buzilgan qiymatlarni qaytaradi.

### Shifrlangan fayl

`BACKUP_ENCRYPTION_KEY` muhitda bo'lishi kerak va zaxira olingan paytdagi kalit
bilan **aynan bir xil**. Noto'g'ri kalitda skript ochiq aytadi: «kalit noto'g'ri
yoki fayl o'zgartirilgan».

## 7. Ko'chirishdan oldin — majburiy qadamlar

Vercel akkauntini yopishdan **oldin**:

1. `npm run backup:photos -- --out=...` — eski rasmlarni o'zingizga tortib oling.
   Aks holda `https://…` manzilidagi rasmlar akkaunt bilan birga yo'qoladi.
2. Telegram bot tokenini saqlang — `file_id` bilan saqlangan rasmlar unsiz
   ochilmaydi.
3. Ikkinchi nusxa (2-bo'lim) yangi serverda ishlayotganini tekshiring.
4. Ko'chgandan keyin **ertasi kuni** Telegram'ga zaxira kelganini ko'zingiz
   bilan ko'ring.

Ko'chirishning qolgan qadamlari — [migratsiya.md](migratsiya.md).
