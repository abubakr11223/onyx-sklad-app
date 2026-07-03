# Onyx — складская система

Natural tosh (mramor, granit, oniks, travertin) ombori uchun hisob tizimi: partiyalar, plitalar, boy/ostatkalar, bronlar. Texnik topshiriq: [`tz-onyx-sklad.md`](tz-onyx-sklad.md), arxitektura qarorlari: [`docs/decisions.md`](docs/decisions.md).

**Stack (ADR-001):** Next.js (App Router) · TypeScript (strict) · PostgreSQL · Prisma · Tailwind CSS · Vitest. Interfeys tili — ruscha.

## Talablar

- Node.js **20.9+** (Prisma 6 va Next.js 16 uchun)
- Docker (lokal Postgres uchun)

## Nol'dan ishga tushirish

```bash
# 1. Bog'liqliklar
npm install

# 2. Muhit o'zgaruvchilari
cp .env.example .env

# 3. Lokal Postgres (Docker)
docker compose up -d

# 4. Migratsiyalar
npx prisma migrate dev

# 5. Dev server
npm run dev
```

Ilova: http://localhost:3000

## Buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `npm run dev` | Dev server (hot reload) |
| `npm run build` | Production build (typecheck ham shu yerda) |
| `npm start` | Production server (build'dan keyin) |
| `npm test` | Vitest testlari |
| `npm run lint` | ESLint |
| `npx prisma migrate dev` | Migratsiyalarni qo'llash / yangi migratsiya yaratish |
| `npx prisma studio` | Bazani brauzerda ko'rish |

## Baza

Lokal Postgres `docker-compose.yml` orqali ko'tariladi (port 5432, user/db/parol — `onyx`/`onyx`/`onyx_dev`, `.env.example` bilan mos). To'xtatish: `docker compose down`; ma'lumotlar `onyx_pgdata` volume'da saqlanib qoladi.

**Docker'siz variant:** mashinada nativ Postgres ishlab tursa (masalan, Homebrew), docker compose bosqichini tashlab keting va bir marta quyidagini bajaring — `.env` o'zgarishsiz ishlayveradi:

```bash
psql -h localhost -d postgres -c "CREATE ROLE onyx LOGIN PASSWORD 'onyx_dev' CREATEDB;"
psql -h localhost -d postgres -c "CREATE DATABASE onyx OWNER onyx;"
```

> Diqqat: nativ Postgres 5432-portni band qilgan bo'lsa, `docker compose up` ham ishga tushirilsa port to'qnashadi — bittasini tanlang.

`prisma/schema.prisma` hozircha minimal (S1-A) — domen modeli S1-C sprint-taskida qo'shiladi.

## Jamoa ish tartibi

Repo 3 ta parallel Claude Code terminal bilan yuritiladi — koordinatsiya protokoli [`CLAUDE.md`](CLAUDE.md) da (fayl-lock, kanban, approval gate).
