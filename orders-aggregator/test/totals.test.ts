import { describe, expect, it, vi } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-09", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 },
      { date: "2026-02-11", total: 349, gross: 349, discount: 0, net: 349 },
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 500, gross: 500, discount: 0, net: 500 }]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 800, gross: 800, discount: 0, net: 800 }]);
  });

  it("считает скидки и старые заказы вместе, без потери копеек", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 2500, discountPercent: 16.5, amountPaid: 2087.5 }));
    await postWebhook(ctx.app, apiOrder({ amount: "1.15", discountPercent: "7", amountPaid: "1.07" }));
    await postWebhook(ctx.app, apiOrder({ amount: 10 }));
    await postWebhook(ctx.app, apiOrder({ amount: 100, discountPercent: 50, amountPaid: 50, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 100, discountPercent: 50, amountPaid: 50, status: "refunded" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 2511.15, gross: 2511.15, discount: 412.58, net: 2098.57 },
      { date: "2026-02-11", total: 0, gross: 0, discount: 0, net: 0 },
    ]);
  });

  it("берёт фактическую оплату, даже если процент даёт другую сумму", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 100, discountPercent: 33, amountPaid: 66.66 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 100, gross: 100, discount: 33.34, net: 66.66 }]);
  });

  it("учитывает полную скидку и заказ на нулевую сумму", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 100, discountPercent: 100, amountPaid: 0 }));
    await postWebhook(ctx.app, apiOrder({ amount: 0, discountPercent: 0, amountPaid: 0 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 100, gross: 100, discount: 100, net: 0 }]);
  });

  it("обновляет скидку в статистике после нового вебхука", async () => {
    const order = apiOrder({ amount: 100, discountPercent: 10, amountPaid: 90 });
    await postWebhook(ctx.app, order);
    await postWebhook(ctx.app, { ...order, discountPercent: 25, amountPaid: 75, updatedAt: "2026-02-11T00:00:00Z" });
    await postWebhook(ctx.app, order);
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 100, gross: 100, discount: 25, net: 75 }]);
  });

  it.each(["2026-01-15T12:00:00Z", "2026-07-15T12:00:00Z"])(
    "учитывает 23-часовой день в Берлине независимо от текущей даты (%s)",
    async (now) => {
      ctx.api.customers.set("c_7", "Europe/Berlin");
      const orders = [
        ["2026-03-27T22:59:59.999Z", 1000],
        ["2026-03-27T23:00:00Z", 1],
        ["2026-03-28T22:30:00Z", 2],
        ["2026-03-28T23:00:00Z", 4],
        ["2026-03-29T00:59:59.999Z", 8],
        ["2026-03-29T01:00:00Z", 16],
        ["2026-03-29T21:59:59.999Z", 32],
        ["2026-03-29T22:00:00Z", 64],
        ["2026-03-30T21:59:59.999Z", 128],
        ["2026-03-30T22:00:00Z", 2000],
      ] as const;
      for (const [createdAt, amount] of orders) {
        await postWebhook(ctx.app, apiOrder({ customerId: "c_7", createdAt, amount }));
      }

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(now));
      try {
        const res = await dailyTotals(ctx.app, "c_7", "2026-03-28", "2026-03-30");
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([
          { date: "2026-03-28", total: 3, gross: 3, discount: 0, net: 3 },
          { date: "2026-03-29", total: 60, gross: 60, discount: 0, net: 60 },
          { date: "2026-03-30", total: 192, gross: 192, discount: 0, net: 192 },
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("учитывает обе версии повторяющегося часа при осеннем переводе часов", async () => {
    ctx.api.customers.set("c_7", "Europe/Berlin");
    const orders = [
      ["2026-10-23T21:59:59.999Z", 1000],
      ["2026-10-23T22:00:00Z", 1],
      ["2026-10-24T21:59:59.999Z", 2],
      ["2026-10-24T22:00:00Z", 4],
      ["2026-10-25T00:30:00Z", 8],
      ["2026-10-25T01:30:00Z", 16],
      ["2026-10-25T22:59:59.999Z", 32],
      ["2026-10-25T23:00:00Z", 64],
      ["2026-10-26T22:59:59.999Z", 128],
      ["2026-10-26T23:00:00Z", 2000],
    ] as const;
    for (const [createdAt, amount] of orders) {
      await postWebhook(ctx.app, apiOrder({ customerId: "c_7", createdAt, amount }));
    }
    const res = await dailyTotals(ctx.app, "c_7", "2026-10-24", "2026-10-26");
    expect(res.json()).toEqual([
      { date: "2026-10-24", total: 3, gross: 3, discount: 0, net: 3 },
      { date: "2026-10-25", total: 60, gross: 60, discount: 0, net: 60 },
      { date: "2026-10-26", total: 192, gross: 192, discount: 0, net: 192 },
    ]);
  });

  it.each([
    ["America/New_York", "2026-02-10T05:00:00Z", "2026-02-11T05:00:00Z"],
    ["Asia/Kathmandu", "2026-02-09T18:15:00Z", "2026-02-10T18:15:00Z"],
  ])("проверяет границы дня в %s", async (timezone, from, to) => {
    ctx.api.customers.set("c_2", timezone);
    const orders = [
      [new Date(Date.parse(from) - 1).toISOString(), 1000],
      [from, 1],
      [new Date(Date.parse(to) - 1).toISOString(), 2],
      [to, 2000],
    ] as const;
    for (const [createdAt, amount] of orders) {
      await postWebhook(ctx.app, apiOrder({ customerId: "c_2", createdAt, amount }));
    }
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 3, gross: 3, discount: 0, net: 3 }]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-13-01", "2026-13-02")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "0000-01-01", "0000-01-02")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });
});
