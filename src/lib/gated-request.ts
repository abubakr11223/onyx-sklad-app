// BUG-OWN — Edge proxy ↔ RootLayout handshake for stale sessions.
//
// Proxy (no DB) can only verify cookie signature. When signature is valid it
// stamps GATED_REQUEST_HEADER with the path; layout (Node+DB) loads the user
// and, if null (deleted / inactive / tokenVersion mismatch), redirects to login.
//
// Trust model:
//  • Clients can send any request header. Never trust x-onyx-gated unless this
//    process overwrote it after a successful verify.
//  • Proxy runs on ALL page/API entry paths (except static assets) so it can
//    DELETE a client-forged header before the request reaches RootLayout.
//  • Only after signature OK does proxy SET the header to the real path.
//  • Public paths (/login, /api, /q, /tg) never SET the header — only strip.

import { GATED_REQUEST_HEADER } from "@/lib/auth";

export { GATED_REQUEST_HEADER };

/**
 * Paths where the login-gate must NOT redirect unauthenticated browsers away
 * (and must NOT set the gated stamp). Mirrors the historical negative-lookahead
 * matcher, used as an allowlist of public entry points inside proxy.
 */
export function isProxyPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  // §6.7 QR showroom — client without account
  if (pathname === "/q" || pathname.startsWith("/q/")) return true;
  if (pathname === "/tg" || pathname.startsWith("/tg/")) return true;
  return false;
}

/** Remove client-supplied stamp so RootLayout cannot be DoS'd into re-login loops. */
export function stripClientGatedHeader(headers: Headers): void {
  headers.delete(GATED_REQUEST_HEADER);
}

/**
 * RootLayout contract: null user + proxy stamp → absolute login href (with ?next=).
 * Returns null when no redirect should run (user present, or no stamp).
 *
 * Pure — unit-tested. Layout must call this and `redirect(href)` when non-null;
 * removing that wiring re-opens half-logged-in shell (BUG-OWN).
 */
export function staleSessionLoginHref(
  userIsNull: boolean,
  gatedPath: string | null | undefined,
): string | null {
  if (!userIsNull) return null;
  if (gatedPath == null || gatedPath === "") return null;
  // Proxy only sets local path+search; still encode for ?next=
  const back =
    gatedPath !== "/" ? `?next=${encodeURIComponent(gatedPath)}` : "";
  return `/login${back}`;
}
