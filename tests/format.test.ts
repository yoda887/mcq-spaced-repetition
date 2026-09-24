import { describe, expect, it } from "vitest";
import { formatInterval } from "../src/format";

describe("formatInterval", () => {
  it("до месяца — дни", () => {
    expect(formatInterval(1)).toBe("1 дн");
    expect(formatInterval(29)).toBe("29 дн");
  });
  it("до года — месяцы с одним знаком", () => {
    expect(formatInterval(30)).toBe("1 мес");
    expect(formatInterval(45)).toBe("1,5 мес");
    expect(formatInterval(213)).toBe("7 мес");
  });
  it("больше года — годы", () => {
    expect(formatInterval(365)).toBe("1 г");
    expect(formatInterval(730)).toBe("2 г");
    expect(formatInterval(548)).toBe("1,5 г");
  });
});
