import { describe, expect, it } from "vitest";
import { extractFlashcards, formatScheduleData, parseSchedule, splitAlternatives, updateFlashcardInContent } from "../src/FlashcardParser";
import { fakeFile } from "./helpers";

const file = fakeFile();

describe("extractFlashcards", () => {
  it("обычная и двусторонняя карточки", () => {
    const cards = extractFlashcards("A :: B\n\nC ::: D", file);
    expect(cards.map((c) => [c.type, c.question, c.answer])).toEqual([
      ["standard", "A", "B"],
      ["reversed", "C", "D"],
      ["reversed", "D", "C"]
    ]);
    expect(cards[1].siblingId).toBe(cards[2].id);
  });

  it("многострочная карточка", () => {
    const [card] = extractFlashcards("Вопрос\nещё строка\n?\nОтвет", file);
    expect(card.type).toBe("multiline");
    expect(card.question).toBe("Вопрос\nещё строка");
    expect(card.answer).toBe("Ответ");
  });

  it("cloze с вводом ответа", () => {
    const [card] = extractFlashcards("I {{type:go}} to school", file);
    expect(card.type).toBe("cloze");
    expect(card.question).toBe("I [...] to school");
    expect(card.answer).toBe("I **go** to school");
  });

  it("тест :::test с несколькими правильными вариантами", () => {
    const text = ":::test\nПростые числа?\n- [x] 2\n- [ ] 4\n- [x] 7\n:::";
    const [card] = extractFlashcards(text, file);
    expect(card.type).toBe("mcq");
    expect(card.isValid).toBe(true);
    expect(card.options.filter((o) => o.isCorrect).map((o) => o.text)).toEqual(["2", "7"]);
  });

  it("тест без отмеченного варианта помечается как некорректный", () => {
    const [card] = extractFlashcards(":::test\nВопрос\n- [ ] a\n- [ ] b\n:::", file);
    expect(card.isValid).toBe(false);
    expect(card.validationMessage).toMatch(/не отмечен/);
  });

  it("не находит карточки в блоках кода и frontmatter", () => {
    const text = "---\ntitle: a :: b\n---\n```\nX :: Y\n```\n`P :: Q`\nReal :: Card";
    const cards = extractFlashcards(text, file);
    expect(cards.map((c) => c.question)).toEqual(["Real"]);
  });

  it("читает расписание из SR-комментария", () => {
    const [card] = extractFlashcards("A :: B\n<!--SR:2026-10-01,7,2.30-->", file);
    expect(card.interval).toBe(7);
    expect(card.ease).toBeCloseTo(2.3);
    expect(card.fsrs).toBeNull();
  });
});

describe("SR-комментарий", () => {
  it("формат с данными FSRS читается и записывается без потерь", () => {
    const raw = "2026-10-01,7,2.45,f:12.5:4.2:2:3:1:2026-09-24";
    const parsed = parseSchedule(raw);
    expect(parsed.fsrs).toEqual({
      stability: 12.5,
      difficulty: 4.2,
      state: 2,
      reps: 3,
      lapses: 1,
      lastReview: new Date(2026, 8, 24).getTime()
    });
    expect(formatScheduleData(parsed)).toBe(raw);
  });

  it("повреждённые данные FSRS игнорируются", () => {
    expect(parseSchedule("2026-10-01,7,2.45,f:bad").fsrs).toBeNull();
  });

  it("обновляет расписание нужной стороны двусторонней карточки", () => {
    const text = "C ::: D";
    const [, reverse] = extractFlashcards(text, file);
    const updated = updateFlashcardInContent(text, reverse, "<!--SR:2026-10-01,3,2.50-->");
    expect(updated).toBe("C ::: D\n<!--SR:2000-01-01,0,2.5!2026-10-01,3,2.50-->");
  });

  it("запоминает прежний текст карточки для отмены", () => {
    const text = "A :: B\n<!--SR:2026-09-20,3,2.50-->\n\nnext";
    const [card] = extractFlashcards(text, file);
    const replaced = { text: null as string | null };
    updateFlashcardInContent(text, card, "<!--SR:2026-10-01,7,2.50-->", replaced);
    expect(replaced.text).toBe("A :: B\n<!--SR:2026-09-20,3,2.50-->");
  });
});

describe("splitAlternatives", () => {
  it("делит по or / или", () => {
    expect(splitAlternatives("a or b или c")).toEqual(["a", "b", "c"]);
  });
});
