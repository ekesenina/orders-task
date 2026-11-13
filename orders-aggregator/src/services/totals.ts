import type { OrdersRepository } from "../repositories/orders.js";
import { fromKop } from "../utils/money.js";
import { datesBetween } from "../utils/time.js";
import type { CustomersService } from "./customers.js";

export interface DailyTotal {
  date: string;
  total: number;
  gross: number;
  discount: number;
  net: number;
}

export class TotalsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Сумма оплаченных заказов клиента по дням в его таймзоне, from..to включительно.
   * Дни без оплат — с нулём.
   */
  async daily(customerId: string, from: string, to: string): Promise<DailyTotal[]> {
    const timezone = await this.customers.timezone(customerId);
    const rows = await this.orders.paidDailyTotals(customerId, from, to, timezone);
    const sums = new Map(rows.map((row) => [row.date, row]));

    return datesBetween(from, to).map((date) => {
      const { grossKop = 0, netKop = 0 } = sums.get(date) ?? {};
      return {
        date,
        total: fromKop(grossKop),
        gross: fromKop(grossKop),
        discount: fromKop(grossKop - netKop),
        net: fromKop(netKop),
      };
    });
  }
}
