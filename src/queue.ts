import type { Flashcard } from "./types";

/** Перемешивание Фишера–Йетса (на месте). */
export function shuffleInPlace<T>(arr: T[], random: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Оставляет в сессии только одну сторону двусторонней карточки:
 * вторая сторона всё равно была бы отложена до завтра после первой оценки.
 */
export function collapseSiblings(cards: Flashcard[]): Flashcard[] {
  const taken = new Set<string>();
  const result: Flashcard[] = [];
  for (const card of cards) {
    if (card.siblingId && taken.has(card.siblingId)) continue;
    taken.add(card.id);
    result.push(card);
  }
  return result;
}

/**
 * Разносит карточки из одной заметки, чтобы они по возможности не шли подряд.
 * Жадно: если следующая карточка из той же заметки, что и предыдущая,
 * меняет её местами с ближайшей подходящей карточкой дальше по очереди.
 */
export function disperseByNote(cards: Flashcard[]): Flashcard[] {
  const result = cards.slice();
  for (let i = 1; i < result.length; i++) {
    const prevPath = result[i - 1].file.path;
    if (result[i].file.path !== prevPath) continue;
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].file.path !== prevPath) {
        const tmp = result[i];
        result[i] = result[j];
        result[j] = tmp;
        break;
      }
    }
  }
  return result;
}

/** Готовит очередь сессии: одна сторона двусторонних карточек, перемешивание, разнесение по заметкам. */
export function buildReviewQueue(cards: Flashcard[], shuffle: boolean): Flashcard[] {
  let queue = collapseSiblings(shuffle ? shuffleInPlace(cards.slice()) : cards.slice());
  if (shuffle) {
    queue = disperseByNote(queue);
  }
  return queue;
}
