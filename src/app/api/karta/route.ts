// Karta holati API (Part 2). GET — ochiq (hamma o'qiydi). POST — faqat auth
// cookie bilan (egasi tahrirlaydi). App Router route-handler.
import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { getKartaState, isValidCellId, setKartaCell } from "@/lib/karta";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return new Response("bad request", { status: 400 });
  }
  const { cellId, done, updatedBy } = body as {
    cellId?: unknown;
    done?: unknown;
    updatedBy?: unknown;
  };

  if (typeof cellId !== "string" || !isValidCellId(cellId)) {
    return new Response("bad request", { status: 400 });
  }
  if (typeof done !== "boolean") {
    return new Response("bad request", { status: 400 });
  }

  const by =
    typeof updatedBy === "string" && updatedBy.trim().length > 0
      ? updatedBy.trim().slice(0, 40)
      : "owner";

  await setKartaCell(cellId, done, by);
  return Response.json({ ok: true });
}
