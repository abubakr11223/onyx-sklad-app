// Аудит ТЗ №7 #25 — /api/karta POST раньше принимал `updatedBy` из тела и
// требовал только shared onyx_auth (без userId). Теперь: session-gate
// (onyx_session, per-user) + server-derived `updatedBy` (body игнорируется).

import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getRealSessionUser: vi.fn(),
  setKartaCell: vi.fn().mockResolvedValue(undefined),
  isValidCellId: vi.fn().mockReturnValue(true),
  verifyToken: vi.fn().mockResolvedValue(true),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: M.cookieGet }),
}));
vi.mock("@/lib/session", () => ({
  getRealSessionUser: M.getRealSessionUser,
}));
vi.mock("@/lib/karta", () => ({
  getKartaState: vi.fn(),
  isValidCellId: M.isValidCellId,
  setKartaCell: M.setKartaCell,
}));
vi.mock("@/lib/auth", () => ({
  COOKIE_NAME: "onyx_auth",
  verifyToken: M.verifyToken,
}));

import { POST } from "@/app/api/karta/route";

function mkReq(body: unknown): Request {
  return new Request("https://onyx.test/api/karta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(M).forEach((f) => {
    if ("mockReset" in f) (f as ReturnType<typeof vi.fn>).mockReset();
  });
  M.verifyToken.mockResolvedValue(true);
  M.isValidCellId.mockReturnValue(true);
  M.setKartaCell.mockResolvedValue(undefined);
  M.cookieGet.mockImplementation((name: string) => {
    if (name === "onyx_auth") return { value: "auth-token-valid" };
    return undefined;
  });
});

describe("POST /api/karta gate (ТЗ №7 #25)", () => {
  it("нет onyx_auth cookie → 401, setKartaCell НЕ вызывается", async () => {
    M.cookieGet.mockImplementation(() => undefined);
    const res = await POST(mkReq({ cellId: "A1", done: true }));
    expect(res.status).toBe(401);
    expect(M.setKartaCell).not.toHaveBeenCalled();
  });

  it("onyx_auth есть, но onyx_session НЕТ (getRealSessionUser=null) → 401", async () => {
    M.getRealSessionUser.mockResolvedValue(null);
    const res = await POST(mkReq({ cellId: "A1", done: true }));
    expect(res.status).toBe(401);
    expect(M.setKartaCell).not.toHaveBeenCalled();
  });

  it("оба cookie валидны → 200 + updatedBy = server-derived name", async () => {
    M.getRealSessionUser.mockResolvedValue({
      id: "u1",
      name: "Абу Бакр",
      role: "OWNER",
    });
    const res = await POST(mkReq({ cellId: "A1", done: true, updatedBy: "FAKED" }));
    expect(res.status).toBe(200);
    expect(M.setKartaCell).toHaveBeenCalledTimes(1);
    // Ключевое: `by` = server name, а НЕ клиентский "FAKED".
    expect(M.setKartaCell).toHaveBeenCalledWith("A1", true, "Абу Бакр");
  });

  it("name пусто → fallback на id (не пустой updatedBy)", async () => {
    M.getRealSessionUser.mockResolvedValue({ id: "u2", name: "", role: "OWNER" });
    const res = await POST(mkReq({ cellId: "A2", done: false }));
    expect(res.status).toBe(200);
    expect(M.setKartaCell).toHaveBeenCalledWith("A2", false, "u2");
  });

  it("body без cellId → 400 (bad request), setKartaCell НЕ вызывается", async () => {
    M.getRealSessionUser.mockResolvedValue({ id: "u1", name: "N", role: "OWNER" });
    const res = await POST(mkReq({ done: true }));
    expect(res.status).toBe(400);
    expect(M.setKartaCell).not.toHaveBeenCalled();
  });

  it("body-updatedBy игнорируется даже если валидный (source of truth = сервер)", async () => {
    M.getRealSessionUser.mockResolvedValue({
      id: "u1",
      name: "RealUser",
      role: "OWNER",
    });
    await POST(mkReq({ cellId: "B3", done: true, updatedBy: "spoofer" }));
    expect(M.setKartaCell).toHaveBeenCalledWith("B3", true, "RealUser");
    // Проверяем ещё раз явно, что "spoofer" никуда не попал.
    const args = M.setKartaCell.mock.calls[0];
    expect(args[2]).not.toBe("spoofer");
  });
});
