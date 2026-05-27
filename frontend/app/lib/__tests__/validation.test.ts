import {
  clampNotes,
  isFiniteInRange,
  isValidPastDate,
  isValidPrice,
  isValidQuantity,
  NOTES_MAX_LEN,
  PRICE_MAX,
  QUANTITY_MAX,
  stripControlChars,
} from "../validation";

describe("isFiniteInRange", () => {
  it("accepts finite numbers in range", () => {
    expect(isFiniteInRange(5, 0, 10)).toBe(true);
    expect(isFiniteInRange(0, 0, 10)).toBe(true);
    expect(isFiniteInRange(10, 0, 10)).toBe(true);
  });
  it("rejects out-of-range", () => {
    expect(isFiniteInRange(-1, 0, 10)).toBe(false);
    expect(isFiniteInRange(11, 0, 10)).toBe(false);
  });
  it("rejects Infinity and NaN", () => {
    expect(isFiniteInRange(Infinity, 0, 10)).toBe(false);
    expect(isFiniteInRange(-Infinity, 0, 10)).toBe(false);
    expect(isFiniteInRange(NaN, 0, 10)).toBe(false);
  });
  it("rejects non-numbers", () => {
    expect(isFiniteInRange("5" as unknown, 0, 10)).toBe(false);
    expect(isFiniteInRange(null, 0, 10)).toBe(false);
    expect(isFiniteInRange(undefined, 0, 10)).toBe(false);
  });
});

describe("isValidQuantity", () => {
  it("requires positive integer in bounds", () => {
    expect(isValidQuantity(1)).toBe(true);
    expect(isValidQuantity(100_000)).toBe(true);
    expect(isValidQuantity(0)).toBe(false);
    expect(isValidQuantity(-1)).toBe(false);
    expect(isValidQuantity(QUANTITY_MAX + 1)).toBe(false);
    expect(isValidQuantity(1.5)).toBe(false);
    expect(isValidQuantity(Infinity)).toBe(false);
  });
});

describe("isValidPrice", () => {
  it("accepts non-negative finite up to ceiling", () => {
    expect(isValidPrice(0)).toBe(true);
    expect(isValidPrice(100.5)).toBe(true);
    expect(isValidPrice(PRICE_MAX)).toBe(true);
    expect(isValidPrice(-1)).toBe(false);
    expect(isValidPrice(PRICE_MAX + 1)).toBe(false);
    expect(isValidPrice(Infinity)).toBe(false);
    expect(isValidPrice(NaN)).toBe(false);
  });
});

describe("clampNotes", () => {
  it("returns null for empty/whitespace/null", () => {
    expect(clampNotes("")).toBeNull();
    expect(clampNotes("   ")).toBeNull();
    expect(clampNotes(null)).toBeNull();
    expect(clampNotes(undefined)).toBeNull();
  });
  it("trims and truncates", () => {
    expect(clampNotes("  hello  ")).toBe("hello");
    const long = "a".repeat(NOTES_MAX_LEN + 100);
    expect(clampNotes(long)).toHaveLength(NOTES_MAX_LEN);
  });
});

describe("isValidPastDate", () => {
  it("rejects malformed", () => {
    expect(isValidPastDate("not-a-date")).toBe(false);
    expect(isValidPastDate("2024-13-45")).toBe(false);
    expect(isValidPastDate(null as unknown)).toBe(false);
  });
  it("accepts a past date", () => {
    expect(isValidPastDate("2000-01-01")).toBe(true);
  });
  it("rejects a future date", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(isValidPastDate(future.toISOString().slice(0, 10))).toBe(false);
  });
});

describe("stripControlChars", () => {
  it("strips CR, LF, NUL, BEL, DEL", () => {
    expect(stripControlChars("ab\r\ncd")).toBe("abcd");
    expect(stripControlChars("a\x00b")).toBe("ab");
    expect(stripControlChars("x\x7Fy")).toBe("xy");
  });
  it("preserves printable ASCII", () => {
    expect(stripControlChars("/foo/bar?x=1")).toBe("/foo/bar?x=1");
  });
});
