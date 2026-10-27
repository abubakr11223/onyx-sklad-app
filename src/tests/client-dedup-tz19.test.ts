// ТЗ №11 §9.1 + ТЗ №19 E1 — дубли клиентов. Телефон совпал → предлагаем
// существующего (не создаём); совпало только имя → предупреждаем, но создать
// можно (два «Тимура» с разными телефонами — норма).
import { describe, expect, it } from "vitest";
import {
  classifyNewClientDuplicate,
  normalizeClientName,
} from "@/lib/clients";

const dir = [
  { id: "t1", name: "Тимур", phone: "+998911113444" },
  { id: "t2", name: "тимур ", phone: "+998 90 222-33-44" },
  { id: "a1", name: "Алёна", phone: "+998901110000" },
];

describe("classifyNewClientDuplicate", () => {
  it("тот же телефон в другой маске → существующий клиент", () => {
    const r = classifyNewClientDuplicate(dir, { name: "Тимур Новый", phone: "998902223344" });
    expect(r).toEqual({ kind: "phone", existing: dir[1] });
  });

  it("телефон приоритетнее имени", () => {
    const r = classifyNewClientDuplicate(dir, { name: "Тимур", phone: "+998911113444" });
    expect(r.kind).toBe("phone");
  });

  it("имя совпало, телефон новый → предупреждение со всеми тёзками", () => {
    const r = classifyNewClientDuplicate(dir, { name: "  ТИМУР ", phone: "+998935550000" });
    expect(r).toEqual({ kind: "name", similar: [dir[0], dir[1]] });
  });

  it("ё = е при сравнении имён", () => {
    const r = classifyNewClientDuplicate(dir, { name: "Алена", phone: "+998935550001" });
    expect(r.kind).toBe("name");
  });

  it("новое имя и телефон → none", () => {
    expect(
      classifyNewClientDuplicate(dir, { name: "Тимур Алиев", phone: "+998935550002" }),
    ).toEqual({ kind: "none" });
  });

  it("normalizeClientName схлопывает пробелы", () => {
    expect(normalizeClientName("  Иван   Петров ")).toBe("иван петров");
  });
});
