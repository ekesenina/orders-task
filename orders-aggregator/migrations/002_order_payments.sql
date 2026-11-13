-- У старых записей оплату ещё не знаем. Повторный синк заполнит её,
-- даже если updatedAt у заказа остался прежним.
ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT
  CHECK (amount_paid_kop >= 0 AND amount_paid_kop <= amount_kop);
