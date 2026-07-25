// Аудит ТЗ №7 #10 — login/tg маршрут: verify → consumeMagicLinkJti → session cookie.
// Проверяем интегральный поток: (a) первый заход с валидным токеном ставит cookie,
// (b) второй заход с ТЕМ ЖЕ токеном (replay) → cookie НЕ ставится + редирект на
// /login?error=magic (сабаб оshkor etilmaydi).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { signMagicLinkToken } from "@/lib/auth";

const M = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  consume: vi.fn(),
  prune: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: (...a: unknown[]) => M.userFindFirst(...a),
    },
  },
}));
vi.mock("@/lib/magic-link-store", () => ({
  consumeMagicLinkJti: (...a: unknown[]) => M.consume(...a),
  pruneExpiredMagicJti: (...a: unknown[]) => M.prune(...a),
}));

// AUTH_COOKIE_SECRET нужен для реального signMagicLinkToken/signSessionToken —
// подписи считаются через Web Crypto.
process.env.AUTH_COOKIE_SECRET = "test-secret-for-magic-jti";

import { GET } from "@/app/login/tg/route";

const USER_ID = "ckuser000000000000000000";
const JTI = "abc12300-0000-4000-8000-000000000000";

async function mkToken(expOffsetMs: number, jti: string = JTI): Promise<string> {
  return signMagicLinkToken(USER_ID, Date.now() + expOffsetMs, jti);
}

function mkRequest(token: string): Request {
  return new Request(`https://onyx.test/login/tg?token=${encodeURIComponent(token)}`);
}

beforeEach(() => {
  M.userFindFirst.mockReset();
  M.consume.mockReset();
  M.prune.mockClear();
  M.userFindFirst.mockResolvedValue({ id: USER_ID, tokenVersion: 0 });
});

describe("login/tg GET — single-use (ТЗ №7 #10)", () => {
  it("happy: consume → 'consumed' → session cookie ставится, редирект на /", async () => {
    M.consume.mockResolvedValueOnce("consumed");
    const token = await mkToken(60_000);

    const res = await GET(mkRequest(token));

    expect(res.status).toBe(307); // NextResponse.redirect
    // Cookie onyx_session есть в ответе.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/onyx_session=/);
    // Consume был вызван С правильным jti и userId.
    expect(M.consume).toHaveBeenCalledTimes(1);
    expect(M.consume.mock.calls[0][0]).toBe(JTI);
    expect(M.consume.mock.calls[0][1]).toBe(USER_ID);
  });

  it("REPLAY: consume → 'already_used' → cookie НЕ ставится, редирект на /login?error=magic", async () => {
    M.consume.mockResolvedValueOnce("already_used");
    const token = await mkToken(60_000);

    const res = await GET(mkRequest(token));

    expect(res.status).toBe(307);
    // Ключевой момент: session cookie НЕ проставлена.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(/onyx_session=/);
    // Redirect направлен на /login?error=magic (сабаб оshkor etilmaydi).
    const loc = res.headers.get("location") ?? "";
    expect(loc).toMatch(/\/login\?error=magic/);
    // Пользователь даже не искался в БД — replay отрезан до user lookup.
    expect(M.userFindFirst).not.toHaveBeenCalled();
  });

  it("consume 'error' (БД падение) → cookie НЕ ставится, редирект на /login?error=magic (fail-closed)", async () => {
    M.consume.mockResolvedValueOnce("error");
    const token = await mkToken(60_000);

    const res = await GET(mkRequest(token));

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(/onyx_session=/);
    expect(res.headers.get("location") ?? "").toMatch(/\/login\?error=magic/);
    expect(M.userFindFirst).not.toHaveBeenCalled();
  });

  it("verify провалилось (expired/badsig/legacy) → consume даже НЕ вызывается", async () => {
    const expired = await mkToken(-60_000); // прошедшее время
    const res = await GET(mkRequest(expired));
    expect(res.headers.get("location") ?? "").toMatch(/\/login\?error=magic/);
    expect(M.consume).not.toHaveBeenCalled();
    expect(M.userFindFirst).not.toHaveBeenCalled();
  });

  it("consumed, но user деактивирован/удалён → cookie НЕ ставится (fail-closed)", async () => {
    M.consume.mockResolvedValueOnce("consumed");
    M.userFindFirst.mockResolvedValueOnce(null);
    const token = await mkToken(60_000);

    const res = await GET(mkRequest(token));

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(/onyx_session=/);
    expect(res.headers.get("location") ?? "").toMatch(/\/login\?error=magic/);
  });
});
