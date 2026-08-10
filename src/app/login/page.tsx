// TZ №8 v2 — server component: auth check + env + tg deep-link. Vizual butun
// LoginPageClient'da (dark tema, motion, keyinchalik 3D). Behavior avvalgidek.
import { redirect } from "next/navigation";
import { getRealSessionUser } from "@/lib/session";
import { LoginPageClient } from "./LoginPageClient";

function safeNext(raw: string): string {
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "/");
  const magicError = sp.error === "magic";
  const loginError = sp.error === "login";
  // Аудит 2026-08-10 — отдельная причина: пароль может быть ВЕРНЫМ, дело в
  // числе попыток. Без своего текста сотрудник начнёт менять рабочий пароль.
  const throttledError = sp.error === "throttled";

  const me = await getRealSessionUser();
  if (me) redirect(next);

  const botUsername =
    process.env.TELEGRAM_BOT_USERNAME ??
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ??
    "";
  const tgDeepLink = botUsername
    ? `https://t.me/${botUsername}?start=login`
    : null;

  return (
    <LoginPageClient
      next={next}
      loginError={loginError}
      throttledError={throttledError}
      magicError={magicError}
      tgDeepLink={tgDeepLink}
    />
  );
}
