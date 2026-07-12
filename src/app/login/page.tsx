import { login } from "./actions";

// Minimal parol-darvozasi sahifasi. `next` — muvaffaqiyatdan keyingi manzil.
// `?error=1` bo'lsa — xato xabari ko'rsatiladi.
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Onyx</h1>
      <p className="text-sm text-gray-500">Введите пароль для доступа</p>

      <form
        action={login}
        className="flex w-full max-w-xs flex-col gap-3"
      >
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Пароль"
          className="h-12 rounded-xl border border-gray-300 px-4 text-lg outline-none focus:border-gray-900"
        />
        {hasError && (
          <p className="text-sm text-red-600">Неверный пароль. Попробуйте снова.</p>
        )}
        <button
          type="submit"
          className="flex h-12 items-center justify-center rounded-xl bg-gray-900 px-6 text-lg font-medium text-white hover:bg-gray-700"
        >
          Войти
        </button>
      </form>

      {magicError && (
        <p className="max-w-xs text-center text-sm text-red-600">
          Ссылка для входа недействительна или устарела. Запросите новую в Telegram.
        </p>
      )}

      {/* SK-4b: Telegram magic-link login (parolsiz, o'zi sifatida). */}
      <div className="flex w-full max-w-xs flex-col items-center gap-2">
        <div className="flex items-center gap-3 self-stretch text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          или
          <span className="h-px flex-1 bg-gray-200" />
        </div>
        {tgDeepLink ? (
          <a
            href={tgDeepLink}
            className="flex h-12 w-full items-center justify-center rounded-xl border border-gray-300 px-6 text-lg font-medium text-gray-900 hover:bg-gray-50"
          >
            Войти через Telegram
          </a>
        ) : (
          <p className="max-w-xs text-center text-sm text-gray-500">
            Откройте бота и отправьте /login
          </p>
        )}
      </div>
    </main>
  );
}
