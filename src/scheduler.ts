import { createEmptyCard, fsrs, generatorParameters, Rating as FsrsRating, State, type Card as FsrsCard, type FSRS } from "ts-fsrs";
import { calculateNextReview } from "./SM2";
import type { FsrsState, Rating, Schedule } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const RATINGS: Rating[] = ["Again", "Hard", "Good", "Easy"];
const FSRS_RATING: Record<Rating, FsrsRating.Again | FsrsRating.Hard | FsrsRating.Good | FsrsRating.Easy> = {
  Again: FsrsRating.Again,
  Hard: FsrsRating.Hard,
  Good: FsrsRating.Good,
  Easy: FsrsRating.Easy
};

export interface SchedulerSettings {
  algorithm: "fsrs" | "sm2";
  desiredRetention: number;
  maximumInterval: number;
}

export const DEFAULT_SCHEDULER: SchedulerSettings = {
  algorithm: "fsrs",
  desiredRetention: 0.9,
  maximumInterval: 365
};

/** Новое расписание карточки после оценки. */
export interface ScheduleResult extends Schedule {
  fsrs: FsrsState | null;
}

/** Локальная полночь указанного дня. */
function startOfDay(t: number | Date): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(dayStart: number, days: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function sanitizeSchedulerSettings(s: Partial<SchedulerSettings> | undefined): SchedulerSettings {
  const src = s || {};
  const retention = Number(src.desiredRetention);
  const maxInterval = Number(src.maximumInterval);
  return {
    algorithm: src.algorithm === "sm2" ? "sm2" : "fsrs",
    desiredRetention: Number.isFinite(retention) ? Math.max(0.7, Math.min(0.97, retention)) : DEFAULT_SCHEDULER.desiredRetention,
    maximumInterval: Number.isFinite(maxInterval) ? Math.max(1, Math.min(36500, Math.round(maxInterval))) : DEFAULT_SCHEDULER.maximumInterval
  };
}

/** ease SM-2 (1.3–3.5) -> сложность FSRS (1–10): чем выше ease, тем легче карточка. */
export function easeToDifficulty(ease: number): number {
  const e = Math.max(1.3, Math.min(3.5, ease));
  return Math.max(1, Math.min(10, 10 - ((e - 1.3) / 2.2) * 9));
}

/** Обратное преобразование, чтобы ease в заметке оставался осмысленным и при FSRS. */
export function difficultyToEase(difficulty: number): number {
  const d = Math.max(1, Math.min(10, difficulty));
  return Math.round((1.3 + ((10 - d) / 9) * 2.2) * 100) / 100;
}

/**
 * Карточка в формате ts-fsrs. Карточки без данных FSRS, но с интервалом,
 * переносятся приблизительно: стабильность = интервал, сложность — из ease.
 */
export function toFsrsCard(card: Schedule, now: Date): FsrsCard {
  const f = card.fsrs;
  if (f) {
    return {
      due: new Date(card.nextReview || now.getTime()),
      stability: f.stability,
      difficulty: f.difficulty,
      elapsed_days: 0,
      scheduled_days: card.interval,
      learning_steps: 0,
      reps: f.reps,
      lapses: f.lapses,
      state: f.state as State,
      last_review: new Date(f.lastReview)
    };
  }
  if (card.interval > 0) {
    const due = card.nextReview || startOfDay(now);
    return {
      due: new Date(due),
      stability: Math.max(0.5, card.interval),
      difficulty: easeToDifficulty(card.ease),
      elapsed_days: 0,
      scheduled_days: card.interval,
      learning_steps: 0,
      reps: 1,
      lapses: 0,
      state: State.Review,
      last_review: new Date(addDays(startOfDay(due), -card.interval))
    };
  }
  return createEmptyCard(now);
}

function createFsrs(settings: SchedulerSettings): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: settings.desiredRetention,
      maximum_interval: settings.maximumInterval,
      enable_fuzz: true,
      // Шаги в минутах не используются: повтор после Again делается внутри сессии.
      enable_short_term: false
    })
  );
}

/** Расписание для всех четырёх оценок (для подписей на кнопках и самой оценки). */
export function previewSchedules(card: Schedule, settings: SchedulerSettings, now: Date = new Date()): Record<Rating, ScheduleResult> {
  const today = startOfDay(now);
  const result = {} as Record<Rating, ScheduleResult>;
  if (settings.algorithm === "sm2") {
    for (const rating of RATINGS) {
      const next = calculateNextReview(card.ease, card.interval, rating);
      const interval = Math.min(settings.maximumInterval, next.interval);
      result[rating] = { ease: next.ease, interval, nextReview: addDays(today, interval), fsrs: null };
    }
    return result;
  }
  const records = createFsrs(settings).repeat(toFsrsCard(card, now), now);
  for (const rating of RATINGS) {
    const next = records[FSRS_RATING[rating]].card;
    const interval = Math.max(1, Math.min(settings.maximumInterval, Math.round(next.scheduled_days)));
    result[rating] = {
      ease: difficultyToEase(next.difficulty),
      interval,
      nextReview: addDays(today, interval),
      fsrs: {
        stability: next.stability,
        difficulty: next.difficulty,
        state: next.state,
        reps: next.reps,
        lapses: next.lapses,
        lastReview: today
      }
    };
  }
  return result;
}
