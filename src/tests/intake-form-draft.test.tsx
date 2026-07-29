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
