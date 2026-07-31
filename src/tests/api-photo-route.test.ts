// Аудит ТЗ №7 #26 — /api/photo/[id] по дизайну открытый (QR show-room, §6.7).
// Whitelist по kind защищает от будущих регрессий: любой новый kind не станет
// автоматически публично доступен, нужно явно расширить allowlist.

import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  photoFindFirst: vi.fn(),
  getFile: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { photo: { findFirst: M.photoFindFirst } },
}));
vi.mock("@/lib/telegram", () => ({
  getFile: M.getFile,
  downloadFile: M.downloadFile,
}));

import { GET } from "@/app/api/photo/[id]/route";

const params = (id: string) => Promise.resolve({ id });

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
});

describe("GET /api/photo/[id] — kind allowlist (ТЗ №7 #26)", () => {
  it("whitelist ровно [SAMPLE, SLAB, PIECE, INTERIOR_AI, DRAWING]", async () => {
    M.photoFindFirst.mockResolvedValue(null);
    await GET(new Request("https://onyx.test/api/photo/x"), { params: params("x") });
    expect(M.photoFindFirst).toHaveBeenCalledTimes(1);
    const where = M.photoFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe("x");
    expect(where.kind).toEqual({
      in: ["SAMPLE", "SLAB", "PIECE", "INTERIOR_AI", "DRAWING"],
    });
  });

  it("photo с whitelist-kind + Blob URL → 308 redirect (публичный QR)", async () => {
    M.photoFindFirst.mockResolvedValue({
      storageKey: "https://blob.vercel-storage.com/patterns/x.jpg",
    });
    const res = await GET(new Request("https://onyx.test/api/photo/x"), {
      params: params("x"),
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toContain("blob.vercel-storage.com");
  });

  it("photo с whitelist-kind + Telegram file_id → bytes stream", async () => {
    M.photoFindFirst.mockResolvedValue({ storageKey: "tg_file_id_123" });
    M.getFile.mockResolvedValue({ file_path: "photos/abc.jpg" });
    M.downloadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const res = await GET(new Request("https://onyx.test/api/photo/x"), {
      params: params("x"),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("file_path .png → Content-Type image/png (not hardcoded jpeg)", async () => {
    M.photoFindFirst.mockResolvedValue({ storageKey: "tg_file_png" });
    M.getFile.mockResolvedValue({ file_path: "photos/stone.png" });
    M.downloadFile.mockResolvedValue(new Uint8Array([0x89, 0x50]));

    const res = await GET(new Request("https://onyx.test/api/photo/x"), {
      params: params("x"),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("photo не найдено ИЛИ kind вне whitelist → 404 (не различается — не даём oracle)", async () => {
    // Case A: id вообще не существует.
    M.photoFindFirst.mockResolvedValue(null);
    const res = await GET(new Request("https://onyx.test/api/photo/x"), {
      params: params("x"),
    });
    expect(res.status).toBe(404);
    // Ключевое: getFile/downloadFile НЕ вызывались (не тратим Telegram-API).
    expect(M.getFile).not.toHaveBeenCalled();
    expect(M.downloadFile).not.toHaveBeenCalled();
  });

  it("регрессия: если из allowlist уберут что-то из существующих 5 — тест провалится", async () => {
    // Явно фиксируем список: любое сокращение — сломает контракт QR show-room.
    M.photoFindFirst.mockResolvedValue(null);
    await GET(new Request("https://onyx.test/api/photo/x"), { params: params("x") });
    const kinds = M.photoFindFirst.mock.calls[0][0].where.kind.in;
    expect(kinds).toContain("SAMPLE");   // узор-фото в приёмке
    expect(kinds).toContain("SLAB");     // выделенная плита
    expect(kinds).toContain("PIECE");    // бой/остаток
    expect(kinds).toContain("INTERIOR_AI"); // §6.7 AI-интерьеры
    expect(kinds).toContain("DRAWING");  // чертёж боя
    expect(kinds).toHaveLength(5);
  });
});
