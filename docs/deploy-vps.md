# Onyx — VPS deploy runbook (prod)

> **Maqsad:** bitta Ubuntu 24 VPS'da Onyx'ni Docker Compose orqali ishga tushirish:
> Next.js ilova + Postgres + Caddy (avto-HTTPS). Ega telefondan `https://<domain>/karta`
> ochadi; ombor sahifalari parol darvozasi orqasida (`APP_PASSWORD`).
> **Uslub:** har qadam copy-paste qilinadigan, mutaxassis bo'lmagan ega uchun.

Stek: **app** (Next.js standalone) + **db** (postgres:16) + **caddy** (reverse proxy, TLS).
Migratsiyalar (`prisma migrate deploy`) app konteyneri ishga tushganda avtomatik qo'llanadi — idempotent.

---

## 1. VPS olish

- Ubuntu **24.04** LTS, minimal **2 GB RAM** (masalan: Hetzner **CX22**, DigitalOcean **$6** droplet).
- Server IP'sini yozib oling. SSH bilan kiring:

```bash
ssh root@<SERVER_IP>
```

## 2. Docker + Compose plagini o'rnatish

Docker'ning rasmiy convenience-skripti:

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

`docker compose` (plagin) allaqachon keladi. Agar `docker` ni root'siz ishlatmoqchi bo'lsangiz:
`sudo usermod -aG docker $USER` va qayta kiring (majburiy emas).

## 3. DNS (domen bilan bo'lsa)

Domen provayderida **A-yozuvi** qo'shing:

```
onyx.<domain>   A   <SERVER_IP>
```

Tarqalishini kuting (bir necha daqiqa). Tekshirish: `dig +short onyx.<domain>` → server IP'ni ko'rsatsin.

> Domen hali yo'q bo'lsa — bu qadamni o'tkazib yuboring va 5-qadamda **IP-only** rejimini tanlang.

## 4. Repozitoriyani klonlash

Repo **maxfiy** — deploy key yoki Personal Access Token (PAT) kerak:

```bash
# PAT bilan (eng oson):
git clone https://<GITHUB_USER>:<PAT>@github.com/<org>/onyx.git
cd onyx
```

(Yoki SSH deploy key sozlab `git clone git@github.com:<org>/onyx.git`.)

## 5. Maxfiy qiymatlarni sozlash

```bash
cp .env.production.example .env.production
nano .env.production
```

To'ldiring:

- `DOMAIN=onyx.<domain>` va `ACME_EMAIL=you@<domain>` — domen bilan bo'lsangiz.
  Domensiz test uchun `DOMAIN` ni bo'sh qoldiring (pastdagi eslatmaga qarang).
- `POSTGRES_PASSWORD` — kuchli DB paroli. Yarating: `openssl rand -hex 16`.
- `DATABASE_URL` ichidagi parol **AYNAN** `POSTGRES_PASSWORD` bilan bir xil bo'lsin
  (host `db` bo'lib qoladi, o'zgartirmang).
- `APP_PASSWORD` — egaga kirish paroli (login sahifasi). Kuchli bo'lsin.
- `AUTH_COOKIE_SECRET` — cookie imzo kaliti: `openssl rand -hex 32`.

**Domensiz (faqat IP) test rejimi:** `Caddyfile` ni oching, **VARIANT A** blokini `#` bilan
izohga oling, **VARIANT B** (`:80 { ... }`) blokidagi `#` larni olib tashlang. Shunda
`http://<SERVER_IP>` ochiladi (TLS yo'q — faqat vaqtincha, parol ochiq ketadi).

## 6. Ishga tushirish

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Birinchi build bir necha daqiqa oladi. So'ng:

- `db` ko'tariladi va healthcheck'dan o'tadi;
- `app` migratsiyalarni qo'llaydi (`prisma migrate deploy`) va serverni ishga tushiradi;
- `caddy` domen uchun HTTPS sertifikatini avtomatik oladi.

Holatni ko'rish:

```bash
docker compose -f docker-compose.prod.yml ps
```

## 7. Tekshirish (verify)

- `https://<domain>/karta` ochiladi — **read-only** karta (o'zgartirib bo'lmaydi).
- `https://<domain>/priemka` → `/login` ga yo'naltiradi (himoyalangan).
- `/login` da `APP_PASSWORD` bilan kirasiz — muvaffaqiyatli.
- Kirgandan keyin `https://<domain>/karta?edit` — kataklarni bosib belgilash mumkin.

> Domensiz rejimda `https://` o'rniga `http://<SERVER_IP>` ni ishlating.

## 8. Kundalik operatsiyalar (ops)

**Loglar:**

```bash
docker compose -f docker-compose.prod.yml logs -f app     # ilova loglari
docker compose -f docker-compose.prod.yml logs -f caddy   # TLS / proxy
```

**Yangilash / qayta deploy (kod yangilanganda):**

```bash
cd onyx
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migratsiyalar app qayta ishga tushganda avtomatik qo'llanadi (`prisma migrate deploy` —
idempotent, allaqachon qo'llangan migratsiyalarni qayta bajarmaydi; KartaCell va boshqa
jadvallar uchun xavfsiz).

**Postgres backup (zaxira nusxa):**

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U onyx -d onyx | gzip > onyx-backup-$(date +%F).sql.gz
```

Buni cron'ga qo'yib har kuni saqlash tavsiya etiladi.

**Restore (tiklash):**

```bash
gunzip -c onyx-backup-YYYY-MM-DD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U onyx -d onyx
```

**To'xtatish / ishga tushirish:**

```bash
docker compose -f docker-compose.prod.yml stop
docker compose -f docker-compose.prod.yml up -d
```

## 9. Xavfsizlik eslatmalari

- **Firewall (ufw):**

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

- `APP_PASSWORD` va DB parolini standart/oson qiymatlardan kuchli qiymatlarga o'zgartiring.
- `.env.production` ni **hech qachon** git'ga qo'shmang (allaqachon `.gitignore`'da `.env*`).
- Postgres va app portlari hostga ochilmagan — faqat Caddy 80/443 tashqariga chiqadi.
- Backup fayllarni server tashqarisida ham saqlang.

---

## Ega kartani qanday belgilaydi (eslatma)

1. Telefondan `https://<domain>/karta?edit` ni oching.
2. `APP_PASSWORD` bilan kiring (login sahifasi chiqadi).
3. Kataklarni bosib **belgilang/olib tashlang** — holat Postgres'da (KartaCell) saqlanadi.

Belgilash qoidasi: **P** texnik 1-qatlam kataklarini belgilaydi; **ega** biznes
qatlamlarini (0 / 2 / 3 / 4) belgilaydi.
