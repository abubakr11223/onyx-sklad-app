// R2 — «Нет доступа» (server-компонент). Страница закрыта текущей роли.
// Вместо тупика с одной ссылкой — перечисляем разделы, которые роли ДОСТУПНЫ
// (тот же canAccessNav), чтобы это была подсказка-редирект, а не глухой угол.
// Caps читаются здесь же (getCapabilities) — вызывающие рендерят <NoAccess/>
// без пропов, контракт не меняется.

import Link from "next/link";
import { getCapabilities } from "@/lib/session";
import { visibleNavItems } from "@/components/nav-items";

export default async function NoAccess() {
  const caps = await getCapabilities();
  const sections = visibleNavItems(caps);

  return (
    <div className="rounded-card border border-ink/10 bg-paper-2/60 p-6 text-center">
      <h1 className="font-serif text-2xl font-bold text-ink">Нет доступа</h1>
      <p className="mt-2 text-base text-ink/70">
        Эта страница доступна другой роли. Вам доступны разделы:
      </p>

      <ul className="mx-auto mt-5 flex max-w-md flex-col gap-2">
        {sections.map((section) => {
          const cls =
            "flex min-h-11 items-center gap-2.5 rounded-field border border-ink/15 bg-paper px-4 text-left text-ink transition hover:border-gold hover:text-gold-deep";
          const body = (
            <>
              <section.Icon
                width={20}
                height={20}
                className="shrink-0 text-gold-deep"
              />
              <span className="font-semibold">{section.label}</span>
              <span className="ml-auto text-sm text-ink/55">
                {section.description}
              </span>
            </>
          );
          return (
            <li key={section.href}>
              {section.external ? (
                <a href={section.href} className={cls}>
                  {body}
                </a>
              ) : (
                <Link href={section.href} className={cls}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
