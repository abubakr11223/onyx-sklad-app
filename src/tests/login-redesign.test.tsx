// @vitest-environment jsdom
//
// TZ №8 v2 §12 — /login redizayn client testlari (Vitest + jsdom).
// Yashil qolishi shart: forma darhol mavjud (3D yuklashini kutmasin), fallback
// zanjiri to'g'ri ishlaydi (reduced-motion, weak-device), Canvas kerakli sharoit
// bo'lmasa render qilinmaydi, 3D wrapper aria-hidden.
//
// Muhim: `next/dynamic({ ssr: false })` jsdom'da o'z loading fallback'ini
// darhol chiqaradi — StaticLogo (breathing SVG) DOM'da mavjud bo'lishi kerak.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// jsdom canvas.getContext WebGL qaytarmaydi — three.js Canvas mount bo'lganda
// yiqiladi. `next/dynamic({ ssr: false })` loading fallback'ni birinchi render'da
// beradi — sinovlar shu davrni tekshiradi (haqiqiy 3D chunk hech qachon
// hydrate qilinmasin).
import { LoginPageClient } from "@/app/login/LoginPageClient";

// matchMedia mock — jsdom'da yo'q. Har test o'z holatini yozadi.
function mockMatchMedia(matches: (query: string) => boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// Navigator mock — deviceMemory/hardwareConcurrency (weak-device heuristikasi).
function mockNavigator(mem?: number, cores?: number): void {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency: number;
  };
  if (mem !== undefined) {
    Object.defineProperty(nav, "deviceMemory", {
      configurable: true,
      get: () => mem,
    });
  } else {
    // Reset (undefined = modern desktop).
    try {
      delete (nav as { deviceMemory?: number }).deviceMemory;
    } catch {
      Object.defineProperty(nav, "deviceMemory", {
        configurable: true,
        get: () => undefined,
      });
    }
  }
  if (cores !== undefined) {
    Object.defineProperty(nav, "hardwareConcurrency", {
      configurable: true,
      get: () => cores,
    });
  }
}

beforeEach(() => {
  // Standart: strong desktop, hech qanday reduced-motion, hover mavjud.
  mockMatchMedia(() => false);
  mockNavigator(undefined, 12);
});

afterEach(() => {
  cleanup();
});

const baseProps = {
  next: "/",
  loginError: false,
  magicError: false,
  tgDeepLink: null,
};

describe("/login redizayn (TZ №8 v2)", () => {
  it("forma DARHOL interaktiv (3D yuklashini kutmasin)", () => {
    render(<LoginPageClient {...baseProps} />);
    // Email va parol input'lari birinchi render'dan mavjud.
    expect(
      screen.getByPlaceholderText("you@example.com"),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Пароль")).toBeTruthy();
    // «Войти» tugmasi ham darhol.
    expect(screen.getByRole("button", { name: "Войти" })).toBeTruthy();
  });

  it("prefers-reduced-motion → Canvas render qilinmaydi, statik logo mavjud", () => {
    mockMatchMedia((q) => q.includes("prefers-reduced-motion"));
    render(<LoginPageClient {...baseProps} />);
    // Canvas'ga (haqiqiy 3D) yo'l qo'yilmaydi.
    expect(document.querySelector("canvas")).toBeNull();
    // Static SVG logo (variant=static, data-variant orqali aniqlanadi).
    const logo = document.querySelector('[data-variant="static"]');
    expect(logo).not.toBeNull();
  });

  it("zaif qurilma (deviceMemory=2) → Canvas render qilinmaydi, statik glow", () => {
    mockNavigator(2, 12);
    render(<LoginPageClient {...baseProps} />);
    expect(document.querySelector("canvas")).toBeNull();
    // Static SVG (variant=glow).
    const logo = document.querySelector('[data-variant="glow"]');
    expect(logo).not.toBeNull();
  });

  it("zaif qurilma (hardwareConcurrency=2) → Canvas yo'q, statik glow", () => {
    mockNavigator(undefined, 2);
    render(<LoginPageClient {...baseProps} />);
    expect(document.querySelector("canvas")).toBeNull();
    expect(document.querySelector('[data-variant="glow"]')).not.toBeNull();
  });

  it("modern desktop (deviceMemory=8, cores=12) → 3D dynamic import yo'lida, loading fallback breathing SVG", () => {
    // `next/dynamic({ ssr:false })` birinchi render'da loading fallback beradi
    // (StaticLogo variant="breathing"). Real 3D chunk hech qachon hydrate
    // qilinmagani uchun (jsdom'da WebGL yo'q) — bu bir yagona ko'rinadigan holat.
    mockNavigator(8, 12);
    render(<LoginPageClient {...baseProps} />);
    // Breathing variant = 3D chunk yuklanmoqda deb belgi.
    const logo = document.querySelector('[data-variant="breathing"]');
    expect(logo).not.toBeNull();
    // Static variantlar (fallback zanjiri) YO'Q, chunki modern desktop.
    expect(document.querySelector('[data-variant="static"]')).toBeNull();
    expect(document.querySelector('[data-variant="glow"]')).toBeNull();
  });

  it("logo slot aria-hidden=true (dekorativ)", () => {
    render(<LoginPageClient {...baseProps} />);
    const logo = document.querySelector(
      '[data-variant="breathing"], [data-variant="static"], [data-variant="glow"]',
    );
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
  });

  it("loginError=true → xato xabari va aria-invalid input'larda", () => {
    render(<LoginPageClient {...baseProps} loginError={true} />);
    expect(
      screen.getByText("Неверный логин или пароль."),
    ).toBeTruthy();
    const emailInput = screen.getByPlaceholderText(
      "you@example.com",
    ) as HTMLInputElement;
    expect(emailInput.getAttribute("aria-invalid")).toBe("true");
  });

  it("tgDeepLink berilgan → Telegram tugmasi ko'rinadi", () => {
    render(
      <LoginPageClient
        {...baseProps}
        tgDeepLink="https://t.me/OnyxBot?start=login"
      />,
    );
    const tgLink = screen.getByText("Войти через Telegram") as HTMLAnchorElement;
    expect(tgLink.getAttribute("href")).toBe(
      "https://t.me/OnyxBot?start=login",
    );
  });

  // ── W3-T7 — Enter bosilganda forma yuborilishi (native submit) ──
  it("«Войти» tugmasi type=submit va email/parol bilan BIR formada", () => {
    render(<LoginPageClient {...baseProps} />);
    const button = screen.getByRole("button", {
      name: "Войти",
    }) as HTMLButtonElement;
    expect(button.type).toBe("submit");
    const form = button.closest("form");
    expect(form).not.toBeNull();
    // Email va parol input'lari AYNAN shu forma ichida — Enter native submit
    // qiladi (preventDefault yo'q, onKeyDown handler yo'q).
    const emailInput = screen.getByPlaceholderText("you@example.com");
    const passInput = screen.getByPlaceholderText("Пароль");
    expect(emailInput.closest("form")).toBe(form);
    expect(passInput.closest("form")).toBe(form);
  });

  // ── W3-T7 — past ekran (≈720px): sahifa vertikal scroll qila olishi ──
  it("login-root vertikal scroll'ni bloklamaydi (overflow-x, hidden emas)", () => {
    render(<LoginPageClient {...baseProps} />);
    const style = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    // overflow: hidden butun sahifani kesib tashlardi — endi faqat overflow-x.
    expect(style).not.toMatch(/\.login-root\s*{[^}]*overflow:\s*hidden/);
    expect(style).toContain("overflow-x: hidden");
  });

  // ── W3-T7 fix — logo qat'iy 400x400 quti; slot qisqarganda CHIQIB ketmasin ──
  // Bu HAQIQIY kaskad tekshiruvi: jsdom `getComputedStyle` hujjatdagi
  // <style> qoidalarini qo'llaydi, ya'ni selektor noto'g'ri bo'lsa yoki qoida
  // yo'qolsa — test yiqiladi (satr qidirish emas).
  it("logo qutisi slot ichida qoladi (max-width/max-height cheklovi kuchda)", () => {
    render(<LoginPageClient {...baseProps} />);
    const logo = document.querySelector(
      '[data-variant="breathing"], [data-variant="static"], [data-variant="glow"]',
    ) as HTMLElement | null;
    expect(logo).not.toBeNull();
    // Inline o'lcham hamon 400px — cheklovsiz bo'lsa 200px slotdan 200px
    // chiqib ketardi (sfera wordmark ustiga tushardi).
    expect(logo!.style.width).toBe("400px");
    expect(logo!.style.height).toBe("400px");
    // Kaskad natijasi: quti slotdan katta bo'la olmaydi.
    const cs = getComputedStyle(logo!);
    expect(cs.maxWidth).toBe("100%");
    expect(cs.maxHeight).toBe("100%");
    // SVG ham qat'iy 400 atributidan voz kechadi (viewBox proporsiyani saqlaydi).
    const svg = logo!.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(getComputedStyle(svg as Element).width).toBe("100%");
    expect(getComputedStyle(svg as Element).height).toBe("100%");
  });

  // ── W3-T7 fix — media-query tartibi: past-ekran bloki telefon qoidalarini
  // BOSMASLIGI kerak. jsdom @media'ni hisoblamaydi, shuning uchun CSSOM'ni
  // manba tartibida o'zimiz yuramiz va berilgan viewport uchun g'olib
  // qiymatni chiqaramiz (bir xil specificity → oxirgi mos qoida yutadi).
  it("media qoidalari: past laptop qisqaradi, telefon sozlamalari buzilmaydi", () => {
    render(<LoginPageClient {...baseProps} />);
    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n")
      // Izohlar blok boshini yashirmasin.
      .replace(/\/\*[\s\S]*?\*\//g, "");

    function mediaMatches(condition: string, w: number, h: number): boolean {
      const parts = condition.split(/\s+and\s+/);
      return parts.every((raw) => {
        const m = raw
          .trim()
          .match(/^\((max|min)-(width|height):\s*(\d+)px\)$/);
        if (!m) return false;
        const value = Number(m[3]);
        const actual = m[2] === "width" ? w : h;
        return m[1] === "max" ? actual <= value : actual >= value;
      });
    }

    // `selector { decls }` bloklarini media konteksti bilan tartibda yig'amiz.
    function collect(
      source: string,
      media: string | null,
    ): { media: string | null; selector: string; body: string }[] {
      const out: { media: string | null; selector: string; body: string }[] = [];
      let i = 0;
      while (i < source.length) {
        const open = source.indexOf("{", i);
        if (open === -1) break;
        const head = source.slice(i, open).trim();
        // Mos yopuvchi qavsni topamiz (media bloklari ichma-ich).
        let depth = 1;
        let j = open + 1;
        while (j < source.length && depth > 0) {
          if (source[j] === "{") depth += 1;
          else if (source[j] === "}") depth -= 1;
          j += 1;
        }
        const body = source.slice(open + 1, j - 1);
        if (head.startsWith("@media")) {
          out.push(...collect(body, head.replace(/^@media\s*/, "").trim()));
        } else if (head && !head.startsWith("@")) {
          out.push({ media, selector: head, body });
        }
        i = j;
      }
      return out;
    }

    const blocks = collect(css, null);

    function resolve(
      selector: string,
      prop: string,
      w: number,
      h: number,
    ): string | null {
      let winner: string | null = null;
      for (const b of blocks) {
        if (b.selector !== selector) continue;
        if (b.media !== null && !mediaMatches(b.media, w, h)) continue;
        const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(b.body)) !== null) winner = m[1].trim();
      }
      return winner;
    }

    // Katta monitor (1440x900) — asosiy qiymatlar.
    expect(resolve(".login-logo-slot", "height", 1440, 900)).toBe("48vh");
    expect(resolve(".login-wordmark", "font-size", 1440, 900)).toBe("44px");

    // Past laptop (1280x720) — qisqartirilgan qiymatlar KUCHDA.
    expect(resolve(".login-logo-slot", "height", 1280, 720)).toBe("26vh");
    expect(resolve(".login-logo-slot", "max-height", 1280, 720)).toBe("200px");
    expect(resolve(".login-wordmark", "font-size", 1280, 720)).toBe("32px");
    expect(resolve(".login-card", "padding", 1280, 720)).toBe("24px 28px");

    // Telefon (375x667 — iPhone SE/8 klass, bo'yi 760px dan PAST):
    // past-ekran bloki bu yerga TEGMASLIGI shart, aks holda mobil sozlamalar
    // (38vh slot, 36px wordmark, 28px 20px karta) yo'qoladi — regressiya.
    expect(resolve(".login-logo-slot", "height", 375, 667)).toBe("38vh");
    expect(resolve(".login-logo-slot", "max-height", 375, 667)).toBe("320px");
    expect(resolve(".login-wordmark", "font-size", 375, 667)).toBe("36px");
    expect(resolve(".login-card", "padding", 375, 667)).toBe("28px 20px");
  });
});
