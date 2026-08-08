// BUG-OWN — stale session after password change / delete / deactivate.
//
// Edge (proxy) only verifies cookie signature (no DB). getCurrentUser also
// requires active user + matching tokenVersion. Without layout re-login, the
// owner saw a half-in shell (nav empty / DENY_ALL caps → only «Поиск»).
//
// Layers locked here:
//  (1) getCapabilities → DENY_ALL when session invalid
//  (2) nav filter with DENY_ALL
//  (3) staleSessionLoginHref contract + layout/proxy wiring (proves redirect)
//  (4) public-path header strip contract (forged header must not force login)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── cookie store mock ──
const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

// ── db mock: getCurrentUser only uses user.findFirst ──
const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

import { SESSION_COOKIE, signSessionToken } from "@/lib/auth";
import { canAccessNav, NAV_REQUIRED_CAPABILITY } from "@/lib/nav-access";
import { DENY_ALL, capabilitiesFor } from "@/lib/permissions";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import {
  GATED_REQUEST_HEADER,
  isProxyPublicPath,
  staleSessionLoginHref,
  stripClientGatedHeader,
} from "@/lib/gated-request";

const OWNER_ID = "user-owner-1";

const ownerRow = (tokenVersion: number) => ({
  id: OWNER_ID,
  name: "Рустам Каримов",
  role: "OWNER",
  canSeePurchasePrice: true,
  tokenVersion,
});

beforeEach(() => {
  process.env.AUTH_COOKIE_SECRET = "test-secret-owner-nav";
  cookieGet.mockReset();
  findFirst.mockReset();
});

// ─── Completeness: three revoke cases → getCurrentUser null + DENY_ALL ───

describe("completeness — deleted / deactivated / tokenVersion", () => {
  it("tokenVersion bumped (password / log-out-everywhere) → null user + DENY_ALL", async () => {
    cookieGet.mockReturnValue({ value: await signSessionToken(OWNER_ID, 0) });
    findFirst.mockResolvedValue(ownerRow(1)); // DB ahead of cookie

    expect(await getCurrentUser()).toBeNull();
    const caps = await getCapabilities();
    expect(caps).toEqual(DENY_ALL);
    expect(caps.requestsRouteToManager).toBe(false);
  });

  it("deleted or deactivated (findFirst null for isActive:true) → DENY_ALL", async () => {
    cookieGet.mockReturnValue({ value: await signSessionToken(OWNER_ID, 0) });
    findFirst.mockResolvedValue(null);

    expect(await getCurrentUser()).toBeNull();
    expect(await getCapabilities()).toEqual(DENY_ALL);
  });

  it("no cookie → DENY_ALL, no DB hit", async () => {
    cookieGet.mockReturnValue(undefined);
    expect(await getCapabilities()).toEqual(DENY_ALL);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("fresh session → OWNER caps (control)", async () => {
    cookieGet.mockReturnValue({ value: await signSessionToken(OWNER_ID, 3) });
    findFirst.mockResolvedValue(ownerRow(3));
    expect(await getCapabilities()).toEqual(
      capabilitiesFor("OWNER", { canSeePurchasePrice: true }),
    );
  });
});

// ─── Layout redirect contract (fails if pure logic or wiring removed) ───

describe("staleSessionLoginHref — layout re-login contract", () => {
  it("null user + gated stamp → /login?next=… (THE product fix)", () => {
    expect(staleSessionLoginHref(true, "/prodazha")).toBe(
      "/login?next=" + encodeURIComponent("/prodazha"),
    );
    expect(staleSessionLoginHref(true, "/fotozapros?x=1")).toBe(
      "/login?next=" + encodeURIComponent("/fotozapros?x=1"),
    );
    expect(staleSessionLoginHref(true, "/")).toBe("/login");
  });

  it("null user WITHOUT stamp → no redirect (public /login /q after strip)", () => {
    expect(staleSessionLoginHref(true, null)).toBeNull();
    expect(staleSessionLoginHref(true, undefined)).toBeNull();
    expect(staleSessionLoginHref(true, "")).toBeNull();
  });

  it("user present + stamp → no redirect", () => {
    expect(staleSessionLoginHref(false, "/prodazha")).toBeNull();
  });

  /**
   * Wiring proof: if someone deletes the layout call to staleSessionLoginHref
   * (or the redirect), this fails — pure unit tests alone would still pass.
   * That is the gap the 2026-08-07 audit called out.
   */
  it("RootLayout source wires staleSessionLoginHref + redirect (fails without fix)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    expect(src).toMatch(/staleSessionLoginHref/);
    expect(src).toMatch(/GATED_REQUEST_HEADER/);
    // Must actually redirect — not only compute the href
    expect(src).toMatch(/staleLogin\)\s*redirect\(staleLogin\)/);
  });

  it("proxy source strips then optionally sets stamp (forged header defense)", () => {
    const src = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(src).toMatch(/stripClientGatedHeader/);
    expect(src).toMatch(/isProxyPublicPath/);
    expect(src).toMatch(/headers\.set\(\s*\n?\s*GATED_REQUEST_HEADER/);
  });
});

// ─── Forged header on excluded routes ───

describe("forged x-onyx-gated on public paths", () => {
  it("isProxyPublicPath covers login / api / q / tg", () => {
    expect(isProxyPublicPath("/login")).toBe(true);
    expect(isProxyPublicPath("/login/tg")).toBe(true);
    expect(isProxyPublicPath("/api/telegram/webhook")).toBe(true);
    expect(isProxyPublicPath("/q/showroom-slug")).toBe(true);
    expect(isProxyPublicPath("/tg")).toBe(true);
    expect(isProxyPublicPath("/prodazha")).toBe(false);
    expect(isProxyPublicPath("/poisk")).toBe(false);
  });

  it("stripClientGatedHeader removes client-forged stamp", () => {
    const h = new Headers();
    h.set(GATED_REQUEST_HEADER, "/prodazha");
    h.set("cookie", "x=1");
    stripClientGatedHeader(h);
    expect(h.get(GATED_REQUEST_HEADER)).toBeNull();
    expect(h.get("cookie")).toBe("x=1");
  });

  it("after strip, staleSessionLoginHref does not re-login (QR /login safe)", () => {
    const h = new Headers();
    h.set(GATED_REQUEST_HEADER, "/evil");
    stripClientGatedHeader(h);
    expect(staleSessionLoginHref(true, h.get(GATED_REQUEST_HEADER))).toBeNull();
  });
});

// ─── Nav signature of the original complaint ───

describe("nav with DENY_ALL (complaint signature)", () => {
  const visible = (caps: Parameters<typeof canAccessNav>[1]) =>
    Object.keys(NAV_REQUIRED_CAPABILITY).filter((href) =>
      canAccessNav(href, caps),
    );

  it("DENY_ALL → only always-open routes («Поиск»/«Карта»)", () => {
    expect(visible(DENY_ALL)).toEqual(["/poisk", "/karta"]);
  });

  it("OWNER → all nav keys", () => {
    const owner = capabilitiesFor("OWNER", { canSeePurchasePrice: true });
    expect(visible(owner)).toEqual(Object.keys(NAV_REQUIRED_CAPABILITY));
  });
});
