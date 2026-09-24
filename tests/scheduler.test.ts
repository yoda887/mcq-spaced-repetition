import { describe, expect, it } from "vitest";
import { difficultyToEase, easeToDifficulty, previewSchedules, sanitizeSchedulerSettings, toFsrsCard } from "../src/scheduler";
import { calculateNextReview } from "../src/SM2";

const now = new Date(2026, 8, 24, 12, 0, 0);
const fsrsSettings = sanitizeSchedulerSettings({ algorithm: "fsrs", desiredRetention: 0.9, maximumInterval: 365 });

describe("SM-2", () => {
  it("Again сбрасывает интервал до 1 дня и снижает ease", () => {
    expect(calculateNextReview(2.5, 30, "Again")).toEqual({ ease: 2.3, interval: 1 });
  });
  it("Good у новой карточки — 1 день, затем 3", () => {
    expect(calculateNextReview(2.5, 0, "Good").interval).toBe(1);
    expect(calculateNextReview(2.5, 1, "Good").interval).toBe(3);
  });
});

describe("FSRS", () => {
  it("интервалы растут от Again к Easy", () => {
    const p = previewSchedules({ nextReview: 0, interval: 0, ease: 2.5, fsrs: null }, fsrsSettings, now);
    expect(p.Again.interval).toBeGreaterThanOrEqual(1);
    expect(p.Again.interval).toBeLessThanOrEqual(p.Hard.interval);
    expect(p.Hard.interval).toBeLessThanOrEqual(p.Good.interval);
    expect(p.Good.interval).toBeLessThan(p.Easy.interval);
    expect(p.Good.fsrs).not.toBeNull();
    expect(p.Good.fsrs.reps).toBe(1);
  });

  it("дата следующего повтора — полночь через interval дней", () => {
    const p = previewSchedules({ nextReview: 0, interval: 0, ease: 2.5, fsrs: null }, fsrsSettings, now);
    const expected = new Date(2026, 8, 24 + p.Good.interval).getTime();
    expect(p.Good.nextReview).toBe(expected);
  });

  it("карточка из SM-2 переносится по интервалу и ease", () => {
    const card = toFsrsCard({ nextReview: new Date(2026, 8, 24).getTime(), interval: 10, ease: 2.5 }, now);
    expect(card.stability).toBe(10);
    expect(card.state).toBe(2);
    expect(card.last_review.getTime()).toBe(new Date(2026, 8, 14).getTime());
  });

  it("Again увеличивает число провалов", () => {
    const p = previewSchedules({ nextReview: now.getTime(), interval: 10, ease: 2.5, fsrs: null }, fsrsSettings, now);
    expect(p.Again.fsrs.lapses).toBe(1);
    expect(p.Again.interval).toBeLessThan(10);
  });

  it("соблюдает максимальный интервал", () => {
    const settings = sanitizeSchedulerSettings({ algorithm: "fsrs", desiredRetention: 0.9, maximumInterval: 20 });
    const p = previewSchedules({ nextReview: now.getTime(), interval: 100, ease: 3, fsrs: null }, settings, now);
    expect(p.Easy.interval).toBeLessThanOrEqual(20);
  });

  it("ease и сложность согласованы", () => {
    expect(difficultyToEase(easeToDifficulty(2.5))).toBeCloseTo(2.5, 1);
    expect(easeToDifficulty(3.5)).toBe(1);
    expect(easeToDifficulty(1.3)).toBe(10);
  });
});

describe("настройки", () => {
  it("исправляют недопустимые значения", () => {
    expect(sanitizeSchedulerSettings({ algorithm: "x" as never, desiredRetention: 5, maximumInterval: -3 })).toEqual({
      algorithm: "fsrs",
      desiredRetention: 0.97,
      maximumInterval: 1
    });
  });
});
