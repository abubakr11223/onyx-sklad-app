// W3-T2 — заявка/квитанция «боя по фото» (без БД, поддельный клиент).
// Доказывает: дубль не получает права на запись; повтор после успеха отдаёт тот
// же кусок; снятая заявка снова открывает запись.
import { describe, expect, it, vi } from "vitest";
import {
  claimSinganPiece,
  completeSinganPiece,
  releaseSinganPiece,
  SINGAN_MUTATION_KIND,
  type SinganReceiptClient,
} from "@/app/singan/singan-receipt";

const MUT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function makeClient() {
  const rows = new Map<string, { entityId: string; resultJson: unknown }>();
  const create = vi.fn(
    async (args: {
      data: {
        mutationId: string;
        kind: string;
        entityId: string;
        resultJson?: unknown;
      };
    }) => {
      if (rows.has(args.data.mutationId)) {
        throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      }
      rows.set(args.data.mutationId, {
        entityId: args.data.entityId,
        resultJson: args.data.resultJson ?? null,
      });
      return args.data;
    },
  );
  const client = {
    mutationReceipt: {
      findUnique: vi.fn(async ({ where }: { where: { mutationId: string } }) =>
        rows.get(where.mutationId) ?? null,
      ),
      create,
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { mutationId: string };
          data: { entityId: string; resultJson: unknown };
        }) => {
          rows.set(where.mutationId, {
            entityId: data.entityId,
            resultJson: data.resultJson,
          });
          return data;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { mutationId: string } }) => {
        rows.delete(where.mutationId);
        return {};
      }),
    },
  } as unknown as SinganReceiptClient;
  return { client, rows, create };
}

describe("claimSinganPiece", () => {
  it("свежий mutationId → заявка наша (kind = SINGAN_PIECE)", async () => {
    const { client, create } = makeClient();
    const claim = await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    expect(claim.status).toBe("fresh");
    expect(create.mock.calls[0][0].data.kind).toBe(SINGAN_MUTATION_KIND);
  });

  it("второй заход, пока кусок не записан → in_flight (второй раз не пишем)", async () => {
    const { client } = makeClient();
    await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    const second = await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    expect(second.status).toBe("in_flight");
  });

  it("после завершения → done с тем же pieceId и данными экрана успеха", async () => {
    const { client } = makeClient();
    await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    await completeSinganPiece(client, {
      mutationId: MUT,
      pieceId: "piece-1",
      result: { stoneTypeId: "stone-1", causeLabel: "Перемещение", photoSaved: true },
    });
    const replay = await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    expect(replay).toEqual({
      status: "done",
      pieceId: "piece-1",
      result: {
        stoneTypeId: "stone-1",
        causeLabel: "Перемещение",
        photoSaved: true,
      },
    });
  });

  it("гонка: create проиграл (P2002) → in_flight, а не вторая запись", async () => {
    const { client, rows } = makeClient();
    // findUnique говорит «пусто», а create уже натыкается на победителя —
    // ровно то, что видит второй запрос при двойном касании.
    const mr = client.mutationReceipt as unknown as {
      findUnique: ReturnType<typeof vi.fn>;
    };
    mr.findUnique.mockImplementationOnce(async () => null);
    rows.set(MUT, { entityId: "", resultJson: null });
    const claim = await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    expect(claim.status).toBe("in_flight");
  });

  it("квитанция без photoSaved → фото НЕ считается сохранённым (не врём зелёным)", async () => {
    const { client, rows } = makeClient();
    rows.set(MUT, { entityId: "piece-9", resultJson: { stoneTypeId: "s9" } });
    const claim = await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    expect(claim).toMatchObject({
      status: "done",
      result: { photoSaved: false, stoneTypeId: "s9" },
    });
  });
});

describe("releaseSinganPiece", () => {
  it("снятая заявка снова открывает запись тем же mutationId", async () => {
    const { client } = makeClient();
    await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    await releaseSinganPiece(client, MUT);
    const again = await claimSinganPiece(client, { mutationId: MUT, userId: "u1" });
    expect(again.status).toBe("fresh");
  });

  it("сбой удаления не бросает (исходная ошибка важнее)", async () => {
    const { client } = makeClient();
    const mr = client.mutationReceipt as unknown as {
      delete: ReturnType<typeof vi.fn>;
    };
    mr.delete.mockRejectedValueOnce(new Error("db down"));
    await expect(releaseSinganPiece(client, MUT)).resolves.toBeUndefined();
  });
});
