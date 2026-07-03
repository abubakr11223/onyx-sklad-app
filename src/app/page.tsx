import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold tracking-tight">
        Onyx — складская система
      </h1>
      <p className="text-lg text-gray-500">
        Учёт натурального камня: партии, плиты, остатки, брони.
      </p>
      <nav className="mt-4 flex w-full max-w-md flex-col gap-3 sm:flex-row">
        <Link
          href="/poisk"
          className="flex h-14 flex-1 items-center justify-center rounded-xl bg-gray-900 px-6 text-lg font-medium text-white hover:bg-gray-700"
        >
          Поиск камня
        </Link>
        <Link
          href="/priemka"
          className="flex h-14 flex-1 items-center justify-center rounded-xl border border-gray-300 px-6 text-lg font-medium hover:bg-gray-50"
        >
          Приёмка партии
        </Link>
      </nav>
    </main>
  );
}
