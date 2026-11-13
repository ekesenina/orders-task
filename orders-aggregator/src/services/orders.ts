import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository } from "../repositories/orders.js";
import { parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  discountPercent: z.union([z.number(), z.string()]).optional(),
  amountPaid: z.union([z.number(), z.string()]).optional(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = "created" | "updated" | "stale";

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new ValidationError(`invalid order: ${fields}`);
    }
    const order = parsed.data;
    try {
      const amountKop = toKop(parseRub(order.amount));
      const discountPercent = order.discountPercent === undefined ? 0 : parseRub(order.discountPercent);
      if (discountPercent > 100) throw new Error("discountPercent must be between 0 and 100");
      if (order.amountPaid === undefined && discountPercent > 0) {
        throw new Error("amountPaid is required for discounted orders");
      }

      // Оплату берём из API: пересчёт по проценту может дать другую копейку.
      // В старых заказах обоих полей нет, их считаем без скидки.
      const amountPaidKop = order.amountPaid === undefined ? amountKop : toKop(parseRub(order.amountPaid));
      if (amountPaidKop > amountKop) throw new Error("amountPaid must not exceed amount");

      return {
        id: order.id,
        customerId: order.customerId,
        amountKop,
        amountPaidKop,
        status: order.status,
        createdAt: parseUtc(order.createdAt),
        updatedAt: parseUtc(order.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Повторы и старые версии не сохраняем. После миграции можно один раз
   * дополнить запись оплатой, даже если updatedAt не изменился.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    return this.orders.save(this.normalize(raw));
  }
}
