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

  it("prefers-reduced-motion → forma va layout render qilinadi (sfera hero-vizual, doim ko'rinadi)", () => {
    // TZ №8 v3 — sfera hero-vizual; foydalanuvchi so'raganidek doim 3D
    // (referens'ga aynan mos). Reduced-motion faqat framer-motion
    // transitionlarini o'chiradi, sfera fon'ga tegmaydi. Form to'liq
    // interaktiv qoladi.
    mockMatchMedia((q) => q.includes("prefers-reduced-motion"));
    render(<LoginPageClient {...baseProps} />);
    expect(screen.getByPlaceholderText("you@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Войти" })).toBeTruthy();
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
});
