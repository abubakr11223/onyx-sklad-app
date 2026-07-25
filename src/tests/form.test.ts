// БАГ-12: единые FormData-хелперы (src/lib/form.ts) — str/rawStr/all с
// изичным (последовательным) контрактом trim вместо разошедшихся локальных
// копий в 5 server actions (bron/priemka/prodazha/razbit/singan).

import { describe, expect, it } from "vitest";
import { allOf, rawStrOf, strOf } from "@/lib/form";

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("strOf", () => {
  it("обрезает пробелы по краям", () => {
    const str = strOf(fd([["name", "  Али  "]]));
    expect(str("name")).toBe("Али");
  });

  it("отсутствующее поле → пустая строка", () => {
    const str = strOf(fd([]));
    expect(str("missing")).toBe("");
  });
});

describe("rawStrOf", () => {
  it("НЕ обрезает пробелы (пароли и т.п.)", () => {
    const rawStr = rawStrOf(fd([["password", "  secret  "]]));
    expect(rawStr("password")).toBe("  secret  ");
  });

  it("отсутствующее поле → пустая строка", () => {
    const rawStr = rawStrOf(fd([]));
    expect(rawStr("missing")).toBe("");
  });
});

describe("allOf", () => {
  it("собирает все значения одного имени как строки", () => {
    const all = allOf(
      fd([
        ["locBlock", "А"],
        ["locBlock", "Б"],
      ]),
    );
    expect(all("locBlock")).toEqual(["А", "Б"]);
  });

  it("отсутствующее имя → пустой массив", () => {
    const all = allOf(fd([]));
    expect(all("missing")).toEqual([]);
  });
});
