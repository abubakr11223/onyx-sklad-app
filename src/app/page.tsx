import Link from "next/link";

type Section = {
  href: string;
  title: string;
  description: string;
  emoji: string;
  /** Внешняя (статическая) страница — рендерим обычным <a>, не next/link. */
  external?: boolean;
};

const SECTIONS: Section[] = [
  {
    href: "/priemka",
    title: "Приёмка",
    description: "Завести партию за минуту",
    emoji: "📦",
  },
  {
    href: "/poisk",
    title: "Поиск",
    description: "Найти камень по названию и размеру",
    emoji: "🔍",
  },
  {
    href: "/bron",
    title: "Бронь",
    description: "Держать камень под клиента",
    emoji: "🔖",
  },
  {
    href: "/prodazha",
    title: "Продажа",
    description: "Оформить продажу и списание",
    emoji: "💰",
  },
  {
    href: "/razbit",
    title: "Разбить",
    description: "Целый → бой / части",
    emoji: "🪓",
  },
  {
    href: "/fotozapros",
    title: "Фотозапросы",
    description: "Запросы фото складчикам",
    emoji: "📷",
  },
  {
    href: "/karta",
    title: "Карта",
    description: "Готовность проекта",
    emoji: "🗺️",
    external: true,
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          Onyx — складская система
        </h1>
        <p className="mt-2 text-lg text-gray-500">
          Учёт натурального камня: партии, плиты, остатки, брони.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => {
          const cardClass =
            "group block rounded-xl border border-gray-200 p-5 transition hover:border-gray-400 hover:shadow-sm";
          const inner = (
            <>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-xl">
                  {section.emoji}
                </span>
                <h2 className="text-lg font-semibold text-gray-900">
                  {section.title}
                </h2>
              </div>
              <p className="mt-1.5 text-sm text-gray-500">
                {section.description}
              </p>
            </>
          );

          return section.external ? (
            <a key={section.href} href={section.href} className={cardClass}>
              {inner}
            </a>
          ) : (
            <Link key={section.href} href={section.href} className={cardClass}>
              {inner}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
