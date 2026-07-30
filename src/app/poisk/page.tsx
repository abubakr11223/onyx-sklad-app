// S1-E — «Поиск камня» (TZ §5.2, §6.5). Server component: GET-forma, klient JS yo'q.
// BATCH-B (perf): butun ombor xotiraga tortilmaydi —
//   • partiya erkin qoldig'i SQL agregatlaridan hisoblanadi (batch-remainders.ts);
//   • gabarit-qidiruv AVAILABLE boy indeksi bo'yicha SQL'da filtrlanadi (JS emas);
//   • vidlar ro'yxati PAGE_SIZE + `?after=<name>` kursor bilan chegaralanadi.
// «В наличии» sonlari o'zgarmaydi — formula (inventory.ts §3) aynan o'sha, faqat
// kirishlari row-fetch o'rniga agregat (par.: src/tests/batch-remainders.test.ts).
//
// W2-A: vidlar sahifasining BUTUN olinishi (so'rov + agregatlar + «наличие»
// filtri + kursor) src/lib/poisk-query.ts ga ko'chirildi — sabab pastda,
// fetchPoiskTypesPage chaqirig'i ustidagi izohda.
//
// CHEGARALAR (halol ro'yxat — yuqoridagi «xotiraga tortilmaydi» MUTLAQ emas):
//   • sahifadagi har bir vid uchun `batches` select'ida `where` ham, `take` ham
//     YO'Q — ya'ni butun sahifa vidlarining BARCHA partiya qatorlari o'qiladi,
//     har biriga korrelyatsiyalangan `_count.patterns` bilan. Ko'p partiyali
//     vidda bu chegarasiz o'sadi; to'g'ri yechim — alohida agregat (hali
//     qilinmagan).
//   • naliche filtri JS'da qolgani uchun bo'sh so'rovda modul sahifa to'lguncha
//     bo'laklab o'qiydi: odatdagi holatda AYNAN bitta so'rov (bugungidek), lekin
//     ko'p vid «нет в наличии» bo'lsa POISK_MAX_SCAN_ROWS (1000) xom qatorgacha.
//     Chegara urilsa natija to'liq emas va bu foydalanuvchiga aytiladi.
//   • boy/qoldiq ro'yxati MAX_POISK_PIECES bilan SQL'da cap qilinadi va cap
//     ba'zi mos qoldiqni ko'rsatmasdan tushirib qoldirishi MUMKIN — sabab va
//     foydalanuvchiga ogohlantirish pastda (fittingPieces izohi).
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { CUTTING_MARGIN_MM } from "@/lib/inventory";
import { piecesWhere } from "@/lib/poisk-search";
import { fetchPoiskTypesPage } from "@/lib/poisk-query";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { SearchIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Поиск камня — Onyx",
};

// Qidiruv har doim joriy DB holatini ko'rsatishi kerak.
export const dynamic = "force-dynamic";

/** Bitta sahifada ko'rsatiladigan vidlar soni (qolgani «Показать ещё» orqali). */
const PAGE_SIZE = 30;
/** Аудит ТЗ №7 #31 — cap на in-memory сортировку gabarit-подходящих offcut'ов.
 *  Ordering по areaM2 asc в БД, окончательная сортировка по L*W в JS. */
const MAX_POISK_PIECES = 500;
/** Boy/qoldiq blokida BIR marta ko'rsatiladigan qator soni («Показать ещё» qadami).
 *  Vidlar (30) dan kichik: qoldiq kartochkasi 3 qatorli va bu blok «предложить
 *  первыми» — menejerga avval eng kichik bir nechtasi kerak, butun dumi emas. */
const PIECES_PAGE_SIZE = 20;

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

const PIECE_KIND_RU: Record<string, string> = {
  BROKEN: "бой",
  OFFCUT: "остаток",
};

type ParamValue = string | string[] | undefined;

function firstParam(v: ParamValue): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Bitta gabarit maydonining tahlili — foydalanuvchiga qaytarish uchun `raw` ham. */
type DimInput = {
  /** Foydalanuvchi kiritgani (trim qilingan). */
  raw: string;
  /** Qidiruvda ISHLATILGAN qiymat; null → yaroqsiz yoki bo'sh. */
  mm: number | null;
  /** `raw` sonli, lekin aynan `mm` emas: «120.5»→120, «12abc»→12, «012»→12. */
  coerced: boolean;
};

/** parseInt semantikasi ATAYIN saqlangan (xatti-harakat o'zgarmaydi) — yangisi
 *  faqat shu: nima bo'lganini chaqiruvchiga aytadi, jimgina yutmaydi. */
function parseDim(v: ParamValue): DimInput {
  const raw = firstParam(v);
  if (!raw) return { raw, mm: null, coerced: false };
  const n = Number.parseInt(raw, 10);
  const mm = Number.isFinite(n) && n > 0 ? n : null;
  return { raw, mm, coerced: mm !== null && String(mm) !== raw };
}

/** «Показать ещё» bilan ochilgan qoldiqlar soni (`?pn=`). Chegara — SQL cap. */
function parseShownPieces(v: ParamValue): number {
  const n = Number.parseInt(firstParam(v), 10);
  if (!Number.isFinite(n) || n <= 0) return PIECES_PAGE_SIZE;
  return Math.min(n, MAX_POISK_PIECES);
}

/** q/l/w + IKKALA «Показать ещё» holatini saqlab havola quradi.
 *  `after` — vidlar keyset kursori, `pn` — ochilgan qoldiqlar soni. Ikkalasi bir
 *  havolada ham yuriladi: bloklar mustaqil, biri ikkinchisini nolga qaytarmasin. */
function buildHref(base: {
  q: string;
  l: number | null;
  w: number | null;
  after?: string | null;
  pn?: number | null;
  hash?: string;
}): string {
  const sp = new URLSearchParams();
  if (base.q) sp.set("q", base.q);
  if (base.l !== null) sp.set("l", String(base.l));
  if (base.w !== null) sp.set("w", String(base.w));
  if (base.after) sp.set("after", base.after);
  if (base.pn) sp.set("pn", String(base.pn));
  return "/poisk?" + sp.toString() + (base.hash ?? "");
}

export default async function PoiskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, ParamValue>>;
}) {
  const params = await searchParams;
  const q = firstParam(params.q);
  const lenDim = parseDim(params.l);
  const widDim = parseDim(params.w);
  const lenMm = lenDim.mm;
  const widMm = widDim.mm;
  const hasDims = lenMm !== null && widMm !== null;
  const after = firstParam(params.after);
  const shownPieces = parseShownPieces(params.pn);

  // Kiritilgan, lekin ishlatib bo'lmagan o'lcham JIMGINA yutilmasin: ilgari
  // faqat `l` (yoki «abc», «0») kiritilsa butun boy/qoldiq bloki hech qanday
  // izohsiz yo'qolardi — foydalanuvchi buni «omborda yo'q» deb o'qiydi.
  const dimNotes: string[] = [];
  for (const [label, d] of [
    ["Длина", lenDim],
    ["Ширина", widDim],
  ] as const) {
    if (d.raw && d.mm === null) {
      dimNotes.push(
        `${label}: «${d.raw}» — так размер не задают. Нужно целое число миллиметров, больше нуля.`,
      );
    } else if (d.coerced) {
      dimNotes.push(
        `${label}: «${d.raw}» принято как ${d.mm} мм (дробная часть и лишние символы не учитываются).`,
      );
    }
  }
  if (!hasDims && (lenMm !== null || widMm !== null)) {
    dimNotes.push(
      "Нужны обе стороны: подбор боя и остатков включается, только когда заданы и длина, и ширина.",
    );
  }
  // TG-B1: fotozapros natijasi — redirect'dan qaytgan ?photo=ok/?photoErr
  // bayroqlarini FlashToaster (layout) toast qilib ko'rsatadi va URL'dan tozalaydi.

  // ── Vidlar: chegaralangan sahifa. W2-A — sahifalash, agregatlar va «наличие»
  // filtri endi BITTA joyda: fetchPoiskTypesPage (src/lib/poisk-query.ts).
  //
  // NEGA ko'chirildi (bu sahifadagi XATOning o'zi): ilgari SQL `take: PAGE_SIZE + 1`
  // filtrdan OLDIN ishlardi, «наличие» filtri esa (`types.filter(hasAvailability)`)
  // keyin — JS'da. Natijada bo'sh so'rov + o'lchamsiz holatda 30 ta o'rniga bir
  // nechta (yoki nol) qator chiqar, «Показать ещё» esa baribir turardi —
  // «Ничего не найдено.» + «Показать ещё» yolg'on juftligi. Modul sahifa
  // TO'LGUNCHA o'qiydi (qattiq chegara: POISK_MAX_SCAN_ROWS xom qator), kursorni
  // esa o'qilgan OXIRGI xom qatorda qoldiradi — shuning uchun qator na tushib
  // qoladi, na takrorlanadi.
  //
  // Modul invarianti: `nextCursor !== null` ⟺ «yana bor». Bu yerda «Показать ещё»
  // aynan `nextCursor`ga qarab chiziladi (pastda), demak havola hech qachon
  // «o'lik» bo'lmaydi. `q` yoki gabarit berilganda filtr QO'LLANMAYDI — xatti-
  // harakat bugungidek qoladi.
  const typesPage = await fetchPoiskTypesPage(db, {
    q,
    hasDims,
    after,
    pageSize: PAGE_SIZE,
  });
  const visibleTypes = typesPage.types;
  const nextCursor = typesPage.nextCursor;
  // Skan chegarasi sahifa to'lmasdan tugadi VA kursordan keyin hali xom qatorlar
  // bor → ro'yxat TO'LIQ EMAS, buni foydalanuvchi bilishi shart (jimgina
  // yutilmaydi). Muhim nuance: `truncated && nextCursor === null` — bu aslida
  // TO'LIQ natija (skan jadval oxiriga aynan chegarada yetgan, keyin hech narsa
  // qolmagan), shuning uchun u ogohlantirish EMAS, oddiy «Ничего не найдено.».
  const typesIncomplete = typesPage.truncated && nextCursor !== null;

  // TZ §5.2 / §6.5: gabarit berilganda AVVAL boy va qoldiqlar. Old kod BARCHA mos
  // boy'ni tortib bounding-maydon (bL*bW) o'sish tartibida saralagan — eng kichik
  // maydonli qoldiq BIRINCHI («продать остатки первыми»). Endi filtr indeks bo'yicha
  // SQL'da (status, boundingLengthMm, boundingWidthMm) — pieceFitsRequest mantig'i
  // (dopusk + 90° burish) ekvivalent OR-shart bilan:
  //   max(L,W) ≥ needMax ∧ min(L,W) ≥ needMin
  //     ⇔ (L≥needMax ∧ W≥needMin) ∨ (L≥needMin ∧ W≥needMax).
  // Yengil proyeksiya olinadi (int/decimal ustunlar — eski to'liq-include
  // butun-ombor fetchidan ancha arzon), keyin JS'da bL*bW o'sish bo'yicha
  // saralanadi. isArchived=false — arxiv vid boyi chiqmasin.
  //
  // OGOHLANTIRISH (612ce93 dan beri shunday, eski izoh buni inkor etardi):
  // DB'da CAP BOR — `take: MAX_POISK_PIECES + 1` (probe: cap urilganini bilish
  // uchun). Cap `areaM2 asc` bo'yicha, ekranda esa tartib bL*bW (bounding-
  // maydon) bo'yicha — BU IKKI XIL KALIT, shuning uchun cap ko'rsatilishi kerak
  // bo'lgan qoldiqni tushirib qoldirishi MUMKIN:
  //   • areaM2 — haqiqiy yuza, bL*bW — gabarit to'rtburchak; noto'g'ri shakl
  //     uchun areaM2 ≤ bL*bW, ya'ni kichik areaM2 kichik gabaritni ANGLATMAYDI.
  //     500 ta «ingichka, katta gabaritli» qoldiq oldinga chiqib, gabariti eng
  //     kichik mosni cap ortida qoldirishi mumkin;
  //   • `areaM2` NULL bo'lishi mumkin (schema: Decimal?), Postgres'da ASC →
  //     NULLS LAST, demak yuzasi noma'lum qoldiqlar cap'ning BIRINCHI qurboni —
  //     gabariti qanchalik kichik bo'lishidan qat'i nazar.
  // To'g'ri yechim — bounding-maydon bo'yicha indeks/generated ustun va shu
  // ustunda keyset (bu yerda emas: prisma/ o'zgarishi kerak). Shu paytgacha cap
  // urilgani foydalanuvchidan YASHIRILMAYDI — pastda ogohlantirish ko'rsatiladi.
  // Cap signal: `length > MAX` (take+1 probe); aynan MAX bo'lsa — hammasi
  // chiqdi, «часть не попала» yolg'on bo'lmasin.
  const needMax = hasDims ? Math.max(lenMm, widMm) + CUTTING_MARGIN_MM : 0;
  const needMin = hasDims ? Math.min(lenMm, widMm) + CUTTING_MARGIN_MM : 0;
  const fittingPiecesRaw = hasDims
    ? await db.piece.findMany({
        // §5.2/§6.5: gabarit + MATERIAL filtri. `q` bo'sh bo'lsa material filtri
        // qo'llanmaydi (barcha mos qoldiq); `q` bo'lsa — piece.stoneType relatsiyasi
        // orqali name/rockType/color mos kelgan vid qoldiqlarigina (butun plita
        // ro'yxati bilan AYNI filtr → boshqa vid boyi «предложить первыми»da chiqmaydi).
        where: piecesWhere(q, needMax, needMin),
        select: {
          id: true,
          kind: true,
          needsCheck: true,
          boundingLengthMm: true,
          boundingWidthMm: true,
          thicknessMm: true,
          areaM2: true,
          block: true,
          landmark: true,
          stoneType: { select: { name: true } },
        },
        // Аудит ТЗ №7 #31 — раньше take не было: результат ограничен лишь тем,
        // сколько offcut'ов вообще проходят gabarit-фильтр. При росте склада это
        // могло вырасти в тысячи строк, материализуемых и сортируемых per-request
        // на force-dynamic странице. Ставим safety-cap: ORDER BY areaM2 ASC
        // (мельче — предпочтительнее по TZ §6.5 «предлагать первыми»), take
        // MAX_POISK_PIECES + 1 (probe). Индекса на bounding-area нет (см.
        // комментарий выше), поэтому пред-cap-ранкинг делается по колонке
        // areaM2, а окончательная сортировка по L*W — в JS на усечённом
        // множестве (сначала trim до MAX, потом sort — tartib avvalgidek).
        orderBy: { areaM2: "asc" },
        take: MAX_POISK_PIECES + 1,
      })
    : [];
  // Cap: faqat probe qator kelganda (501+). Aynan 500 → hammasi ro'yxatda.
  // Trim sort DAN OLDIN: areaM2 prefiksi eski `take: MAX` bilan bir xil qoladi.
  const piecesCapped = fittingPiecesRaw.length > MAX_POISK_PIECES;
  const fittingPieces = piecesCapped
    ? fittingPiecesRaw.slice(0, MAX_POISK_PIECES)
    : fittingPiecesRaw;
  // «Предложить первыми» — eng kichik bounding-maydon oldinda. TARTIB: bu saralash
  // faqat CAP'DAN O'TGAN to'plamni tartiblaydi (yuqoridagi ogohlantirishga qarang) —
  // «eng kichik mos hech qachon tushmaydi» degan KAFOLAT YO'Q.
  // `id` — teng-maydonli qoldiqlar uchun tie-breaker: usiz Postgres teng `areaM2`
  // qatorlarini ixtiyoriy tartibda qaytaradi va ro'yxat har so'rovda qayta
  // aralashadi. `id` bilan tartib TO'LIQ va takrorlanadigan bo'ladi — «Показать
  // ещё» (prefiks kengaytirish) shunga tayanadi.
  fittingPieces.sort(
    (a, b) =>
      a.boundingLengthMm * a.boundingWidthMm -
        b.boundingLengthMm * b.boundingWidthMm ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // «Показать ещё» = ko'rsatilayotgan PREFIKSNI uzaytirish (offset-sahifa emas):
  // foydalanuvchi doim joriy tartibning [0, N) boshini ko'radi, shuning uchun
  // qator na tushib qoladi, na takrorlanadi — hatto ro'yxat so'rovlar orasida
  // o'zgarsa ham. Keyset kursor bu yerda IMKONSIZ: tartib kaliti bL*bW — DB'da
  // bunday ustun ham, indeks ham yo'q (yuqoridagi izoh).
  const visiblePieces = fittingPieces.slice(0, shownPieces);
  const hasMorePieces = fittingPieces.length > visiblePieces.length;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Поиск камня
        </h1>
      </header>

      <Card>
        <form method="get" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-sm font-semibold text-ink">
              Название / порода / цвет
            </label>
            <input
              id="q"
              name="q"
              type="search"
              inputMode="search"
              defaultValue={q}
              placeholder="травертин, мрамор, бежевый…"
              className={inputClass}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Нужный размер (мм)
            </legend>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                name="l"
                type="text"
                inputMode="numeric"
                // Yaroqli bo'lsa — qidiruvda ISHLATILGAN son (maydon o'zini
                // tuzatadi), yaroqsiz bo'lsa — kiritilgani (tuzatib bo'lsin).
                defaultValue={lenDim.mm ?? lenDim.raw}
                placeholder="Длина"
                className={inputClass}
              />
              <span className="text-ink/50">×</span>
              <input
                name="w"
                type="text"
                inputMode="numeric"
                defaultValue={widDim.mm ?? widDim.raw}
                placeholder="Ширина"
                className={inputClass}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink/60">
              Подбор с запасом на рез {CUTTING_MARGIN_MM} мм; поворот заготовки
              учитывается.
            </p>
          </fieldset>

          <Button type="submit" className="w-full sm:w-auto sm:self-start">
            <SearchIcon className="h-5 w-5" />
            Найти
          </Button>
        </form>
      </Card>

      {/* O'lcham kiritilgan-u, ishlatib bo'lmagan bo'lsa — jimgina yutmaymiz.
          hasDims bo'lsa blok ishladi (faqat aniqlashtirish) → info; bo'lmasa
          butun boy/qoldiq bloki chiqmadi → warning. */}
      {dimNotes.length > 0 && (
        <Alert
          variant={hasDims ? "info" : "warning"}
          title={hasDims ? "Размеры уточнены" : "Подбор по размеру не выполнен"}
          className="mt-6"
        >
          {dimNotes.length === 1 ? (
            <p className="text-sm">{dimNotes[0]}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {dimNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {hasDims && (
        <section
          id="ostatki"
          className="mt-6 scroll-mt-4 rounded-card border border-warning/40 bg-warning/10 p-4"
        >
          <h2 className="text-lg font-bold text-ink">
            Бой и остатки — предложить первыми
          </h2>
          <p className="text-sm text-ink/70">
            Под размер {lenMm}×{widMm} мм (с запасом на рез)
            {fittingPieces.length > 0 && (
              <>
                {" "}
                · показано {visiblePieces.length} из {fittingPieces.length}
                {piecesCapped && "+"}
              </>
            )}
          </p>
          {fittingPieces.length === 0 ? (
            <p className="mt-3 text-sm text-ink/70">
              Подходящих остатков и боя нет — ниже целые плиты и партии.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {visiblePieces.map((p) => (
                <li
                  key={p.id}
                  className="rounded-card border border-ink/10 bg-paper p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
                    <span>{p.stoneType.name}</span>
                    <Badge variant="neutral">
                      {PIECE_KIND_RU[p.kind] ?? p.kind}
                    </Badge>
                    {p.needsCheck && (
                      <Badge variant="warning">требует проверки</Badge>
                    )}
                  </div>
                  <div className="text-sm text-ink/70">
                    Габарит {p.boundingLengthMm}×{p.boundingWidthMm} мм
                    {p.thicknessMm !== null && <> · толщина {p.thicknessMm} мм</>}
                    {p.areaM2 !== null && (
                      <> · ≈{m2Fmt.format(Number(p.areaM2))} м²</>
                    )}
                  </div>
                  <div className="text-sm text-ink">
                    Блок {p.block}, ориентир {p.landmark}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {hasMorePieces && (
            <div className="mt-3">
              <Link
                href={buildHref({
                  q,
                  l: lenMm,
                  w: widMm,
                  after,
                  pn: visiblePieces.length + PIECES_PAGE_SIZE,
                  hash: "#ostatki",
                })}
                className={buttonClass("secondary", "sm")}
              >
                Показать ещё бой и остатки →
              </Link>
            </div>
          )}

          {piecesCapped && (
            <p className="mt-3 text-sm font-medium text-warning">
              Показаны первые {MAX_POISK_PIECES} подходящих — это предел выдачи,
              часть остатков в список не попала. Уточните размер или материал.
            </p>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-bold text-ink">
          {hasDims ? "Целые плиты и партии" : "В наличии"}
        </h2>
        {/* «Ничего не найдено.» va «Показать ещё» BIRGA chiqishi — aynan shu
            xatoning ko'rinadigan alomati edi. Endi bo'sh natijadagi xabar
            `nextCursor`ning YO'Qligiga bog'langan, «Показать ещё» esa (pastda)
            uning BORligiga — ikkovi bir-birini SINTAKTIK istisno qiladi, ya'ni
            juftlik modul nima qaytarishidan qat'i nazar imkonsiz.
            Kursor bor-u ro'yxat bo'sh (skan chegarasi urilgan holat) → «hech
            narsa yo'q» emas, «davom etadi» deb aytiladi. */}
        {visibleTypes.length === 0 ? (
          nextCursor ? (
            <Alert
              variant="warning"
              title="Поиск продолжается"
              className="mt-3"
            >
              <p className="text-sm">
                Просмотрено подряд {typesPage.scannedRows} видов — все они не в
                наличии. Это не весь склад: нажмите «Показать ещё», чтобы идти
                дальше, или уточните название, породу или цвет.
              </p>
            </Alert>
          ) : (
            <p className="mt-3 text-ink/70">Ничего не найдено.</p>
          )
        ) : (
          <ul className="mt-3 space-y-2.5">
            {visibleTypes.map((t) => {
              // BUG-03: bron bo'lsa — всего/свободно/бронь ajratib ko'rsatiladi;
              // bronsiz — oldingidek bitta son (свободно = всего).
              const totalParts: string[] = [];
              if (t.slabsKnown)
                totalParts.push(
                  t.reservedSlabsSum > 0
                    ? `плит: всего ~${t.slabsTotalSum}${t.slabsUnknown ? "+" : ""}, свободно ${t.slabsFreeSum}, в брони ${t.reservedSlabsSum}`
                    : `плит ~${t.slabsFreeSum}${t.slabsUnknown ? "+" : ""}`,
                );
              if (t.areaKnown)
                totalParts.push(
                  t.reservedAreaSum > 0
                    ? `≈${m2Fmt.format(t.areaTotalSum)} м² всего${t.areaUnknown ? "+" : ""}, свободно ${m2Fmt.format(t.areaFreeSum)}, в брони ${m2Fmt.format(t.reservedAreaSum)}`
                    : `≈${m2Fmt.format(t.areaFreeSum)} м²${t.areaUnknown ? "+" : ""}`,
                );
              // Монограмма по породе (мрамор→М, гранит→Г…) — визуальный якорь
              // без выдуманного цвета (в БД нет hex). Fallback — первая буква вида.
              const monogram = (t.st.rockType || t.st.name)
                .trim()
                .charAt(0)
                .toUpperCase();
              return (
                <li key={t.st.id}>
                  {/* Вся карточка — ссылка на /kamen/[id] (крупная зона касания,
                      hover-lift). Внутри нет других интерактивных элементов. */}
                  <Link
                    href={"/kamen/" + t.st.id}
                    className="group flex items-start gap-3.5 rounded-card border border-line bg-paper-2 p-4 shadow-card transition hover:-translate-y-0.5 hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:gap-4"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/12 font-serif text-lg font-bold text-gold-deep sm:h-12 sm:w-12"
                    >
                      {monogram}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <h3 className="font-bold text-ink transition group-hover:text-gold-deep">
                          {t.st.name}
                        </h3>
                        <span className="text-sm text-ink/55">
                          {t.st.rockType}
                          {t.st.color && <> · {t.st.color}</>}
                        </span>
                      </div>
                      <p className="tnum mt-1.5 text-sm text-ink/70">
                        {t.hasAvailability
                          ? totalParts.length > 0
                            ? totalParts.join(" · ")
                            : "данных по объёму нет"
                          : "Нет в наличии"}
                        {t.hasAvailability && t.countedSlabs > 0 && (
                          <> · отдельных плит: {t.countedSlabs}</>
                        )}
                        {t.hasAvailability && t.countedPieces > 0 && (
                          <> · боя и остатков: {t.countedPieces}</>
                        )}
                        {t.patternsCount > 0 && (
                          <> · узоров: {t.patternsCount}</>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 self-center">
                      <Badge variant={t.hasAvailability ? "success" : "neutral"}>
                        {t.hasAvailability ? "В наличии" : "Нет"}
                      </Badge>
                      <svg
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="hidden text-ink/25 transition group-hover:translate-x-0.5 group-hover:text-gold-deep sm:block"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {/* Sahifa TO'LMAGAN, chunki skan chegarasiga yetdi (fittingPieces cap
            ogohlantirishi bilan bir uslubda). Bo'sh natijada bu xabar
            takrorlanmaydi — u yerda yuqoridagi Alert allaqachon aytadi. */}
        {typesIncomplete && visibleTypes.length > 0 && (
          <p className="mt-3 text-sm font-medium text-warning">
            Просмотрено {typesPage.scannedRows} видов — это предел одного шага
            поиска, показаны не все подходящие. Продолжите по «Показать ещё» или
            уточните название, породу или цвет.
          </p>
        )}

        {nextCursor && (
          <div className="mt-4">
            <Link
              href={buildHref({
                q,
                l: lenMm,
                w: widMm,
                after: nextCursor,
                // Vidlar sahifasi almashsa ham qoldiqlar bloki yopilib qolmasin.
                pn: shownPieces,
              })}
              className={buttonClass("secondary", "sm")}
            >
              Показать ещё →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
