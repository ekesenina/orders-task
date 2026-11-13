import { describe, expect, it } from "vitest";
import { fromKop, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
    expect(() => parseRub("")).toThrow();
    expect(() => parseRub("   ")).toThrow();
    expect(() => parseRub(Infinity)).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
    expect(toKop(0.009)).toBe(0);
    expect(toKop(0.0000001)).toBe(0);
  });

  it("не теряет копейки из-за умножения дробных чисел", () => {
    for (let kop = 0; kop <= 10_000; kop++) {
      expect(toKop(kop / 100)).toBe(kop);
    }
  });

  it("не округляет суммы, которые уже нельзя хранить точно", () => {
    expect(() => toKop(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => fromKop(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});
