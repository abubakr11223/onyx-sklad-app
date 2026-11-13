// ТЗ №20 H/I (§9.3) — переключатель ru / uz публичных страниц (карточка /k,
// каталог, подборка). Server action ставит cookie на год и возвращает на ту же
// страницу (back проверяется белым списком в setPublicLocale — без open-redirect).
import { setPublicLocale } from "@/app/k/actions";
import {
  PUBLIC_LOCALES,
  PUBLIC_LOCALE_LABEL,
  type PublicDict,
  type PublicLocale,
} from "@/lib/public-i18n";

export default function LocaleSwitch({
  locale,
  back,
  t,
}: {
  locale: PublicLocale;
  back: string;
  t: Pick<PublicDict, "language">;
}) {
  return (
    <form action={setPublicLocale} className="flex items-center gap-1" aria-label={t.language}>
      <input type="hidden" name="back" value={back} />
      {PUBLIC_LOCALES.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          aria-pressed={l === locale}
          className={
            "min-h-11 rounded-field border px-3 text-sm font-semibold transition " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold " +
            (l === locale
              ? "border-gold bg-honey-soft text-ink"
              : "border-line bg-paper-2 text-ink-2 hover:border-gold")
          }
        >
          {PUBLIC_LOCALE_LABEL[l]}
        </button>
      ))}
    </form>
  );
}
