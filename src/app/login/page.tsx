import { login } from "./actions";
import { buttonClass } from "@/components/ui/Button";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";

// Minimal parol-darvozasi sahifasi. `next` — muvaffaqiyatdan keyingi manzil.
// `?error=1` bo'lsa — xato xabari ko'rsatiladi.
// C-pilot: разметка переведена на бренд-дизайн-систему (Field/Card/Button/Alert).
// Поведение, server-action (login), имена полей (name=) и редиректы НЕ менялись.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const hasError = sp.error === "1";
  const magicError = sp.error === "magic"; // SK-4b: magic-link yaroqsiz/eskirgan.

  // SK-4b: bot username (server yoki public env). Bo'lsa — deep-link tugmasi,
  // bo'lmasa — matnli ko'rsatma (crash yo'q, graceful degrade).
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
          <p className="mt-2 text-base text-ink/70">Введите пароль для доступа</p>
        </header>

        <Card>
          {hasError && (
            <Alert variant="danger" className="mb-4">
              Неверный пароль. Попробуйте снова.
            </Alert>
          )}
          {magicError && (
            <Alert variant="danger" className="mb-4">
              Ссылка для входа недействительна или устарела. Запросите новую в
              Telegram.
            </Alert>
          )}

          <form action={login} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />

            <Field
              id="password"
              name="password"
              type="password"
              label="Пароль"
              placeholder="Пароль"
              autoFocus
              required
              aria-invalid={hasError ? true : undefined}
            />

            <Button type="submit" className="w-full">
              Войти
            </Button>
          </form>

          {/* SK-4b: Telegram magic-link login (parolsiz, o'zi sifatida). */}
          <div className="mt-5 flex flex-col items-center gap-3">
            <div className="flex items-center gap-3 self-stretch text-xs text-ink/50">
              <span className="h-px flex-1 bg-ink/10" />
              или
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
