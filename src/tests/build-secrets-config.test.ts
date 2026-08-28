import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../next.config";

// T6-build-secrets: sirlar (.env, zaxira tarball'lari) build artefaktlariga
// va Docker build kontekstiga tushmasligi kerak.

const dockerignoreLines = readFileSync(join(process.cwd(), ".dockerignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));

describe(".dockerignore — sirlar build kontekstiga tushmaydi", () => {
  it(".env va .env.* chiqarib tashlangan", () => {
    expect(dockerignoreLines).toContain(".env");
    expect(dockerignoreLines).toContain(".env.*");
  });

  it("tarball'lar ICHKI papkalarda ham chiqarib tashlangan (**/ prefiks shart)", () => {
    // Docker'da oddiy `*.tgz` faqat kontekst ildiziga mos keladi
    // (Go filepath.Match semantikasi) — `_to_delete/tz18-src.tgz` kabi
    // ichki tarball'lar (ichida jonli .env sirlar bor) kontekstga tushardi.
    expect(dockerignoreLines).toContain("**/*.tar.gz");
    expect(dockerignoreLines).toContain("**/*.tgz");
    // Regressiya: ildiz-only variantlar qaytib kelmasin.
    expect(dockerignoreLines).not.toContain("*.tar.gz");
    expect(dockerignoreLines).not.toContain("*.tgz");
  });

  it("backups va _to_delete papkalari chiqarib tashlangan", () => {
    expect(dockerignoreLines).toContain("backups");
    expect(dockerignoreLines).toContain("_to_delete");
  });
});

describe("next.config — standalone tracing sirlarni chiqarib tashlaydi", () => {
  it("output: standalone", () => {
    expect(nextConfig.output).toBe("standalone");
  });

  it("outputFileTracingExcludes '*' kaliti sirlar va tarball'larni qamrab oladi", () => {
    const excludes = nextConfig.outputFileTracingExcludes?.["*"] ?? [];
    expect(excludes).toContain("backups/**");
    expect(excludes).toContain("_to_delete/**");
    expect(excludes).toContain(".env*");
    expect(excludes).toContain("*.tar.gz");
    expect(excludes).toContain("*.tgz");
  });
});
