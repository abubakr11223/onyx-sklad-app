// Cron backstop — muddati o'tgan bronlarni yopish endpoint'i auth testlari.
// DB YO'Q: barcha tekshirilgan yo'llar (auth muvaffaqiyatsiz) db'ga tegmaydi.
// `expireOverdueReservations` chaqirilmasligini ta'minlash uchun 401 yo'llari.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, isCronAuthorized } from "@/app/api/cron/expire-reservations/route";

function req(headers?: Record<string, string>): Request {
  return new Request("https://onyx.test/api/cron/expire-reservations", {
    headers,
  });
}

const OLD_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (OLD_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = OLD_SECRET;
});

describe("isCronAuthorized", () => {
  it("CRON_SECRET o'rnatilmagan → false (fail-closed)", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(req({ authorization: "Bearer whatever" }))).toBe(
      false,
    );
  });

  it("CRON_SECRET bo'sh satr → false", () => {
    process.env.CRON_SECRET = "";
    expect(isCronAuthorized(req({ authorization: "Bearer " }))).toBe(false);
  });

  it("sarlavha yo'q → false", () => {
    process.env.CRON_SECRET = "s3cr3t";
    expect(isCronAuthorized(req())).toBe(false);
  });

  it("Bearer prefiksisiz → false", () => {
    process.env.CRON_SECRET = "s3cr3t";
    expect(isCronAuthorized(req({ authorization: "s3cr3t" }))).toBe(false);
  });

  it("noto'g'ri token → false", () => {
    process.env.CRON_SECRET = "s3cr3t";
    expect(isCronAuthorized(req({ authorization: "Bearer nope" }))).toBe(false);
  });

  it("to'g'ri Bearer token → true", () => {
    process.env.CRON_SECRET = "s3cr3t";
    expect(isCronAuthorized(req({ authorization: "Bearer s3cr3t" }))).toBe(true);
  });
});

describe("GET — auth darvozasi", () => {
  it("secret'siz so'rov → 401, tanasi {ok:false}", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it("noto'g'ri token → 401", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = await GET(req({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });
});
