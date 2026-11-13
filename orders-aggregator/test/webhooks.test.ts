import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    { amountPaid: -1 },
    { amountPaid: 1001 },
    { amountPaid: "" },
    { amountPaid: "abc" },
    { amountPaid: null },
    { discountPercent: -1, amountPaid: 900 },
    { discountPercent: 101, amountPaid: 0 },
    { discountPercent: "abc", amountPaid: 900 },
    { discountPercent: "", amountPaid: 900 },
    { discountPercent: 10 },
    { amount: "" },
    { amount: Number.MAX_SAFE_INTEGER },
  ])("отклоняет неверные суммы и скидки: %j", async (fields) => {
    const res = await postWebhook(ctx.app, apiOrder(fields));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "bad_request" });
    const { rows } = await ctx.db.query(`SELECT count(*)::int AS count FROM orders`);
    expect(rows[0].count).toBe(0);
  });

  it("при одновременных повторах создаёт заказ только один раз", async () => {
    const order = apiOrder({ amount: 100, amountPaid: 80, discountPercent: 20 });
    const responses = await Promise.all(Array.from({ length: 20 }, () => postWebhook(ctx.app, order)));
    expect(responses.every((res) => res.statusCode === 200)).toBe(true);
    expect(responses.filter((res) => res.json().result === "created")).toHaveLength(1);
    expect(responses.filter((res) => res.json().result === "stale")).toHaveLength(19);
  });

  it("при одновременных обновлениях сохраняет самую свежую версию", async () => {
    const order = apiOrder({ amount: 100, amountPaid: 100 });
    await postWebhook(ctx.app, order);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => postWebhook(ctx.app, {
      ...order,
      amountPaid: 80 + index,
      updatedAt: new Date(Date.parse("2026-02-11T00:00:00Z") - index * 1000).toISOString(),
    })));
    expect(responses.every((res) => res.statusCode === 200)).toBe(true);
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop, updated_at FROM orders WHERE id = $1`, [order.id]);
    expect(rows[0].amount_paid_kop).toBe("8000");
    expect(rows[0].updated_at.toISOString()).toBe("2026-02-11T00:00:00.000Z");
  });

  it("после миграции дополняет старую запись оплатой при том же updatedAt", async () => {
    const order = apiOrder({ amount: 100, amountPaid: 80, discountPercent: 20 });
    await ctx.db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at)
       VALUES ($1, $2, 10000, 'paid', $3, $4)`,
      [order.id, order.customerId, order.createdAt, order.updatedAt],
    );
    const before = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(before.json()).toEqual([{ date: "2026-02-10", total: 100, gross: 100, discount: 0, net: 100 }]);

    const stale = await postWebhook(ctx.app, { ...order, updatedAt: "2026-02-09T12:00:00Z" });
    expect(stale.json()).toEqual({ result: "stale" });
    expect((await postWebhook(ctx.app, order)).json()).toEqual({ result: "updated" });
    expect((await postWebhook(ctx.app, order)).json()).toEqual({ result: "stale" });
    const after = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(after.json()).toEqual([{ date: "2026-02-10", total: 100, gross: 100, discount: 20, net: 80 }]);
  });
});
