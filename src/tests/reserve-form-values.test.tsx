// @vitest-environment jsdom
//
// W3-T1 — /bron: форма брони теряла введённое при отказе сервера.
// React 19 сбрасывает НЕуправляемые поля после каждого вызова экшена (в том
// числе отказа), поэтому менеджер перенабирал клиента, контакт, объём и срок.
// Проверяем контракт: отказ — всё на месте и ошибка озвучена (role=alert);
// успех — осознанный сброс; отправка — кнопка заблокирована (без дублей).

import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ReserveForm, { type StoneGroup } from "@/app/bron/ReserveForm";
import {
  emptyReserveValues,
  nextReserveValues,
  reserveFailed,
} from "@/app/bron/reserve-form-values";
import type { ReserveFormState } from "@/app/bron/actions";

// Изоляция от server action (Prisma/сессия): проверяем клиентский контракт.
const createReservation = vi.fn();
vi.mock("@/app/bron/actions", () => ({
  createReservation: (...args: unknown[]) => createReservation(...args),
}));

const STONES: StoneGroup[] = [
  {
    id: "st-1",
    name: "Оникс Белый",
    rockType: "оникс",
    slabs: [{ value: "SLAB:s-1", label: "Плита №1" }],
    pieces: [],
    batches: [
      {
        value: "BATCH:b-1",
        label: "Партия 01.07",
        freeSlabs: 12,
        freeAreaM2: 60,
      },
    ],
  },
];

const renderForm = () =>
  render(<ReserveForm stones={STONES} defaultDays={7} />);

/** Выбор вида камня + цели (target управляем — живёт в состоянии). */
function pickStoneAndTarget(targetValue: string) {
  fireEvent.change(screen.getByLabelText(/вид камня/i), {
    target: { value: "st-1" },
  });
  fireEvent.change(screen.getByLabelText(/что бронируем/i), {
    target: { value: targetValue },
  });
}

const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /забронировать/i }));
  });
};

beforeEach(() => {
  createReservation.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("nextReserveValues — чистая часть (без React)", () => {
  const values = {
    customerName: "Иван Петров",
    customerContact: "+998 90 123-45-67",
    days: "5",
    qtySlabs: "10",
    qtyAreaM2: "12,5",
  };

  it("отказ (есть ошибки) → значения сохраняются как есть", () => {
    const state: ReserveFormState = {
      errors: { form: "Камень уже занят", target: "Камень уже занят" },
      alternatives: [],
    };
    expect(reserveFailed(state)).toBe(true);
    expect(nextReserveValues(values, state)).toBe(values);
  });

  it("успех (ошибок нет) → осознанный сброс в пустую форму", () => {
    const state: ReserveFormState = { errors: {}, alternatives: [] };
    expect(reserveFailed(state)).toBe(false);
    expect(nextReserveValues(values, state)).toEqual(emptyReserveValues());
  });
});

describe("ReserveForm — ввод переживает отказ сервера", () => {
  it("отказ по валидации: клиент, контакт и срок остаются в полях, ошибка озвучена", async () => {
    createReservation.mockResolvedValue({
      errors: { form: "Срок — целое число дней", days: "Срок — целое число дней" },
      alternatives: [],
    } satisfies ReserveFormState);

    renderForm();
    pickStoneAndTarget("SLAB:s-1");

    fireEvent.change(screen.getByLabelText(/клиент/i), {
      target: { value: "Иван Петров" },
    });
    fireEvent.change(screen.getByLabelText(/контакт/i), {
      target: { value: "+998 90 123-45-67" },
    });
    fireEvent.change(screen.getByLabelText(/срок, дней/i), {
      target: { value: "3x" },
    });

    await submit();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Срок — целое число дней",
      );
    });

    // Главное: НИЧЕГО не потеряно — перенабирать не нужно.
    expect(screen.getByDisplayValue("Иван Петров")).toBeTruthy();
    expect(screen.getByDisplayValue("+998 90 123-45-67")).toBeTruthy();
    expect(screen.getByDisplayValue("3x")).toBeTruthy();
    // Цель брони тоже не слетает.
    expect(
      (screen.getByLabelText(/что бронируем/i) as HTMLSelectElement).value,
    ).toBe("SLAB:s-1");
  });

  it("отказ по объёму: плиты и м² партии не сбрасываются", async () => {
    createReservation.mockResolvedValue({
      errors: { form: "Не хватает свободного объёма", qtySlabs: "Не хватает свободного объёма" },
      alternatives: [],
    } satisfies ReserveFormState);

    renderForm();
    pickStoneAndTarget("BATCH:b-1");

    fireEvent.change(screen.getByLabelText("Плит"), {
      target: { value: "40" },
    });
    fireEvent.change(screen.getByLabelText("м²"), {
      target: { value: "12,5" },
    });
    fireEvent.change(screen.getByLabelText(/клиент/i), {
      target: { value: "ООО Стройка" },
    });

    await submit();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Не хватает свободного объёма",
      );
    });

    expect(screen.getByDisplayValue("40")).toBeTruthy();
    expect(screen.getByDisplayValue("12,5")).toBeTruthy();
    expect(screen.getByDisplayValue("ООО Стройка")).toBeTruthy();
  });

  it("успешный ответ сервера (без ошибок) → поля очищаются осознанно", async () => {
    // Боевой экшен на успехе делает redirect; здесь моделируем «чистый» ответ,
    // чтобы проверить именно ветку сброса.
    createReservation.mockResolvedValue({
      errors: {},
      alternatives: [],
    } satisfies ReserveFormState);

    renderForm();
    pickStoneAndTarget("SLAB:s-1");
    fireEvent.change(screen.getByLabelText(/клиент/i), {
      target: { value: "Иван Петров" },
    });

    await submit();

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Иван Петров")).toBeNull();
    });
    // Успех не празднуется формой: баннер «Бронь оформлена» рисует страница
    // по ответу сервера (?ok=1), внутри формы никакого alert нет.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("во время отправки кнопка заблокирована — двойная бронь невозможна", async () => {
    let release: (v: ReserveFormState) => void = () => {};
    createReservation.mockImplementation(
      () =>
        new Promise<ReserveFormState>((resolve) => {
          release = resolve;
        }),
    );

    renderForm();
    pickStoneAndTarget("SLAB:s-1");
    fireEvent.change(screen.getByLabelText(/клиент/i), {
      target: { value: "Иван Петров" },
    });

    const btn = screen.getByRole("button", { name: /забронировать/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    const pendingBtn = screen.getByRole("button", { name: /бронирование…/i });
    expect((pendingBtn as HTMLButtonElement).disabled).toBe(true);

    // Повторный клик по «занятой» кнопке экшен второй раз не зовёт.
    fireEvent.click(pendingBtn);
    expect(createReservation).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ errors: {}, alternatives: [] });
      await Promise.resolve();
    });
  });
});
