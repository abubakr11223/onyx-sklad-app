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
// ТЗ №19 B2 — клиент брони из справочника: поиск — server action продажи.
const CLIENT = { id: "c-1", name: "Иван Петров", phone: "+998901234567", type: "B2C" as const };
vi.mock("@/app/prodazha/client-actions", () => ({
  searchClientsForSale: async () => ({ ok: true, clients: [CLIENT] }),
  createClientForSale: async () => ({ ok: true, client: CLIENT }),
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

/** Клиент выбирается из справочника: ввод → подсказка → клик. */
async function pickClient() {
  fireEvent.change(screen.getByPlaceholderText(/имя или телефон клиента/i), {
    target: { value: "Иван" },
  });
  const hit = await screen.findByRole("button", { name: /Иван Петров/ }, { timeout: 2000 });
  fireEvent.click(hit);
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
  it("отказ по валидации: клиент и срок остаются, ошибка озвучена", async () => {
    createReservation.mockResolvedValue({
      errors: { form: "Срок — целое число дней", days: "Срок — целое число дней" },
      alternatives: [],
    } satisfies ReserveFormState);

    renderForm();
    pickStoneAndTarget("SLAB:s-1");
    await pickClient();
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
    expect(screen.getByText("Иван Петров")).toBeTruthy();
    expect(screen.getByDisplayValue("3x")).toBeTruthy();
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
    await pickClient();

    fireEvent.change(screen.getByLabelText(/сколько плит/i), {
      target: { value: "40" },
    });
    fireEvent.change(screen.getByLabelText("м²"), {
      target: { value: "12,5" },
    });

    await submit();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Не хватает свободного объёма",
      );
    });

    expect(screen.getByDisplayValue("40")).toBeTruthy();
    expect(screen.getByDisplayValue("12,5")).toBeTruthy();
  });

  it("без клиента из справочника бронь не отправить", () => {
    renderForm();
    pickStoneAndTarget("SLAB:s-1");
    const btn = screen.getByRole("button", { name: /забронировать/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
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
    await pickClient();

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
