// §5.5b — «Бой по фото» (TZ §5.5): server component. Bot yuborgan havoladagi
// `d` draft'ini (AI polygon + Telegram file_id) QATTIQ dekodlaydi, chertyojni
// raqamlangan tomonlar bilan ko'rsatadi va skladchidan har tomonning REAL
// o'lchamini so'raydi. Saqlash — ./actions.submitSingan (registerDirectPiece).
// Web-UI tili — RUSCHA (faqat bot o'zbekcha).

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import { decodeShapeDraft } from "@/lib/singan";
import { renderChertyoj } from "@/lib/chertyoj";
import { submitSingan } from "./actions";

export const metadata: Metadata = {
  title: "Бой по фото — Onyx",
};

// Partiya ro'yxati joriy DB holatini aks ettirsin.
export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" });
const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export default async function SinganPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // R2 — rol gate: бой записывает склад (canManageWarehouse: OWNER/WAREHOUSE).
  const caps = await getCapabilities();
  if (!caps.canManageWarehouse) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const ok = first(sp.ok) === "1";
  const stoneId = first(sp.stone);
  const err = first(sp.err);

  // ── Muvaffaqiyat holati: forma o'rniga yakuniy panel ──
  if (ok) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <h1 className="mb-4 text-3xl font-bold tracking-tight">Бой по фото</h1>
        <div
          role="status"
          className="rounded-2xl border border-green-300 bg-green-50 p-4 text-base text-green-900"
        >
          <p className="font-semibold">Кусок записан ✓</p>
          <p className="mt-1">Чертёж и фото сохранены в карточке камня.</p>
          {stoneId && (
            <Link
              href={`/kamen/${stoneId}`}
              className="mt-3 inline-flex rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
            >
              Открыть карточку камня
            </Link>
          )}
        </div>
      </main>
    );
  }

  // ── Draft: foydalanuvchi nazoratidagi URL ma'lumoti — QATTIQ dekodlash ──
  const draft = decodeShapeDraft(first(sp.d));
  if (!draft) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <h1 className="mb-4 text-3xl font-bold tracking-tight">Бой по фото</h1>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
          <p className="font-semibold">Ссылка не открылась</p>
          <p className="mt-1">
            Ссылка повреждена или устарела. Отправьте фото со словом «singan» в
            бот ещё раз — или введите бой вручную.
          </p>
          <Link
            href="/razbit"
            className="mt-3 inline-flex rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            Ввести вручную (/razbit)
          </Link>
        </div>
      </main>
    );
  }

  // AI-chertyoj: tomonlar 1..N raqamlangan. SVG'ni BIZ validatsiyadan o'tgan
  // polygon'dan renderChertyoj bilan yasadik (yozuvlar escapeXml qilinadi) —
  // shuning uchun dangerouslySetInnerHTML bu yerda xavfsiz.
  const svg = renderChertyoj(draft.vertices);
  const sideNumbers = draft.vertices.map((_, i) => i + 1);

  const batchRows = await db.batch.findMany({
    orderBy: [{ stoneType: { name: "asc" } }, { arrivedAt: "desc" }],
    select: {
      id: true,
      arrivedAt: true,
      slabsTotal: true,
      areaTotalM2: true,
      stoneType: { select: { name: true } },
    },
  });

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Бой по фото</h1>
      <p className="mb-5 text-base text-gray-500">
        AI распознал форму куска. Измерьте каждую сторону рулеткой и введите
        размеры в мм — номера сторон совпадают с чертежом.
      </p>

      {err && (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-base text-red-900"
        >
          {err}
        </div>
      )}

      <div className="mb-5 flex justify-center rounded-2xl border border-gray-200 bg-white p-4">
        {/* SVG — bizning renderChertyoj mahsuloti (validatsiya + ekranlash). */}
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      <form action={submitSingan} className="space-y-5">
        <input type="hidden" name="d" value={first(sp.d) ?? ""} />

        <fieldset className="rounded-2xl border border-gray-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-gray-700">
            Стороны, мм ({draft.vertices.length})
          </legend>
          <div className="grid grid-cols-2 gap-3">
            {sideNumbers.map((n) => (
              <div key={n}>
                <label className={labelCls} htmlFor={`side_${n}`}>
                  Сторона {n}
                </label>
                <input
                  id={`side_${n}`}
                  name={`side_${n}`}
                  inputMode="numeric"
                  placeholder="напр. 1180"
                  required
                  className={inputCls}
                />
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-2xl border border-gray-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-gray-700">
            Габариты и площадь
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="boundingLengthMm">
                Длина, мм
              </label>
              <input
                id="boundingLengthMm"
                name="boundingLengthMm"
                inputMode="numeric"
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="boundingWidthMm">
                Ширина, мм
              </label>
              <input
                id="boundingWidthMm"
                name="boundingWidthMm"
                inputMode="numeric"
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="thicknessMm">
                Толщина, мм
              </label>
              <input
                id="thicknessMm"
                name="thicknessMm"
                inputMode="numeric"
                placeholder="необязательно"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="areaM2">
                Площадь, м²
              </label>
              <input
                id="areaM2"
                name="areaM2"
                inputMode="decimal"
                placeholder="необязательно"
                className={inputCls}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-2xl border border-gray-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-gray-700">
            Партия и место
          </legend>
          <div className="space-y-3">
            <div>
              <label className={labelCls} htmlFor="kind">
                Тип
              </label>
              <select id="kind" name="kind" defaultValue="BROKEN" className={inputCls}>
                <option value="BROKEN">Бой</option>
                <option value="OFFCUT">Остаток</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="batchId">
                Партия (камень)
              </label>
              <select id="batchId" name="batchId" required className={inputCls}>
                <option value="">— выберите партию —</option>
                {batchRows.map((b) => {
                  const qty = [
                    b.slabsTotal !== null && `${b.slabsTotal} плит`,
                    b.areaTotalM2 !== null &&
                      `${m2Fmt.format(Number(b.areaTotalM2))} м²`,
                  ]
                    .filter(Boolean)
                    .join(" / ");
                  return (
                    <option key={b.id} value={b.id}>
                      {b.stoneType.name} — {dateFmt.format(b.arrivedAt)}
                      {qty && ` (${qty})`}
                    </option>
                  );
                })}
              </select>
            </div>
            <label className="flex items-center gap-2 text-base text-gray-800">
              <input type="checkbox" name="decrementSlabs" value="1" />
              Бой был целой плитой партии (−1 плита)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="block">
                  Блок
                </label>
                <input
                  id="block"
                  name="block"
                  placeholder="напр. А"
                  required
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="landmark">
                  Ориентир
                </label>
                <input
                  id="landmark"
                  name="landmark"
                  placeholder="напр. 2"
                  required
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </fieldset>

        <button
          type="submit"
          className="w-full rounded-xl bg-gray-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-gray-700"
        >
          Сохранить
        </button>
      </form>
    </main>
  );
}
