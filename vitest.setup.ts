import { vi } from "vitest";

// next/font/google loaders (Montserrat/Lora) — bular Next SWC kompilyatsiya-vaqti
// stublari. Vitest ostida (environment "node", Next transform yo'q) ularni chaqirish
// "X is not a function" beradi. layout.tsx ularni modul-darajasida chaqiradi va
// smoke.test.ts layout'ni import qiladi — shuning uchun global mock: next/font
// qaytaradigan { variable, className } shaklini qaytaramiz. UI/dizaynга ta'sir yo'q
// (test faqat metadata/tuzilishni tekshiradi).
vi.mock("next/font/google", () => ({
  Montserrat: () => ({ variable: "--font-montserrat", className: "" }),
  Lora: () => ({ variable: "--font-lora", className: "" }),
}));
