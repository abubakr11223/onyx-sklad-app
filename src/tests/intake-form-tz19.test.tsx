// @vitest-environment jsdom
//
// ТЗ №19 A1/A2 — форма приёмки:
//  • A1: с галочкой «несколько узоров» «Плит» и «Площадь» партии — только
//    чтение и равны ИТОГО по узорам;
//  • A2: выбор узора в строке локации подставляет «Плит здесь» из узора,
//    если узор лежит только в этой строке; ручная правка не затирается.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import IntakeForm from "@/app/priemka/IntakeForm";

vi.mock("@/app/priemka/actions", () => ({
  submitIntake: vi.fn(async () => ({ errors: {} })),
}));

const DRAFT_KEY = "onyx-intake-draft-v1";

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function seedDraft(locs: Record<number, Record<string, string>>) {
  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      values: { stoneTypeId: "st1", slabsTotal: "40", areaTotalM2: "220" },
      isNewType: false,
      rowIds: Object.keys(locs).map(Number),
      locs,
      patternsEnabled: true,
      patRowIds: [0, 1],
      pats: {
        0: { description: "светлый", thicknessMm: "2", lengthMm: "280", widthMm: "160", slabs: "3", areaM2: "13,44" },
        1: { description: "тёмный", thicknessMm: "3", lengthMm: "250", widthMm: "150", slabs: "3", areaM2: "11,25" },
      },
    }),
  );
}

const loc = (over: Record<string, string> = {}) => ({
  block: "",
  landmark: "",
  slabsHere: "",
  areaHereM2: "",
  pattern: "",
  ...over,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("IntakeForm — ТЗ №19", () => {
  it("A1: количество партии = ИТОГО по узорам, только чтение (введённые 40/220 не показываются)", async () => {
    seedDraft({ 0: loc(), 1: loc() });
    const { container } = render(
      <IntakeForm stoneTypes={[{ id: "st1", name: "Травертин", rockType: "травертин" }]} defaultDate="2026-10-27" />,
    );
    await flush();
    const slabs = container.querySelector<HTMLInputElement>("#slabsTotal")!;
    const area = container.querySelector<HTMLInputElement>("#areaTotalM2")!;
    expect(slabs.readOnly).toBe(true);
    expect(area.readOnly).toBe(true);
    expect(slabs.value).toBe("6");
    expect(area.value).toBe("24,69");
  });

  it("A2: выбор узора подставляет «Плит здесь»; ручное значение не затирается", async () => {
    seedDraft({ 0: loc(), 1: loc({ slabsHere: "2" }) });
    const { container } = render(
      <IntakeForm stoneTypes={[{ id: "st1", name: "Травертин", rockType: "травертин" }]} defaultDate="2026-10-27" />,
    );
    await flush();

    // Строка 1: пусто → узор 1 (id строки узора 0) → 3 плиты.
    fireEvent.change(container.querySelector("#locPattern-0")!, {
      target: { value: "0" },
    });
    expect(
      container.querySelector<HTMLInputElement>("#locSlabsHere-0")!.value,
    ).toBe("3");

    // Строка 2: складчик уже ввёл 2 — выбор узора не перетирает ручной ввод.
    fireEvent.change(container.querySelector("#locPattern-1")!, {
      target: { value: "1" },
    });
    expect(
      container.querySelector<HTMLInputElement>("#locSlabsHere-1")!.value,
    ).toBe("2");
  });

  it("A2: смена узора меняет подставленное значение (3 → 5)", async () => {
    seedDraft({ 0: loc() });
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        ...JSON.parse(localStorage.getItem(DRAFT_KEY)!),
        pats: {
          0: { description: "светлый", thicknessMm: "2", lengthMm: "280", widthMm: "160", slabs: "3", areaM2: "13,44" },
          1: { description: "тёмный", thicknessMm: "3", lengthMm: "250", widthMm: "150", slabs: "5", areaM2: "18,75" },
        },
      }),
    );
    const { container } = render(
      <IntakeForm stoneTypes={[{ id: "st1", name: "Травертин", rockType: "травертин" }]} defaultDate="2026-10-27" />,
    );
    await flush();
    const select = container.querySelector("#locPattern-0")!;
    const slabs = () =>
      container.querySelector<HTMLInputElement>("#locSlabsHere-0")!.value;
    fireEvent.change(select, { target: { value: "0" } });
    expect(slabs()).toBe("3");
    fireEvent.change(select, { target: { value: "1" } });
    expect(slabs()).toBe("5");
    // Обратно на «весь приход» — подстановка снимается.
    fireEvent.change(select, { target: { value: "" } });
    expect(slabs()).toBe("");
  });
});
