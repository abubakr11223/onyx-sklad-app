// W12-A — inventory purge CLI (production-safe gates).
//
// uz: Test/demo ombor ma'lumotini o'chirish. Standart — DRY-RUN (faqat hisob).
//     Yozish uchun to'rtta shart: env + --scope + --execute + --yes.
// ru: Очистка тестовых/демо складских данных. По умолчанию DRY-RUN.
//
//   Dry-run:
//     ONYX_PURGE_ALLOW=I_UNDERSTAND_IRREVERSIBLE npm run purge:inventory -- --scope=P
//   Execute:
//     ONYX_PURGE_ALLOW=I_UNDERSTAND_IRREVERSIBLE npm run purge:inventory -- --scope=P --execute --yes
//
// ⛔ DATABASE_URL often points at LIVE Neon. This tool never soft-deletes.
//    There is no undo. Prefer scope P for stuck fotozapros; A then B for demo stock;
//    C wipes /istoriya + debts.
//
// Does NOT open a connection until args + env gates pass.

import { PrismaClient } from "@prisma/client";
import {
  executePurgeClient,
  formatPlanReport,
  parsePurgeArgs,
  planPurgeClient,
  usageText,
  validatePurgeArgs,
  PURGE_ALLOW_ENV,
  PURGE_ALLOW_VALUE,
} from "../src/lib/purge";

async function main(): Promise<void> {
  const raw = parsePurgeArgs(process.argv.slice(2));
  const parsed = validatePurgeArgs(raw);

  if (!parsed.ok) {
    if (parsed.error === "env") {
      console.error(
        `⛔ Refusing to run: set ${PURGE_ALLOW_ENV}=${PURGE_ALLOW_VALUE}\n` +
          "   (prevents muscle-memory wipe of production).\n",
      );
    } else if (parsed.error === "scope") {
      console.error(
        "⛔ --scope=A|B|C|P is required. No default scope that deletes.\n",
      );
    } else if (parsed.error === "confirm") {
      console.error(
        "⛔ --execute requires --yes after you have read the dry-run counts.\n" +
          "   First run without --execute to print the plan.\n",
      );
    } else {
      console.error("Usage error.\n");
    }
    console.error(usageText());
    process.exitCode = 1;
    return;
  }

  // Connect only after gates pass (still may be production — operator chose env).
  const prisma = new PrismaClient();
  try {
    const plan = await planPurgeClient(prisma, parsed.scope);
    console.log(formatPlanReport(plan));

    if (!parsed.willWrite) {
      console.log("");
      console.log(
        "DRY-RUN only — nothing was deleted. To execute after reviewing counts:",
      );
      console.log(
        `  ${PURGE_ALLOW_ENV}=${PURGE_ALLOW_VALUE} npm run purge:inventory -- --scope=${parsed.scope} --execute --yes`,
      );
      return;
    }

    console.log("");
    console.log(
      "⚠  WRITE MODE: irreversible deletes will run in one transaction.",
    );
    const result = await executePurgeClient(prisma, parsed.scope, (m) =>
      console.log(m),
    );
    console.log("");
    console.log("Purge finished:", {
      scope: result.scope,
      ms: result.ms,
      auditLogged: result.auditLogged,
      deleted: result.deleted,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
