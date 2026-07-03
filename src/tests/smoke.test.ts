import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";

describe("smoke", () => {
  it("test runner works", () => {
    expect(1 + 1).toBe(2);
  });

  it("app metadata is in Russian per ADR-001", () => {
    expect(metadata.title).toBe("Onyx — складская система");
  });
});
