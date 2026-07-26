// Аудит ТЗ №7 #29 — extFromMime раньше жил в двух копиях (priemka знал webp,
// kamen — только png/jpg). Единый контракт: image/png → png, image/webp → webp,
// всё остальное (image/jpeg, application/octet-stream и т.п.) → jpg.
import { describe, expect, it } from "vitest";
import { extFromMime } from "@/lib/photo-blob";

describe("extFromMime (ТЗ №7 #29)", () => {
  it("image/png → png", () => {
    expect(extFromMime("image/png")).toBe("png");
  });
  it("image/webp → webp (регрессия к 'jpg' — priemka знала, kamen нет)", () => {
    expect(extFromMime("image/webp")).toBe("webp");
  });
  it("image/jpeg → jpg", () => {
    expect(extFromMime("image/jpeg")).toBe("jpg");
  });
  it("неизвестный / octet-stream → jpg (безопасный дефолт)", () => {
    expect(extFromMime("application/octet-stream")).toBe("jpg");
    expect(extFromMime("")).toBe("jpg");
  });
});
