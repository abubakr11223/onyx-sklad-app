// W5-A — pure helpers exported from /poisk page (formatTypeLocations).
// Full page.tsx is a Next server component (not imported here — same policy as
// poisk-page-invariants.test.ts). Only the multi-location formatter is tested.
import { describe, expect, it } from "vitest";
import { formatTypeLocations } from "@/app/poisk/page";

describe("formatTypeLocations — compact multi-BatchLocation line", () => {
  it("returns null for empty input", () => {
    expect(formatTypeLocations([])).toBeNull();
  });

  it("formats a single location like the stone card lexicon", () => {
    expect(formatTypeLocations([{ block: "А", landmark: "2" }])).toBe(
      "Блок А, ор. 2",
    );
  });

  it("dedupes identical (block, landmark) across batches", () => {
    expect(
      formatTypeLocations([
        { block: "А", landmark: "2" },
        { block: "А", landmark: "2" },
        { block: "Б", landmark: "1" },
      ]),
    ).toBe("Блок А, ор. 2 · Блок Б, ор. 1");
  });

  it("shows at most 3 points then «и ещё N»", () => {
    const locs = [
      { block: "А", landmark: "1" },
      { block: "А", landmark: "2" },
      { block: "Б", landmark: "1" },
      { block: "В", landmark: "3" },
      { block: "Г", landmark: "4" },
    ];
    expect(formatTypeLocations(locs)).toBe(
      "Блок А, ор. 1 · Блок А, ор. 2 · Блок Б, ор. 1 · и ещё 2",
    );
  });

  it("respects custom maxPoints", () => {
    expect(
      formatTypeLocations(
        [
          { block: "А", landmark: "1" },
          { block: "Б", landmark: "2" },
        ],
        1,
      ),
    ).toBe("Блок А, ор. 1 · и ещё 1");
  });
});
