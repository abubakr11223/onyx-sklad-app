// W2-T1 — TIKLASH MASHQI (integration). Zaxira fayli bor-yo'g'i va'da;
// bu test va'dani ISBOTLAYDI: dev bazadan loyihaning o'z snapshot kodi bilan
// zaxira olinadi, alohida qoralama bazaga HAQIQIY restore CLI yurgiziladi,
// so'ng har bir jadval sanog'i solishtiriladi va Piece.boundingAreaMm2
// (GENERATED ALWAYS … STORED) bazaning o'zi tomonidan qayta hisoblangani
// tekshiriladi — aynan shu ustun eski tiklashni yiqitardi.
//
// Darvoza: DATABASE_URL bo'lmasa (CI, oddiy `npm test`) — o'tkazib yuboriladi.
// Yurgizish (lokal Postgres, .env dagi qiymat bilan):
//   DATABASE_URL="postgresql://onyx:onyx_dev@localhost:5432/onyx?schema=public" \
//     npx vitest run src/tests/restore-rehearsal.integration.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  SNAPSHOT_TABLES,
  buildSnapshot,
  snapshotToJson,
  type Snapshot,
} from "@/lib/db-snapshot";

const DB_URL = process.env.DATABASE_URL;
/** Qoralama baza — har yurgizishda noldan yaratiladi va oxirida o'chiriladi. */
const SCRATCH_DB = "onyx_restore_rehearsal_test";
const REPO_ROOT = process.cwd();

function scratchUrl(sourceUrl: string): string {
  const u = new URL(sourceUrl);
  u.pathname = `/${SCRATCH_DB}`;
  return u.toString();
}

describe.skipIf(!DB_URL)("tiklash mashqi — snapshot → qoralama baza → solishtirish", () => {
  // PrismaClient dinamik import bilan: DATABASE_URL yo'q muhitda (CI) modul
  // yuklanishining o'zi yiqilmasin — skip bo'lgan testda import ham bo'lmaydi.
  let cleanup: (() => Promise<void>) | null = null;

  afterAll(async () => {
    await cleanup?.();
  });

  it(
    "har jadval sanog'i mos, boundingAreaMm2 bazada qayta hisoblanadi",
    async () => {
      const { PrismaClient } = await import("@prisma/client");
      const source = new PrismaClient();
      const target = new PrismaClient({ datasourceUrl: scratchUrl(DB_URL!) });
      const workDir = mkdtempSync(path.join(tmpdir(), "onyx-rehearsal-"));

      cleanup = async () => {
        await target.$disconnect().catch(() => {});
        await source
          .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`)
          .catch(() => {});
        await source.$disconnect().catch(() => {});
        rmSync(workDir, { recursive: true, force: true });
      };

      // 1. Qoralama baza — noldan.
      await source.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
      await source.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`);

      // 2. Sxema — haqiqiy migratsiyalar bilan. cwd repo TASHQARISIDA:
      //    prisma CLI repo ildizidagi .env ni topib DATABASE_URL ustidan
      //    yozadi — tashqaridan yurgizilsa faqat bergan muhitimiz ishlaydi.
      execFileSync(
        path.join(REPO_ROOT, "node_modules", ".bin", "prisma"),
        ["migrate", "deploy", "--schema", path.join(REPO_ROOT, "prisma", "schema.prisma")],
        {
          cwd: workDir,
          env: {
            ...process.env,
            DATABASE_URL: scratchUrl(DB_URL!),
            DATABASE_URL_UNPOOLED: scratchUrl(DB_URL!),
          },
          stdio: "pipe",
        },
      );

      // 3. Zaxira — loyihaning O'Z snapshot kodi bilan (fayl formati aynan
      //    cron/backup yuboradiganidek).
      const snapshot: Snapshot = await buildSnapshot(source, new Date().toISOString());
      const pieces = snapshot.rows.piece as {
        id: string;
        boundingLengthMm: number;
        boundingWidthMm: number;
        boundingAreaMm2: number;
      }[];
      // Mashq ma'nosiz bo'lmasin: generated ustunli jadvalda yozuv bo'lishi
      // shart (bo'sh bazada avval `npm run seed:demo`).
      expect(pieces.length, "dev bazada Piece yo'q — npm run seed:demo yurgizing").toBeGreaterThan(0);
      const backupFile = path.join(workDir, "rehearsal-backup.json");
      writeFileSync(backupFile, snapshotToJson(snapshot));

      // 4. HAQIQIY restore CLI — hech qanday mock yo'q.
      const out = execFileSync(
        path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
        [path.join(REPO_ROOT, "prisma", "restore-cli.ts"), `--file=${backupFile}`, "--execute", "--yes"],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            DATABASE_URL: scratchUrl(DB_URL!),
            DATABASE_URL_UNPOOLED: scratchUrl(DB_URL!),
            ONYX_RESTORE_ALLOW: "I_UNDERSTAND_WRITE",
          },
          stdio: "pipe",
        },
      ).toString();
      expect(out).toContain("✅ Tiklandi");
      expect(out).toContain("boundingAreaMm2");

      // 5. HAR BIR jadval: qoralama bazadagi sanoq zaxiradagi bilan bir xil.
      const t = target as unknown as Record<string, { count: () => Promise<number> }>;
      for (const table of SNAPSHOT_TABLES) {
        const restored = await t[table].count();
        expect(restored, `jadval ${table}: sanoq mos emas`).toBe(snapshot.counts[table]);
      }

      // 6. Piece tekshiruvi: boundingAreaMm2 INSERT'da yuborilmagan, bazaning
      //    o'zi L×W dan qayta hisoblagan va manbadagi qiymat bilan bir xil.
      for (const p of pieces.slice(0, 3)) {
        const restored = await (target as unknown as {
          piece: { findUnique: (a: { where: { id: string } }) => Promise<typeof p | null> };
        }).piece.findUnique({ where: { id: p.id } });
        expect(restored).not.toBeNull();
        expect(restored!.boundingAreaMm2).toBe(p.boundingLengthMm * p.boundingWidthMm);
        expect(restored!.boundingAreaMm2).toBe(p.boundingAreaMm2);
      }
    },
    180_000,
  );
});
