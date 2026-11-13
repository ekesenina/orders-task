import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, migrate, type Db } from "../src/db.js";

describe("миграции", () => {
  let db: Db;
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orders_test";

  beforeAll(() => {
    db = createDb(databaseUrl);
  });

  afterAll(async () => {
    await db?.end();
  });

  it("обновляет старую схему без потери заказов и повторно ничего не меняет", async () => {
    const schema = `migration_${randomUUID().replaceAll("-", "")}`;
    await db.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const legacyDb = createDb(url.toString());

    try {
      const initialSql = await readFile(new URL("../migrations/001_init.sql", import.meta.url), "utf8");
      await legacyDb.query(initialSql);
      await legacyDb.query(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await legacyDb.query(`INSERT INTO schema_migrations (name) VALUES ('001_init.sql')`);
      await legacyDb.query(
        `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at)
         VALUES ('legacy', 'c_1', 115, 'paid', '2026-02-10T12:00:00Z', '2026-02-10T12:00:00Z')`,
      );

      expect(await migrate(legacyDb)).toEqual(["002_order_payments.sql"]);
      const { rows } = await legacyDb.query(`SELECT id, amount_kop, amount_paid_kop FROM orders`);
      expect(rows).toEqual([{ id: "legacy", amount_kop: "115", amount_paid_kop: null }]);
      expect(await migrate(legacyDb)).toEqual([]);
      await expect(legacyDb.query(`UPDATE orders SET amount_paid_kop = 116 WHERE id = 'legacy'`)).rejects.toThrow();
      await expect(legacyDb.query(`UPDATE orders SET amount_paid_kop = -1 WHERE id = 'legacy'`)).rejects.toThrow();
    } finally {
      await legacyDb.end();
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });
});
