"use server";

// ТЗ №20 H (§9.2, §9.3) — действия публичной карточки /k/<код>.
//
//   submitCardLead  — заявка клиента без входа (правила и запись — в
//                     src/lib/public-lead.ts; здесь только форма, IP и ответ
//                     для экрана). Публичное действие: входа не требует.
//   setPublicLocale — переключатель ru / uz: cookie на год и назад на страницу.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sendMessage } from "@/lib/telegram";
import {
  PUBLIC_LEAD_HONEYPOT_FIELD,
  submitPublicLead,
  type PublicLeadFieldError,
} from "@/lib/public-lead";
import { normalizeStoneCode } from "@/lib/stone-code";
import { collectionLeadContext, toggleCollectionLike } from "@/lib/collections";
import {
  PUBLIC_LOCALE_COOKIE,
  PUBLIC_LOCALE_COOKIE_MAX_AGE,
  isPublicLocale,
} from "@/lib/public-i18n";

export interface CardLeadState {
  status: "idle" | "ok" | "error";
  /** Ключ словаря public-i18n (errDuplicate / errRate / errFailed …). */
  error: "errDuplicate" | "errRate" | "errFailed" | null;
  fields: Partial<Record<"name" | "phone", PublicLeadFieldError>>;
  /** Введённое — форма при ошибке не теряет текст. */
  values: { name: string; phone: string; comment: string };
}

/**
 * Адрес клиента — первый элемент x-forwarded-for (его ставит прокси, как в
 * login/actions.ts). Нет адреса → "" и IP-лимит не применяется.
 */
async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const first = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
    if (first) return first.slice(0, 64);
    return (h.get("x-real-ip") ?? "").trim().slice(0, 64);
  } catch {
    return "";
  }
}

export async function submitCardLead(
  _prev: CardLeadState,
  formData: FormData,
): Promise<CardLeadState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    comment: String(formData.get("comment") ?? ""),
  };
  const code = normalizeStoneCode(String(formData.get("code") ?? ""));
  if (!code) return { status: "error", error: "errFailed", fields: {}, values };

  try {
    // ТЗ №20 I — заявка со страницы подборки: подборка открыта и камень в ней.
    const collectionCode = formData.get("collection");
    let context: { collectionCode: string; collectionTitle: string } | null = null;
    if (collectionCode) {
      context = await collectionLeadContext(db, { collectionCode, stoneCode: code });
      if (!context) return { status: "error", error: "errFailed", fields: {}, values };
    }
    const r = await submitPublicLead(
      db,
      {
        code,
        form: {
          ...values,
          honeypot: formData.get(PUBLIC_LEAD_HONEYPOT_FIELD),
        },
        ip: await clientIp(),
        context,
      },
      { send: (chatId, text, opts) => sendMessage(chatId, text, opts) },
    );
    switch (r.status) {
      case "ok":
        return {
          status: "ok",
          error: null,
          fields: {},
          values: { name: "", phone: "", comment: "" },
        };
      case "invalid":
        return { status: "error", error: null, fields: r.errors, values };
      case "duplicate":
        return { status: "error", error: "errDuplicate", fields: {}, values };
      case "rate":
        return { status: "error", error: "errRate", fields: {}, values };
      default:
        return { status: "error", error: "errFailed", fields: {}, values };
    }
  } catch (e) {
    console.error("[k] submitCardLead:", e);
    return { status: "error", error: "errFailed", fields: {}, values };
  }
}

/**
 * Только локальные публичные пути — без open-redirect: карточка /k/<код>,
 * каталог /katalog (с фильтрами в строке запроса) и подборка /podborka/<код>.
 */
function safePublicBack(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (/^\/k\/[A-Za-z0-9-]{1,20}$/.test(s)) return s;
  if (/^\/podborka\/[A-Za-z0-9]{1,20}$/.test(s)) return s;
  if (/^\/katalog(\?[A-Za-z0-9_=&%.+\-]{0,400})?$/.test(s)) return s;
  return "/";
}

export async function setPublicLocale(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "");
  const back = safePublicBack(formData.get("back"));
  if (isPublicLocale(locale)) {
    (await cookies()).set(PUBLIC_LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: PUBLIC_LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  }
  redirect(back);
}

/**
 * ТЗ №20 I (§10.3) — «Нравится» на публичной подборке (без входа). Камень и
 * подборку проверяет toggleCollectionLike (открыта, камень её); затем назад
 * на страницу подборки к этому камню.
 */
export async function toggleLikeAction(formData: FormData): Promise<void> {
  const code = String(formData.get("collection") ?? "").trim().toUpperCase();
  const itemId = String(formData.get("item") ?? "");
  try {
    await toggleCollectionLike(db, { code, itemId });
  } catch (e) {
    console.error("[podborka] like:", e);
  }
  const back = safePublicBack(`/podborka/${code}`);
  redirect(back === "/" ? "/" : `${back}#s-${encodeURIComponent(itemId)}`);
}
