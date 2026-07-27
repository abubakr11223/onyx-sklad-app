// TZ №8 v2 §5 — /login uchun typografiya (Lora + Montserrat).
// next/font/google: self-hosted (external network yo'q), display:swap (CLS himoyasi).
// Faqat /login route'ida import qilinadi — boshqa sahifalar font bundle'iga tegmaydi.
import { Lora, Montserrat } from "next/font/google";

// "ONYX" wordmark — Lora 400 (regular). Latin sub-set yetadi (matn faqat "ONYX").
export const loraWordmark = Lora({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-lora-wordmark",
});

// "stones boutique" subtitle — Montserrat 300 (light). Latin sub-set yetadi.
export const montserratTag = Montserrat({
  subsets: ["latin"],
  weight: ["300"],
  display: "swap",
  variable: "--font-montserrat-tag",
});
