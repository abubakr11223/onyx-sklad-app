// Onyx — OWNER bootstrap CLI (prod, pm2).
// uz: Bo'sh production bazasiga BITTA OWNER akkaunt yaratadi. seed:demo'dan farqi —
//     demo toshlar/foydalanuvchilar YARATILMAYDI, faqat OWNER. Zaif sukut-parol YO'Q:
//     operator email + kuchli parolni argv yoki env orqali beradi.
//     Ishga tushirish:
//       npm run seed:owner -- --email=owner@onyx.uz --password='StrongPass123'
//       OWNER_EMAIL=owner@onyx.uz OWNER_PASSWORD='StrongPass123' npm run seed:owner
// ru: Создаёт ОДНОГО владельца (OWNER) в пустой prod-базе. В отличие от seed:demo,
//     не создаёт демо-камни/пользователей. Слабого пароля по умолчанию НЕТ.
//
// Idempotent: shu email'li OWNER allaqachon bo'lsa — faqat --force bilan
// passwordHash/isActive yangilanadi, aks holda o'tkazib yuboriladi.
// ⚠️ Parol HECH QACHON loglanmaydi — faqat OWNER id + email chiqadi.
import { PrismaClient } from "@prisma/client";
import { hashUserPassword } from "../src/lib/password";
import {
  parseOwnerArgs,
  validateOwnerArgs,
  usageText,
} from "../src/lib/seed-owner";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const raw = parseOwnerArgs(process.argv.slice(2));
  const parsed = validateOwnerArgs(raw);

  if (!parsed.ok) {
    if (parsed.error === "usage") {
      console.error("OWNER email berilmadi.\n");
      console.error(usageText());
    } else if (parsed.error === "email") {
      console.error("Email formati yaroqsiz.\n");
      console.error(usageText());
    } else {
      console.error("Parol yo'q yoki juda qisqa.\n");
      console.error(usageText());
    }
    process.exitCode = 1;
    return;
  }

  const { email, password, name, force } = parsed;

  // email @unique — shu email'li istalgan foydalanuvchini topamiz.
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && existing.role !== "OWNER") {
    console.error(
      `Xato: '${email}' boshqa rol (${existing.role}) tomonidan band. To'xtatildi.`,
    );
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashUserPassword(password);

  if (existing) {
    if (!force) {
      console.log(
        `OWNER '${email}' allaqachon mavjud (id=${existing.id}). ` +
          "O'zgartirish uchun --force qo'shing. O'tkazib yuborildi.",
      );
      return;
    }
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, isActive: true },
    });
    console.log(`OWNER paroli yangilandi: id=${updated.id}, email=${email}`);
    return;
  }

  const created = await prisma.user.create({
    data: {
      name,
      role: "OWNER",
      email,
      passwordHash,
      isActive: true,
      canSeePurchasePrice: true, // OWNER baribir doim ko'radi
    },
  });
  console.log(`OWNER yaratildi: id=${created.id}, email=${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
