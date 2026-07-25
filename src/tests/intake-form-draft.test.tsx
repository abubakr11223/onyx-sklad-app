// @vitest-environment jsdom
//
// BUG-08: черновик приёмки (localStorage) не должен теряться при монтировании.
// Раньше эффект сохранения черновика срабатывал ПЕРВЫМ (с пустым default-state)
// и затирал старый черновик до того, как эффект восстановления успевал его
// прочитать. Тест воспроизводит это на реальном DOM (jsdom) через React.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import IntakeForm from "@/app/priemka/IntakeForm";

// Изолируем компонент от server action (Prisma/Telegram) — тест проверяет
// только клиентскую логику черновика.
vi.mock("@/app/priemka/actions", () => ({
  submitIntake: vi.fn(async () => ({ errors: {} })),
}));

const DRAFT_KEY = "onyx-intake-draft-v1";

afterEach(() => {
  cleanup();
  localStorage.clear();
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
    // Гейт не восстанавливает несуществующий черновик и не должен навсегда
    // блокировать сохранение — после реального ввода он всё же пишется.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    const supplierNote = screen.getByPlaceholderText(/инвойс/i);
    fireEvent.change(supplierNote, { target: { value: "новый черновик" } });

    await waitFor(() => {
      const raw = localStorage.getItem(DRAFT_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).values.supplierNote).toBe("новый черновик");
    });
  });
});
