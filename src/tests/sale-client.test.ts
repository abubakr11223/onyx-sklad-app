// TZ №10+11 Этап 2 — валидация client/site в форме продажи + phone dedup.
import { describe, expect, it } from "vitest";
import {
  findClientByNormalizedPhone,
  normalizeClientPhone,
  phonesMatch,
} from "@/lib/clients";
import {
  validateNewClient,
  validateNewSite,
  validateSaleClientLink,
} from "@/lib/validators/sale-client";

describe("validateSaleClientLink — client required, site optional", () => {
  it("selected client, no site → ok (частная продажа)", () => {
    const r = validateSaleClientLink({
      clientId: "c1",
      siteId: "",
      siteMode: "none",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ clientId: "c1", siteId: null });
  });

  it("selected client + existing site → ok", () => {
    const r = validateSaleClientLink({
      clientId: "c1",
      siteId: "s9",
      siteMode: "existing",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ clientId: "c1", siteId: "s9" });
  });

  it("siteId alone without mode → ok (site present)", () => {
    const r = validateSaleClientLink({
      clientId: "c1",
      siteId: "s2",
      siteMode: "",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.siteId).toBe("s2");
  });

  it("missing clientId → reject (defense-in-depth for direct POST)", () => {
    const r = validateSaleClientLink({
      clientId: "",
      siteId: "",
      siteMode: "none",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.clientId).toMatch(/клиент/i);
  });

  it("siteMode=existing without siteId → reject", () => {
    const r = validateSaleClientLink({
      clientId: "c1",
      siteId: "",
      siteMode: "existing",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.siteId).toBeTruthy();
  });
});

describe("validateNewClient", () => {
  it("happy path B2C", () => {
    const r = validateNewClient({
      name: "Иван",
      type: "B2C",
      phone: "+998 90 111-22-33",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.type).toBe("B2C");
    expect(r.data.phone).toContain("998");
  });

  it("missing phone → error", () => {
    const r = validateNewClient({ name: "ООО", type: "B2B", phone: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.newClientPhone).toBeTruthy();
  });

  it("missing name → error", () => {
    const r = validateNewClient({ name: "  ", type: "B2C", phone: "901112233" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.newClientName).toBeTruthy();
  });
});

describe("validateNewSite", () => {
  it("happy path with optional address", () => {
    const r = validateNewSite({
      clientId: "c1",
      name: "ЖК Ривьера",
      type: "RESIDENTIAL",
      address: "Юнусабад",
      contactPerson: "Прораб",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.type).toBe("RESIDENTIAL");
    expect(r.data.address).toBe("Юнусабад");
  });

  it("no clientId → error", () => {
    const r = validateNewSite({
      clientId: "",
      name: "Объект",
      type: "COMMERCIAL",
      address: "",
      contactPerson: "",
    });
    expect(r.ok).toBe(false);
  });
});

describe("phone dedup — normalize + find (TZ §9 п.1)", () => {
  const catalog = [
    { id: "a", name: "Али", phone: "+998 90 123-45-67" },
    { id: "b", name: "Бек", phone: "998901112233" },
  ];

  it("+998 90 123-45-67 and 998901234567 are the same number", () => {
    expect(phonesMatch("+998 90 123-45-67", "998901234567")).toBe(true);
    expect(normalizeClientPhone("+998 90 123-45-67")).toBe("998901234567");
  });

  it("findClientByNormalizedPhone finds existing card", () => {
    const hit = findClientByNormalizedPhone(catalog, "998 90 123 45 67");
    expect(hit?.id).toBe("a");
    expect(hit?.name).toBe("Али");
  });

  it("unknown phone → null (safe to create)", () => {
    expect(findClientByNormalizedPhone(catalog, "900000000")).toBeNull();
  });

  it("empty phone never matches", () => {
    expect(findClientByNormalizedPhone(catalog, "   ")).toBeNull();
    expect(phonesMatch("", "")).toBe(false);
  });
});
