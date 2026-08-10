"use server";

// Login/logout server-action'lari (Part 1). Parol to'g'ri bo'lsa — imzolangan
// cookie o'rnatiladi va `next` ga qaytariladi (faqat ichki, same-site yo'l).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_NAME,
  SESSION_COOKIE,
  signSessionToken,
  signToken,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyUserPassword } from "@/lib/password";
import { normalizeEmail } from "@/lib/accounts";
import {
  clearLoginFailures,
  isLoginBlocked,
  pruneOldLoginAttempts,
  recordLoginFailure,
} from "@/lib/login-throttle";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * Timing-oracle himoyasi: foydalanuvchi TOPILMAGANDA ham bitta PBKDF2 tekshiruvi
 * yuritiladi (bu doimiy hash ustida), shunda «login yo'q» yo'li «parol noto'g'ri»
 * yo'li bilan taxminan bir xil vaqt oladi — email mavjudligini vaqt orqali aniqlab
 * bo'lmaydi. Bu — real hisob EMAS, faqat throwaway satr xeshi (hech qachon mos
 * kelmaydi). Format: pbkdf2$100000$<saltB64>$<hashB64> (password.ts bilan bir xil).
 */
const DUMMY_PASSWORD_HASH =
  "pbkdf2$100000$jih/k+dr4aFCwtfkuR9zZg==$0+HV9lG7i0mmYKpsBnu1DeXOF8HkVMwKWyqhrfrO2pE=";

/**
 * `next`'ni faqat ichki (same-site) yo'lga cheklaydi: `/` bilan boshlanadi, lekin
 * ikkinchi belgi `/` yoki `\` emas — `//evil.com` va `/\evil.com` (brauzer `\`→`/`
 * normalizatsiyasi bilan protokol-nisbiy tashqi URL) open-redirect'ini yopadi.
 */
function sanitizeNext(raw: string): string {
  if (!raw.startsWith("/") || raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

/**
 * Аудит 2026-08-10 — адрес клиента для троттлинга. За прокси (Vercel/Caddy)
 * реальный адрес приходит в `x-forwarded-for`; берём ПЕРВЫЙ элемент — его
 * ставит прокси, остальные может подделать клиент. Адреса нет → "" (тогда
 * ip-область просто не применяется, email-область остаётся).
 *
 * ⚠️ В URL/лог адрес не попадает — только ключ строки в таблице троттлинга.
 */
async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for") ?? "";
    const first = xff.split(",")[0]?.trim() ?? "";
    if (first) return first.slice(0, 64);
    return (h.get("x-real-ip") ?? "").trim().slice(0, 64);
  } catch {
    return "";
  }
}

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNext(String(formData.get("next") ?? "/"));

  if (!verifyPassword(password)) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const token = await signToken();
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: THIRTY_DAYS,
  });

  redirect(next);
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  redirect("/");
}

// ───────────────────────── OWN-03: haqiqiy login (email + parol) ─────────────────────────

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: THIRTY_DAYS,
};

/**
 * Email + parol bo'yicha haqiqiy login. Muvaffaqiyatda — imzolangan `onyx_session`
 * cookie'si (getCurrentUser demo-roldan ustun qo'yadi) va `next`ga qaytish.
 *
 * ⚠️ XAVFSIZLIK: xato DOIM generic (`error=login`) — qaysi biri (login/parol)
 * noto'g'ri ekani OSHKOR ETILMAYDI (user-enumeration'dan himoya). passwordHash
 * null bo'lgan (masalan, faqat Telegram) foydalanuvchi PAROL bilan kira olmaydi.
 */
export async function loginWithPassword(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNext(String(formData.get("next") ?? "/"));

  const ip = await clientIp();

  const fail = (): never =>
    redirect(`/login?error=login&next=${encodeURIComponent(next)}`);

  if (!email || !password) return fail();

  // ─── Аудит 2026-08-10: троттлинг ДО хеширования ───────────────────────────
  // Проверка стоит один индексный SELECT; PBKDF2 — 100k итераций. Порядок
  // важен: отклонив здесь, мы не даём перебору жечь CPU функции.
  const now = new Date();
  const [emailBlock, ipBlock] = await Promise.all([
    isLoginBlocked("email", email, now),
    ip ? isLoginBlocked("ip", ip, now) : Promise.resolve({ blocked: false, retryAfterMs: 0 }),
  ]);
  if (emailBlock.blocked || ipBlock.blocked) {
    // Отдельный код ошибки: пользователю нужно знать, что дело во времени, а не
    // в пароле — иначе он будет менять пароль, который на самом деле верен.
    redirect(`/login?error=throttled&next=${encodeURIComponent(next)}`);
  }

  // Таблица не должна расти вечно — ленивая чистка «в фоне» (как webhook receipt).
  void pruneOldLoginAttempts(now);

  const noteFailure = async (): Promise<never> => {
    await Promise.all([
      recordLoginFailure("email", email, now),
      ip ? recordLoginFailure("ip", ip, now) : Promise.resolve(),
    ]);
    return fail();
  };

  const user = await db.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, passwordHash: true, tokenVersion: true },
  });
  // Foydalanuvchi yo'q → DUMMY xesh ustida bitta verify yuritamiz (timing-oracle
  // himoyasi), so'ng generic xato. Bu «parol noto'g'ri» yo'li bilan vaqtni tenglashtiradi.
  if (!user) {
    await verifyUserPassword(password, DUMMY_PASSWORD_HASH);
    return noteFailure();
  }
  // Аудит ТЗ №7 #22 — passwordHash null (Telegram-only akkaunt) branch раньше
  // возвращал fail БЕЗ вызова verifyUserPassword — network-наблюдатель мог по
  // разнице времени (≈100k PBKDF2 vs мгновенно) распознать «есть Telegram-only
  // юзер с таким email». Теперь и здесь прогоняем один DUMMY_PASSWORD_HASH, чтобы
  // все три branch (not-found / password-account / null-hash) имели одинаковую
  // PBKDF2-стоимость.
  if (user.passwordHash === null) {
    await verifyUserPassword(password, DUMMY_PASSWORD_HASH);
    return noteFailure();
  }
  if (!(await verifyUserPassword(password, user.passwordHash))) {
    return noteFailure();
  }

  // Аудит ТЗ №7 #9 — session-токен несёт actual tokenVersion, чтобы «logout everywhere»
  // (инкремент версии) отсекал старые cookie'и в session.ts (сверка с DB).
  const token = await signSessionToken(user.id, user.tokenVersion);
  if (!token) return fail(); // AUTH_COOKIE_SECRET yo'q — fail-closed.

  // Успех — счётчики снимаем, иначе сотрудник, вспомнивший пароль с 9-й попытки,
  // остался бы заблокированным до конца окна.
  await Promise.all([
    clearLoginFailures("email", email),
    ip ? clearLoginFailures("ip", ip) : Promise.resolve(),
  ]);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTS);
  redirect(next);
}

/** Haqiqiy sessiyadan chiqish — `onyx_session` cookie'sini tozalaydi. */
export async function logoutSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
