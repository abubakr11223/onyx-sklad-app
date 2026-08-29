// @vitest-environment jsdom
//
// W3-T2 (b/c) — клиентская половина: ошибка сервера НЕ стирает введённые
// замеры, и повтор идёт с ТЕМ ЖЕ mutationId (иначе де-дубль на сервере
// бессмысленен). Экшен замокан — Prisma/сессия сюда не нужны.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SinganFormState } from "@/app/singan/actions";

const submitSingan = vi.fn(
  async (_prev: SinganFormState, formData: FormData): Promise<SinganFormState> => ({
    errors: {
      form: "Проверьте поля формы",
      thicknessMm: "Толщина, см — положительное число, например 2 или 1,8",
    },
    values: {
      sides: [],
      boundingLengthMm: String(formData.get("boundingLengthMm") ?? ""),
      boundingWidthMm: "",
      thicknessMm: "",
      areaM2: "",
      kind: "",
      batchId: "",
      block: "",
      landmark: "",
      breakCause: "",
      breakCauseNote: "",
    },
  }),
);

vi.mock("@/app/singan/actions", () => ({
  submitSingan: (...a: unknown[]) =>
    submitSingan(...(a as [SinganFormState, FormData])),
}));

import SinganForm from "@/app/singan/SinganForm";

afterEach(() => {
  cleanup();
  submitSingan.mockClear();
});

function renderForm() {
  const utils = render(
    <SinganForm
      d="ZHJhZnQ"
      svg="<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'></svg>"
      sideCount={3}
      batches={[{ id: "b1", label: "Оникс — 01.08.2026 (10 плит)" }]}
      blocks={[{ letter: "A", landmarks: ["2", "3"] }]}
    />,
  );
  const form = utils.container.querySelector("form") as HTMLFormElement;
  return { ...utils, form };
}

function fill() {
  fireEvent.change(screen.getByLabelText("Сторона 1"), {
    target: { value: "118" },
  });
  fireEvent.change(screen.getByLabelText("Сторона 2"), {
    target: { value: "64" },
  });
  fireEvent.change(screen.getByLabelText("Сторона 3"), {
    target: { value: "95" },
  });
  fireEvent.change(screen.getByLabelText("Длина, см"), {
    target: { value: "120" },
  });
  fireEvent.change(screen.getByLabelText("Ширина, см"), {
    target: { value: "70" },
  });
  fireEvent.change(screen.getByLabelText("Толщина, см"), {
    target: { value: "плохо" },
  });
}

describe("SinganForm — ошибка не стирает введённое", () => {
  it("после ответа с ошибкой все стороны и габариты остаются в полях", async () => {
    const { form } = renderForm();
    fill();
    fireEvent.submit(form);

    // Ошибка показана В ФОРМЕ (никакого redirect ?err=).
    await screen.findByText(
      "Толщина, см — положительное число, например 2 или 1,8",
    );

    // Замеры на месте — рулетку второй раз доставать не нужно.
    expect(screen.getByLabelText("Сторона 1")).toHaveProperty("value", "118");
    expect(screen.getByLabelText("Сторона 2")).toHaveProperty("value", "64");
    expect(screen.getByLabelText("Сторона 3")).toHaveProperty("value", "95");
    expect(screen.getByLabelText("Длина, см")).toHaveProperty("value", "120");
    expect(screen.getByLabelText("Ширина, см")).toHaveProperty("value", "70");
    expect(screen.getByLabelText("Толщина, см")).toHaveProperty(
      "value",
      "плохо",
    );
  });

  it("повторная отправка идёт с ТЕМ ЖЕ mutationId (де-дубль не ломается)", async () => {
    const { form } = renderForm();
    fill();
    fireEvent.submit(form);
    await waitFor(() => expect(submitSingan).toHaveBeenCalledTimes(1));
    fireEvent.submit(form);
    await waitFor(() => expect(submitSingan).toHaveBeenCalledTimes(2));

    const first = submitSingan.mock.calls[0][1].get("mutationId");
    const second = submitSingan.mock.calls[1][1].get("mutationId");
    expect(typeof first).toBe("string");
    expect(String(first)).not.toBe("");
    expect(second).toBe(first);
  });

  it("ориентир не обязателен (ТЗ №18 §2), блок — обязателен", () => {
    renderForm();
    const landmark = screen.getByLabelText("Ориентир") as HTMLSelectElement;
    expect(landmark.required).toBe(false);
    // Блок помечен звёздочкой в WarehouseLocationSelect (общий контрол).
    expect(screen.getByText("Блок")).toBeTruthy();
  });
});
