// @vitest-environment jsdom
//
// BUG-08: черновик приёмки (localStorage) не должен теряться при монтировании.
// Раньше эффект сохранения черновика срабатывал ПЕРВЫМ (с пустым default-state)
// и затирал старый черновик до того, как эффект восстановления его прочитает.
//
// W2-B-FIX: draft gate — useRef (draftReady), restore queueMicrotask ichida.
// ?ok=1 / bo'sh mount default formani draft qilib qayta yozmasligi kerak.

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import IntakeForm from "@/app/priemka/IntakeForm";

// Изолируем компонент от server action (Prisma/Telegram) — тест проверяет
// только клиентскую логику черновика.
vi.mock("@/app/priemka/actions", () => ({
  submitIntake: vi.fn(async () => ({ errors: {} })),
}));

const DRAFT_KEY = "onyx-intake-draft-v1";

/** Restore/gate microtask'ini flush qilish (sync assert emas). */
async function flushDraftGate(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  // search params ifodalari testlar o'rtasida oqib ketmasin
  window.history.replaceState({}, "", "/priemka");
});

describe("IntakeForm — черновик и hydrated-гейт", () => {
  it("восстанавливает старый черновик, не затирая его пустым default-state при монтировании", async () => {
    const oldDraft = {
      values: {
        stoneTypeId: "",
        newName: "",
        newRockType: "",
        newColor: "",
        slabsTotal: "40",
        areaTotalM2: "220",
        supplierNote: "STARY-CHERNOVIK-12345",
        arrivedAt: "2026-07-01",
      },
      locs: { 0: { block: "А", landmark: "2", slabsHere: "", areaHereM2: "" } },
      rowIds: [0],
      patternsEnabled: false,
      patRowIds: [0],
      pats: { 0: { description: "", thicknessMm: "", slabs: "", areaM2: "" } },
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(oldDraft));

    render(
      <IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />,
    );

    // Черновик восстановлен в поля формы.
    await screen.findByDisplayValue("STARY-CHERNOVIK-12345");
    expect(screen.getByText(/восстановлен незаконченный черновик/i)).toBeTruthy();

    // localStorage не был затёрт пустым состоянием до восстановления —
    // финальное содержимое по-прежнему содержит данные старого черновика.
    await waitFor(() => {
      const raw = localStorage.getItem(DRAFT_KEY);
      expect(raw).toBeTruthy();
      const saved = JSON.parse(raw!);
      expect(saved.values.supplierNote).toBe("STARY-CHERNOVIK-12345");
    });
  });

  it("на пустом localStorage не падает, ничего не восстанавливает, но сохраняет черновик после реального ввода", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />);

    expect(
      screen.queryByText(/восстановлен незаконченный черновик/i),
    ).toBeNull();
    // Gate microtask tugaguncha kutamiz, keyin user input (draftReady=true).
    await flushDraftGate();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    const supplierNote = screen.getByPlaceholderText(/инвойс/i);
    fireEvent.change(supplierNote, { target: { value: "новый черновик" } });

    await waitFor(() => {
      const raw = localStorage.getItem(DRAFT_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).values.supplierNote).toBe("новый черновик");
    });
  });

  it("eski draft + ?ok=1 → mountdan keyin DRAFT_KEY null qoladi (qayta yozilmaydi)", async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        values: {
          stoneTypeId: "",
          newName: "",
          newRockType: "",
          newColor: "",
          slabsTotal: "99",
          areaTotalM2: "1",
          supplierNote: "MUST-BE-CLEARED",
          arrivedAt: "2026-07-01",
        },
        locs: { 0: { block: "", landmark: "", slabsHere: "", areaHereM2: "" } },
        rowIds: [0],
        patternsEnabled: false,
        patRowIds: [0],
        pats: { 0: { description: "", thicknessMm: "", slabs: "", areaM2: "" } },
      }),
    );
    window.history.replaceState({}, "", "/priemka?ok=1");

    render(<IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />);

    // Microtask: removeItem + draftReady — sync emas, kutamiz.
    await waitFor(() => {
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    });
    // Qayta yozilmasligi: yana bir tick kutib null qolishini tasdiqlaymiz.
    await flushDraftGate();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(
      screen.queryByText(/восстановлен незаконченный черновик/i),
    ).toBeNull();
  });

  // ── W3-T6 — режим «Из каталога / Новый вид» в черновике ──

  it("W3-T6: старый черновик БЕЗ isNewType восстанавливается без падения (режим — каталог)", async () => {
    // Старый payload: поля новых видов пустые, isNewType отсутствует.
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        values: {
          stoneTypeId: "",
          newName: "",
          newRockType: "",
          newColor: "",
          slabsTotal: "40",
          areaTotalM2: "220",
          supplierNote: "OLD-NO-MODE",
          arrivedAt: "2026-07-01",
        },
        locs: { 0: { block: "", landmark: "", slabsHere: "", areaHereM2: "" } },
        rowIds: [0],
        patternsEnabled: false,
        patRowIds: [0],
        pats: { 0: { description: "", thicknessMm: "", slabs: "", areaM2: "" } },
      }),
    );

    render(<IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />);

    await screen.findByDisplayValue("OLD-NO-MODE");
    // Режим по умолчанию — «Из каталога»: полей нового вида нет.
    expect(screen.queryByPlaceholderText(/травертин noce/i)).toBeNull();
  });

  it("W3-T6: старый черновик без isNewType, но с заполненным newName → включается «Новый вид»", async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        values: {
          stoneTypeId: "",
          newName: "Травертин Тест",
          newRockType: "травертин",
          newColor: "",
          slabsTotal: "",
          areaTotalM2: "",
          supplierNote: "",
          arrivedAt: "2026-07-01",
        },
        locs: { 0: { block: "", landmark: "", slabsHere: "", areaHereM2: "" } },
        rowIds: [0],
        patternsEnabled: false,
        patRowIds: [0],
        pats: { 0: { description: "", thicknessMm: "", slabs: "", areaM2: "" } },
      }),
    );

    render(<IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />);

    // Поля «Нового вида» видимы сразу — с восстановленными значениями.
    await screen.findByDisplayValue("Травертин Тест");
    expect(screen.getByDisplayValue("травертин")).toBeTruthy();
  });

  it("W3-T6/BUG-01: старый частичный черновик мержится поверх дефолтов — новые поля остаются КОНТРОЛИРУЕМЫМИ", async () => {
    // Черновик, записанный ДО W6-C и ТЗ №12: нет newDescription, newBasePrice,
    // lengthMm/widthMm/thicknessMm и даже arrivedAt. Ветка вывода режима
    // включает «Новый вид», поэтому эти поля монтируются. Если restore заменял
    // бы весь values, они получили бы value={undefined} = неконтролируемые,
    // и ответ submitIntake с { errors } стёр бы введённое складчиком.
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        values: {
          stoneTypeId: "",
          newName: "Оникс Легаси",
          newRockType: "оникс",
          newColor: "",
          slabsTotal: "40",
          areaTotalM2: "220",
          supplierNote: "LEGACY-PARTIAL",
        },
        locs: { 0: { block: "", landmark: "", slabsHere: "", areaHereM2: "" } },
        rowIds: [0],
        patternsEnabled: false,
        patRowIds: [0],
        pats: { 0: { description: "", thicknessMm: "", slabs: "", areaM2: "" } },
      }),
    );

    render(
      <IntakeForm stoneTypes={[]} defaultDate="2026-07-25" canSeePrices />,
    );

    // Режим «Новый вид» выведен → поля видны, значения из черновика на месте.
    await screen.findByDisplayValue("Оникс Легаси");
    expect(screen.getByDisplayValue("оникс")).toBeTruthy();

    // Поля, которых в старом черновике НЕТ, — контролируемые пустые строки.
    const desc = screen.getByPlaceholderText(
      /Светлый травертин/i,
    ) as HTMLTextAreaElement;
    expect(desc.value).toBe("");
    expect((screen.getByPlaceholderText("например 95") as HTMLInputElement).value)
      .toBe("");
    for (const ph of ["280", "160", "2 или 1,8"]) {
      expect((screen.getByPlaceholderText(ph) as HTMLInputElement).value).toBe("");
    }

    // Отсутствующий в черновике arrivedAt не стал undefined — остался дефолт.
    expect(
      (document.getElementById("arrivedAt") as HTMLInputElement).value,
    ).toBe("2026-07-25");

    // Главный пин мержа: пересохранённый черновик содержит ВСЕ ключи values
    // (при замене вместо мержа undefined-поля выпали бы из JSON).
    await waitFor(() => {
      const raw = localStorage.getItem(DRAFT_KEY);
      expect(raw).toBeTruthy();
      const saved = JSON.parse(raw!);
      expect(saved.values.supplierNote).toBe("LEGACY-PARTIAL");
      expect(saved.values.arrivedAt).toBe("2026-07-25");
      for (const key of [
        "newDescription",
        "newBasePrice",
        "lengthMm",
        "widthMm",
        "thicknessMm",
      ]) {
        expect(saved.values[key]).toBe("");
      }
    });
  });

  it("W3-T6: новый черновик round-trip'ит isNewType (сохраняется и восстанавливается)", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { unmount } = render(
      <IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />,
    );
    await flushDraftGate();

    // Пользователь переключается на «Новый вид» и вводит название.
    fireEvent.click(screen.getByRole("button", { name: "Новый вид" }));
    const name = await screen.findByPlaceholderText(/травертин noce/i);
    fireEvent.change(name, { target: { value: "Оникс Round-Trip" } });

    await waitFor(() => {
      const raw = localStorage.getItem(DRAFT_KEY);
      expect(raw).toBeTruthy();
      const saved = JSON.parse(raw!);
      expect(saved.isNewType).toBe(true);
      expect(saved.values.newName).toBe("Оникс Round-Trip");
    });

    unmount();
    cleanup();

    // Повторный mount: режим «Новый вид» активен, поля видны сразу.
    render(<IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />);
    await screen.findByDisplayValue("Оникс Round-Trip");
    expect(screen.getByText(/восстановлен незаконченный черновик/i)).toBeTruthy();
  });

  it("W3-T6: «Очистить и начать заново» удаляет черновик вместе с isNewType", async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        values: {
          stoneTypeId: "",
          newName: "Удаляемый вид",
          newRockType: "гранит",
          newColor: "",
          slabsTotal: "",
          areaTotalM2: "",
          supplierNote: "",
          arrivedAt: "2026-07-01",
        },
        isNewType: true,
        locs: { 0: { block: "", landmark: "", slabsHere: "", areaHereM2: "" } },
        rowIds: [0],
        patternsEnabled: false,
        patRowIds: [0],
        pats: { 0: { description: "", thicknessMm: "", slabs: "", areaM2: "" } },
      }),
    );

    const { fireEvent } = await import("@testing-library/react");
    render(<IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />);

    await screen.findByDisplayValue("Удаляемый вид");
    fireEvent.click(
      screen.getByRole("button", { name: /очистить и начать заново/i }),
    );

    // Черновик стёрт целиком (полная перезагрузка в jsdom не выполняется,
    // но ключ localStorage должен исчезнуть сразу).
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("bo'sh localStorage mount → user inputsiz DRAFT_KEY null qoladi", async () => {
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    render(<IntakeForm stoneTypes={[]} defaultDate="2026-07-25" />);

    await flushDraftGate();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // Gate ochilgach ham default forma draft yozilmasligi kerak.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(
      screen.queryByText(/восстановлен незаконченный черновик/i),
    ).toBeNull();
  });
});
