// ТЗ №12 cleanup — seeds must be pure centimetres (legacy *Mm column names).
// Catches mixed mm/cm datasets that look plausible and break search by ~10×.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPerfDataset, DEFAULT_SCALE } from "@/lib/seed-perf";
import { CUTTING_MARGIN_CM, CUTTING_MARGIN_MM } from "@/lib/dimensions";

const root = join(__dirname, "../..");

/** Extract numeric array after `key: [` until `]`. */
function intsAfter(src: string, key: string): number[] {
  const re = new RegExp(`${key}\\s*:\\s*\\[([^\\]]+)\\]`, "g");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    for (const part of m[1].split(",")) {
      const n = Number(part.trim());
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

function intsField(src: string, key: string): number[] {
  const re = new RegExp(`${key}\\s*:\\s*(\\d+)`, "g");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(Number(m[1]));
  return out;
}

describe("seed cm-scale consistency (no mixed mm/cm)", () => {
  it("cutting margin is 2 cm under both names", () => {
    expect(CUTTING_MARGIN_CM).toBe(2);
    expect(CUTTING_MARGIN_MM).toBe(2);
    expect(CUTTING_MARGIN_MM).toBe(CUTTING_MARGIN_CM);
  });

  it("prisma/seed.ts piece gabarits are cm-scale (no leftover 640/800 mm widths)", () => {
    const src = readFileSync(join(root, "prisma/seed.ts"), "utf8");
    const lengths = intsField(src, "boundingLengthMm");
    const widths = intsField(src, "boundingWidthMm");
    expect(lengths.length).toBeGreaterThan(0);
    expect(widths.length).toBe(lengths.length);

    for (let i = 0; i < lengths.length; i++) {
      const L = lengths[i];
      const W = widths[i];
      // Plausible stone plate/piece in cm: 10..500 cm. MM leftovers often 600–3200.
      expect(L, `boundingLengthMm=${L}`).toBeGreaterThanOrEqual(10);
      expect(L, `boundingLengthMm=${L}`).toBeLessThanOrEqual(500);
      expect(W, `boundingWidthMm=${W}`).toBeGreaterThanOrEqual(10);
      expect(W, `boundingWidthMm=${W}`).toBeLessThanOrEqual(500);
      // Mixed-scale smell: long side in cm-ish, short side still mm (×10).
      if (L <= 300) {
        expect(W, `mixed-scale width for L=${L}`).toBeLessThanOrEqual(L * 1.5);
      }
    }

    const sides = intsAfter(src, "sidesMm");
    for (const s of sides) {
      expect(s, `sidesMm value ${s}`).toBeGreaterThanOrEqual(1);
      expect(s, `sidesMm value ${s} looks like mm leftover`).toBeLessThanOrEqual(500);
    }

    // Explicit anti-regressions for the pre-fix seed bug.
    expect(src).not.toMatch(/boundingWidthMm:\s*640\b/);
    expect(src).not.toMatch(/boundingWidthMm:\s*800\b/);
    expect(src).not.toMatch(/sidesMm:\s*\[[^\]]*610/);
  });

  it("prisma/seed.ts slab dims are cm (280×190 not 2800×1900)", () => {
    const src = readFileSync(join(root, "prisma/seed.ts"), "utf8");
    const slabBlock = src.slice(src.indexOf("prisma.slab.create"));
    const L = intsField(slabBlock, "lengthMm");
    const W = intsField(slabBlock, "widthMm");
    for (const n of [...L, ...W]) {
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(500);
    }
  });

  it("buildPerfDataset slabs and pieces share cm-scale (no 1800–3200 mm slabs)", () => {
    // Tiny deterministic dataset is enough to exercise generators.
    const { slabs, pieces } = buildPerfDataset(
      { types: 2, slabs: 20, pieces: 20 },
      42,
    );
    expect(slabs.length).toBe(20);
    expect(pieces.length).toBe(20);

    for (const s of slabs) {
      const L = s.lengthMm as number;
      const W = s.widthMm as number;
      expect(L).toBeGreaterThanOrEqual(100);
      expect(L).toBeLessThanOrEqual(400);
      expect(W).toBeGreaterThanOrEqual(50);
      expect(W).toBeLessThanOrEqual(250);
      // area ≈ L*W/10000 m² for cm
      if (s.areaM2 != null) {
        const a = Number(s.areaM2);
        expect(a).toBeCloseTo((L * W) / 10_000, 2);
      }
    }

    for (const p of pieces) {
      const L = p.boundingLengthMm as number;
      const W = p.boundingWidthMm as number;
      expect(L).toBeGreaterThanOrEqual(10);
      expect(L).toBeLessThanOrEqual(300);
      expect(W).toBeGreaterThanOrEqual(10);
      expect(W).toBeLessThanOrEqual(200);
    }

    // Guard: old mm-scale slab generator produced values ≥ 1800.
    expect(slabs.every((s) => (s.lengthMm as number) < 1000)).toBe(true);
  });

  it("DEFAULT_SCALE still defined for load tests", () => {
    expect(DEFAULT_SCALE.types).toBeGreaterThan(0);
    expect(DEFAULT_SCALE.slabs).toBeGreaterThan(0);
  });
});
