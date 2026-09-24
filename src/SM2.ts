import { sanitizeEase, sanitizeInterval } from "./FlashcardParser";
import type { Rating } from "./types";

export interface NextReview {
  ease: number;
  interval: number;
}

/**
 * Упрощённый SM-2: вычисляет новый ease и интервал (в днях) по оценке.
 * Again — сброс интервала до 1 дня, Hard — половина интервала.
 */
export function calculateNextReview(ease: number, interval: number, rating: Rating): NextReview {
  const oldEase = sanitizeEase(ease);
  const baseInterval = sanitizeInterval(interval);
  let newEase = oldEase;
  let newInterval = baseInterval;
  switch (rating) {
    case "Again":
      newEase = Math.max(1.3, oldEase - 0.2);
      newInterval = 1;
      break;
    case "Hard":
      newEase = Math.max(1.3, oldEase - 0.2);
      newInterval = Math.max(1, Math.round(baseInterval * 0.5));
      break;
    case "Good":
      if (baseInterval === 0) {
        newInterval = 1;
      } else if (baseInterval === 1) {
        newInterval = 3;
      } else {
        newInterval = Math.round(baseInterval * oldEase);
      }
      break;
    case "Easy":
      newEase = Math.min(3.5, oldEase + 0.15);
      if (baseInterval === 0) {
        newInterval = 2;
      } else if (baseInterval === 1) {
        newInterval = 4;
      } else {
        newInterval = Math.round(baseInterval * oldEase * 1.3);
      }
      break;
    default:
      newInterval = Math.max(1, baseInterval);
  }
  if (!Number.isFinite(newInterval)) newInterval = 1;
  if (!Number.isFinite(newEase)) newEase = 2.5;
  newInterval = Math.max(1, Math.min(365, Math.round(newInterval)));
  newEase = Math.max(1.3, Math.min(3.5, newEase));
  return { ease: newEase, interval: newInterval };
}
