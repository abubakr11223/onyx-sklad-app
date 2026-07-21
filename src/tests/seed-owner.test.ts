// seed:owner CLI'ning SOF qismi — arg/env tahlili va validatsiya. DB YO'Q.
import { describe, expect, it } from "vitest";
import {
  parseOwnerArgs,
  validateOwnerArgs,
  type RawOwnerArgs,
} from "@/lib/seed-owner";

describe("parseOwnerArgs", () => {
  it("argv bayroqlarini o'qiydi (--email/--password/--name/--force)", () => {
    const r = parseOwnerArgs(
      ["--email=a@b.uz", "--password=Secret123", "--name=Boss", "--force"],
      {},
    );
    expect(r).toEqual({
      email: "a@b.uz",
      password: "Secret123",
      name: "Boss",
      force: true,
    });
  });

  it("env'dan oladi, argv env'dan ustun", () => {
    const env = {
      OWNER_EMAIL: "env@b.uz",
      OWNER_PASSWORD: "EnvPass12",
      OWNER_NAME: "EnvName",
    } as NodeJS.ProcessEnv;

    // argv bo'sh → env ishlatiladi
    expect(parseOwnerArgs([], env)).toEqual({
      email: "env@b.uz",
      password: "EnvPass12",
      name: "EnvName",
      force: false,
    });

    // argv email bergan → env email'ni bosib o'tadi
    const r = parseOwnerArgs(["--email=cli@b.uz"], env);
    expect(r.email).toBe("cli@b.uz");
    expect(r.password).toBe("EnvPass12"); // parol hali env'dan
  });

  it("hech narsa berilmasa — barchasi null/false", () => {
    expect(parseOwnerArgs([], {})).toEqual({
      email: null,
      password: null,
      name: null,
      force: false,
    });
  });
});

describe("validateOwnerArgs", () => {
  const base: RawOwnerArgs = {
    email: "owner@onyx.uz",
    password: "StrongPass1",
    name: null,
    force: false,
  };

  it("to'g'ri kirim → ok, email normallashadi (lowercase/trim), name default 'Owner'", () => {
    const r = validateOwnerArgs({
      ...base,
      email: "  Owner@Onyx.UZ  ",
      name: null,
    });
    expect(r).toEqual({
      ok: true,
      email: "owner@onyx.uz",
      password: "StrongPass1",
      name: "Owner",
      force: false,
    });
  });

  it("email umuman yo'q → usage", () => {
    expect(validateOwnerArgs({ ...base, email: null })).toEqual({
      ok: false,
      error: "usage",
    });
    expect(validateOwnerArgs({ ...base, email: "   " })).toEqual({
      ok: false,
      error: "usage",
    });
  });

  it("email formati yaroqsiz → email xato", () => {
    expect(validateOwnerArgs({ ...base, email: "not-an-email" })).toEqual({
      ok: false,
      error: "email",
    });
  });

  it("parol yo'q → password xato", () => {
    expect(validateOwnerArgs({ ...base, password: null })).toEqual({
      ok: false,
      error: "password",
    });
  });

  it("parol < 8 belgi → password xato (zaif parol rad etiladi)", () => {
    expect(validateOwnerArgs({ ...base, password: "short7!" })).toEqual({
      ok: false,
      error: "password",
    });
  });

  it("aniq 8 belgili parol → qabul qilinadi", () => {
    const r = validateOwnerArgs({ ...base, password: "eightch8" });
    expect(r.ok).toBe(true);
  });

  it("--force uzatiladi", () => {
    const r = validateOwnerArgs({ ...base, force: true });
    expect(r.ok && r.force).toBe(true);
  });
});
