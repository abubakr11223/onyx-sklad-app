// Karta holati API (Part 2). GET — ochiq (hamma o'qiydi). POST — auth cookie
// (site) + per-user session (identity). App Router route-handler.
//
// Аудит ТЗ №7 #25 — раньше POST-гейт был только onyx_auth (shared APP_PASSWORD
// token без userId → «кто-то знает пароль», не «кто именно»), а updatedBy шёл
// прямо из body → cross-role toggling и forged attribution среди тех, кто знает
// один общий пароль. Теперь ДОПОЛНИТЕЛЬНО требуем onyx_session (per-user), а
// `updatedBy` устанавливается сервером из name/id актёра, body-updatedBy
// игнорируется.
import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { getKartaState, isValidCellId, setKartaCell } from "@/lib/karta";
import { getRealSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ cells: await getKartaState() });
}

export async function POST(req: Request) {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyToken(token))) {
    return new Response("unauthorized", { status: 401 });
  }

  // Аудит ТЗ №7 #25 — per-user session нужен для достоверного `updatedBy`.
  const me = await getRealSessionUser();
  if (!me) return new Response("unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return new Response("bad request", { status: 400 });
  }
  const { cellId, done } = body as {
    cellId?: unknown;
    done?: unknown;
  };

  if (typeof cellId !== "string" || !isValidCellId(cellId)) {
    return new Response("bad request", { status: 400 });
  }
  if (typeof done !== "boolean") {
    return new Response("bad request", { status: 400 });
  }

  // updatedBy — только сервер (ignore body). Формат: name (обрезан до 40),
  // fallback на id — гарантирует непустую атрибуцию.
  const by = (me.name?.trim() || me.id).slice(0, 40);

  await setKartaCell(cellId, done, by);
  return Response.json({ ok: true });
}
