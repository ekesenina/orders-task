import type { Db } from "../db.js";

export interface Order {
  id: string;
  customerId: string;
  amountKop: number;
  amountPaidKop: number;
  status: "pending" | "paid" | "refunded";
  createdAt: Date;
  updatedAt: Date;
}

export interface PaidDailyTotal {
  date: string;
  grossKop: number;
  netKop: number;
}

interface DailyTotalRow {
  date: string;
  gross_kop: string;
  net_kop: string;
}

export class OrdersRepository {
  constructor(private readonly db: Db) {}

  async save(order: Order): Promise<"created" | "updated" | "stale"> {
    const values = [
      order.id, order.customerId, order.amountKop, order.amountPaidKop,
      order.status, order.createdAt, order.updatedAt,
    ];
    const inserted = await this.db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, amount_paid_kop, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      values,
    );
    if (inserted.rowCount) return "created";

    // Версию проверяем в самом UPDATE. Иначе между чтением и записью
    // свежий вебхук может успеть сохранить заказ, а старый синк его затрёт.
    const updated = await this.db.query(
      `UPDATE orders SET
         customer_id = $2, amount_kop = $3, amount_paid_kop = $4,
         status = $5, created_at = $6, updated_at = $7
       WHERE id = $1 AND (
         updated_at < $7 OR (updated_at = $7 AND amount_paid_kop IS NULL)
       )
       RETURNING id`,
      values,
    );
    return updated.rowCount ? "updated" : "stale";
  }

  async paidDailyTotals(customerId: string, from: string, to: string, timezone: string): Promise<PaidDailyTotal[]> {
    // Границы дней и дата заказа считаются в одной IANA-таймзоне.
    // В день перевода часов может быть 23 или 25 часов, поэтому сутки к UTC не прибавляем.
    const { rows } = await this.db.query<DailyTotalRow>(
      `SELECT (created_at AT TIME ZONE $4)::date::text AS date,
              SUM(amount_kop)::text AS gross_kop,
              SUM(COALESCE(amount_paid_kop, amount_kop))::text AS net_kop
       FROM orders
       WHERE customer_id = $1 AND status = 'paid'
         AND created_at >= ($2::date::timestamp AT TIME ZONE $4)
         AND created_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
       GROUP BY 1`,
      [customerId, from, to, timezone],
    );
    return rows.map((row) => ({ date: row.date, grossKop: Number(row.gross_kop), netKop: Number(row.net_kop) }));
  }
}
