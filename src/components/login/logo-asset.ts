// Logotip fayli — bitta joyda. Alohida modul, chunki StaticLogo ham,
// LogoSphere3D ham shuni ishlatadi: agar konstanta LogoSphere3D ichida tursa,
// StaticLogo uni import qilgani uchun og'ir 3D moduli asosiy bundle'ga tortilib
// kelardi va `next/dynamic({ ssr:false })` ning ma'nosi yo'qolardi.
//
// Fayl: `public/logo/onyx-sphere.jpg` — 541×541, kompaniyaning haqiqiy
// logotipi, sfera o'lchangan doira bo'yicha kesilgan (markaz 315.45/324.66,
// R 269.27 px). Rasm 4:4:4 sifatida saqlangan — gravyura mayda chiziqlari
// siqilishdan buzilmasin.
export const LOGO_SPHERE_SRC = "/logo/onyx-sphere.jpg";
