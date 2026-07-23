import { redirect } from "next/navigation";
import { loginWithPassword } from "./actions";
import { buttonClass } from "@/components/ui/Button";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import { getRealSessionUser } from "@/lib/session";

// Страница входа (R6 — login-gate). Способы: email + пароль (владелец / менеджер /
// партнёр) ИЛИ Telegram magic-link (складчик, без пароля). `next` — куда вернуться
// после входа. Уже вошедшего сразу пропускаем внутрь.
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
  const magicError = sp.error === "magic"; // magic-link yaroqsiz/eskirgan.
  const loginError = sp.error === "login"; // email/parol noto'g'ri (generic).

  // Уже вошёл → внутрь (логин авторизованному не показываем).
  const me = await getRealSessionUser();
  if (me) redirect(next);

  // Bot username (server yoki public env). Bo'lsa — deep-link, aks holda matn.
  const botUsername =
    process.env.TELEGRAM_BOT_USERNAME ??
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ??
    "";
  const tgDeepLink = botUsername
    ? `https://t.me/${botUsername}?start=login`
    : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="font-serif text-display font-bold tracking-tight text-ink">
            Onyx
          </h1>
          <p className="mt-2 text-base text-ink/70">Войдите в систему</p>
        </header>

        <Card>
          {loginError && (
            <Alert variant="danger" className="mb-4">
              Неверный логин или пароль.
            </Alert>
          )}
          {magicError && (
            <Alert variant="danger" className="mb-4">
              Ссылка для входа недействительна или устарела. Запросите новую в
              Telegram.
            </Alert>
          )}

          {/* Вход по логину (email + пароль) — владелец / менеджер / партнёр. */}
          <form action={loginWithPassword} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            <Field
              id="email"
              name="email"
              type="email"
              label="Логин (email)"
              placeholder="you@example.com"
              autoComplete="username"
              required
              aria-invalid={loginError ? true : undefined}
            />
            <Field
              id="login-password"
              name="password"
              type="password"
              label="Пароль"
              placeholder="Пароль"
              autoComplete="current-password"
              required
              aria-invalid={loginError ? true : undefined}
            />
            <Button type="submit" className="w-full">
              Войти
            </Button>
          </form>

          {/* Telegram magic-link — для складчика (без пароля). */}
          <div className="mt-5 flex flex-col items-center gap-3">
            <div className="flex items-center gap-3 self-stretch text-xs text-ink/50">
              <span className="h-px flex-1 bg-ink/10" />
              складчик — через Telegram
              <span className="h-px flex-1 bg-ink/10" />
            </div>
            {tgDeepLink ? (
              <a href={tgDeepLink} className={buttonClass("secondary", "md", "w-full")}>
                Войти через Telegram
              </a>
            ) : (
              <p className="text-center text-sm text-ink/70">
                Откройте бота и отправьте /login
              </p>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
