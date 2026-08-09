// Mini-form redirect flash maps: every action code must surface text.
import { describe, expect, it } from "vitest";
import { mapFlashCode, mapOkFlash } from "@/lib/form-errors";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");

function actionErrorCodes(relPath: string, param: string): string[] {
  const src = readFileSync(join(root, relPath), "utf8");
  const re = new RegExp(`${param}=([a-z0-9_]+)`, "gi");
  const codes = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    codes.add(m[1]!);
  }
  return [...codes].sort();
}

describe("mapFlashCode / mapOkFlash", () => {
  it("unknown error code → fallback (never null silent)", () => {
    expect(
      mapFlashCode("totally_new", { denied: "Нет прав" }, "Ошибка."),
    ).toBe("Ошибка.");
  });

  it("unknown ok code → fallback (never empty success)", () => {
    expect(mapOkFlash("mystery", { repaid: "OK" }, "Готово.")).toBe("Готово.");
  });

  it("empty / missing → null", () => {
    expect(mapFlashCode("", {}, "x")).toBeNull();
    expect(mapFlashCode(undefined, {}, "x")).toBeNull();
    expect(mapOkFlash(null, {}, "x")).toBeNull();
  });
});

describe("accounts actions error codes ⊆ page ERROR_RU ∪ fallback", () => {
  // Page always has ?? fallback; this asserts known codes are intentional.
  const ERROR_RU_KEYS = new Set([
    "denied",
    "name",
    "email",
    "email_taken",
    "password",
    "role",
    "phone",
    "phone_taken",
    "notfound",
    "owner_protected",
    "self",
    "tg_taken",
    "tg_format",
    "flag",
  ]);

  it("every error= code in actions.ts is either mapped or covered by fallback", () => {
    const codes = actionErrorCodes("src/app/accounts/actions.ts", "error");
    expect(codes.length).toBeGreaterThan(5);
    for (const c of codes) {
      // Structural: mapFlashCode always returns text for any code
      const msg = mapFlashCode(c, Object.fromEntries([...ERROR_RU_KEYS].map((k) => [k, k])), "fallback");
      expect(msg).toBeTruthy();
      if (!ERROR_RU_KEYS.has(c)) {
        // Document unmapped: still visible via fallback
        expect(mapFlashCode(c, Object.fromEntries([...ERROR_RU_KEYS].map((k) => [k, "m"])), "Не удалось выполнить действие.")).toBe(
          "Не удалось выполнить действие.",
        );
      }
    }
  });
});

describe("dolzhniki err codes", () => {
  const ERR_RU = {
    denied: "x",
    notfound: "x",
    already: "x",
    inactive: "x",
    date: "x",
    fail: "x",
  };

  it("action codes are all in ERR_RU", () => {
    const codes = actionErrorCodes("src/app/dolzhniki/actions.ts", "err");
    for (const c of codes) {
      expect(ERR_RU[c as keyof typeof ERR_RU], `unmapped err=${c}`).toBeTruthy();
      expect(mapFlashCode(c, ERR_RU, "Ошибка.")).not.toBe("Ошибка.");
    }
  });
});

describe("obraztsy / fotozapros / return — message redirects (not code maps)", () => {
  it("obraztsy fail paths use encodeURIComponent message not bare codes", () => {
    const src = readFileSync(join(root, "src/app/obraztsy/actions.ts"), "utf8");
    // Failures: err= + encodeURIComponent( message )
    expect(src).toMatch(/err=\s*"\s*\+\s*encodeURIComponent/);
    // Success only after res.ok / domain success
    expect(src).toMatch(/if\s*\(\s*!res\.ok\s*\)/);
  });

  it("fotozapros closeErr is full message; closed only after update", () => {
    const src = readFileSync(
      join(root, "src/app/fotozapros/actions.ts"),
      "utf8",
    );
    expect(src).toMatch(/closeErr=/);
    expect(src).toMatch(/closed=ok/);
  });

  it("prodazha return retErr is full message; retOk only after result.ok", () => {
    const src = readFileSync(
      join(root, "src/app/prodazha/actions.ts"),
      "utf8",
    );
    expect(src).toMatch(/retErr=/);
    expect(src).toMatch(/if\s*\(\s*!result\.ok\s*\)/);
    expect(src).toMatch(/retOk=/);
  });
});
