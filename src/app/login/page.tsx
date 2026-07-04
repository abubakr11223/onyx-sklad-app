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
    </main>
  );
}
