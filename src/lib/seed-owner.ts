// seed:owner CLI'ning SOF (DB'siz) qismi — arg/env tahlili va validatsiya.
// prisma/seed-owner-cli.ts DB ishini bajaradi va shu funksiyalarni chaqiradi;
// bu yerda alohida unit-testlanadigan, yon ta'sirsiz mantiq.
//
// Parol validatori accounts.ts'dan QAYTA ishlatiladi (MIN_PASSWORD_LENGTH ≥ 8).
import {
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
} from "@/lib/accounts";

export interface RawOwnerArgs {
  email: string | null;
  password: string | null;
  name: string | null;
  force: boolean;
}

/**
 * CLI argv (`--email=`, `--password=`, `--name=`, `--force`) va env
 * (OWNER_EMAIL / OWNER_PASSWORD / OWNER_NAME) dan xom qiymatlarni yig'adi.
 * argv env'dan ustun. Yon ta'sirsiz.
 */
export function parseOwnerArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RawOwnerArgs {
  let email: string | null = null;
  let password: string | null = null;
  let name: string | null = null;
  let force = false;

  for (const arg of argv) {
    if (arg === "--force") force = true;
    else if (arg.startsWith("--email=")) email = arg.slice("--email=".length);
    else if (arg.startsWith("--password="))
      password = arg.slice("--password=".length);
    else if (arg.startsWith("--name=")) name = arg.slice("--name=".length);
  }

  if (email === null && env.OWNER_EMAIL) email = env.OWNER_EMAIL;
  if (password === null && env.OWNER_PASSWORD) password = env.OWNER_PASSWORD;
  if (name === null && env.OWNER_NAME) name = env.OWNER_NAME;

  return { email, password, name, force };
}

export type OwnerArgsResult =
  | { ok: true; email: string; password: string; name: string; force: boolean }
  | { ok: false; error: "usage" | "email" | "password" };

/**
 * Xom argsni tekshiradi/normallashtiradi. Muvaffaqiyatda tozalangan qiymatlar;
 * aks holda birinchi xato kodi:
 *   - "usage"    — email umuman berilmagan (foydalanish yo'riqnomasini chiqar).
 *   - "email"    — email formati yaroqsiz.
 *   - "password" — parol yo'q yoki juda qisqa (< MIN_PASSWORD_LENGTH).
 * Zaif sukut-parol YO'Q: operator kuchli parolni o'zi berishi shart.
 */
export function validateOwnerArgs(raw: RawOwnerArgs): OwnerArgsResult {
  if (!raw.email || raw.email.trim() === "") return { ok: false, error: "usage" };

  const email = normalizeEmail(raw.email);
  if (!isValidEmail(email)) return { ok: false, error: "email" };

  if (!raw.password || !isValidPassword(raw.password)) {
    return { ok: false, error: "password" };
  }

  const name = raw.name && raw.name.trim() !== "" ? raw.name.trim() : "Owner";
  return { ok: true, email, password: raw.password, name, force: raw.force };
}

/** Foydalanish yo'riqnomasi matni (usage/password xatolarida chiqariladi). */
export function usageText(): string {
  return [
    "Usage: npm run seed:owner -- --email=<email> --password=<parol> [--name=<ism>] [--force]",
    "  yoki env orqali: OWNER_EMAIL=<email> OWNER_PASSWORD=<parol> npm run seed:owner",
    `  Parol kamida ${MIN_PASSWORD_LENGTH} belgidan iborat bo'lishi shart (zaif sukut-parol yo'q).`,
    "  --force — mavjud OWNER paroli/holatini yangilaydi (aks holda o'tkazib yuboriladi).",
  ].join("\n");
}
