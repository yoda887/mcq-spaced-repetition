import { describe, expect, it } from "vitest";
import { extractFlashcards } from "../src/FlashcardParser";
import { buildReviewQueue, collapseSiblings, disperseByNote, shuffleInPlace } from "../src/queue";
import { fakeFile } from "./helpers";

describe("очередь сессии", () => {
  it("оставляет одну сторону двусторонней карточки", () => {
    const cards = extractFlashcards("A ::: B\n\nC :: D", fakeFile());
    expect(cards).toHaveLength(3);
    expect(collapseSiblings(cards).map((c) => c.question)).toEqual(["A", "C"]);
  });

  it("разносит карточки из одной заметки", () => {
    const a = extractFlashcards("A1 :: x\n\nA2 :: x\n\nA3 :: x", fakeFile("a.md"));
    const b = extractFlashcards("B1 :: x\n\nB2 :: x", fakeFile("b.md"));
    const result = disperseByNote([...a, ...b]);
    const paths = result.map((c) => c.file.path);
    let adjacent = 0;
    for (let i = 1; i < paths.length; i++) if (paths[i] === paths[i - 1]) adjacent++;
    expect(adjacent).toBe(0);
  });

  it("без перемешивания сохраняет порядок", () => {
    const cards = extractFlashcards("A :: x\n\nB :: x\n\nC :: x", fakeFile());
    expect(buildReviewQueue(cards, false).map((c) => c.question)).toEqual(["A", "B", "C"]);
  });

  it("перемешивание сохраняет все элементы", () => {
    const arr = [1, 2, 3, 4, 5, 6];
    expect(shuffleInPlace(arr.slice()).sort()).toEqual(arr);
  });
});
