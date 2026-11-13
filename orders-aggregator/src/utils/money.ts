/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const trimmed = typeof raw === "string" ? raw.trim() : raw;
  const value = typeof trimmed === "string" && trimmed !== "" ? Number(trimmed) : trimmed;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Рубли переводим в копейки, лишние знаки после запятой отбрасываем. */
export function toKop(rub: number): number {
  if (!Number.isFinite(rub) || rub < 0) throw new Error(`invalid amount: ${rub}`);

  // 1.15 * 100 даёт 114.99999999999999. Разбираем десятичную запись,
  // чтобы не потерять копейку. Маленькие числа могут прийти в виде 1e-7.
  const [mantissa, exponent = "0"] = String(rub).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = BigInt(whole + fraction);
  const shift = Number(exponent) - fraction.length + 2;
  const kop = shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);

  if (kop > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount is too large");
  return Number(kop);
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  if (!Number.isSafeInteger(kop)) throw new Error("amount is too large");
  return kop / 100;
}
