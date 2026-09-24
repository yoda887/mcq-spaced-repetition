// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildWordDiffFragment, evaluateAnswer, levenshtein, normalizeAnswer, wordDiff } from "../src/AnswerCheck";

describe("normalizeAnswer", () => {
  it("игнорирует регистр, ё/е, лишние пробелы и знаки по краям", () => {
    expect(normalizeAnswer("  Ёлка.  ")).toBe("елка");
    expect(normalizeAnswer("to   be")).toBe("to be");
  });
  it("выравнивает апострофы, кавычки и тире", () => {
    expect(normalizeAnswer("don’t")).toBe("don't");
    expect(normalizeAnswer("«да»")).toBe("да");
    expect(normalizeAnswer("well—known")).toBe("well-known");
  });
  it("применяет NFKC: полноширинные буквы и лигатуры", () => {
    expect(normalizeAnswer("ＡＢＣ")).toBe("abc");
    expect(normalizeAnswer("ﬁne")).toBe("fine");
  });
});

describe("levenshtein", () => {
  it("считает перестановку соседних букв одной правкой", () => {
    expect(levenshtein("recieve", "receive")).toBe(1);
    expect(levenshtein("walk", "walked")).toBe(2);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("evaluateAnswer", () => {
  it("распознаёт верный ответ среди альтернатив", () => {
    const r = evaluateAnswer("colour", "color or colour");
    expect(r.status).toBe("correct");
    expect(r.best).toBe("colour");
    expect(r.alternatives).toEqual(["color", "colour"]);
  });
  it("альтернативы через «или»", () => {
    expect(evaluateAnswer("да", "да или ага").status).toBe("correct");
  });
  it("опечатка — почти верно", () => {
    expect(evaluateAnswer("recieve", "receive").status).toBe("almost");
  });
  it("короткие слова опечатками не считаются", () => {
    expect(evaluateAnswer("on", "in").status).toBe("wrong");
  });
  it("другая форма слова — неверно", () => {
    expect(evaluateAnswer("walked", "walk").status).toBe("wrong");
  });
  it("пустой ответ", () => {
    expect(evaluateAnswer("", "go").status).toBe("empty");
  });
});

describe("wordDiff", () => {
  it("в блоке расхождений неправильные слова идут перед правильными", () => {
    const ops = wordDiff(["big", "red", "car"], ["small", "blue", "car"]);
    expect(ops.map((o) => `${o.type[0]}:${o.word}`)).toEqual(["w:big", "w:red", "m:small", "m:blue", "e:car"]);
  });
  it("пропущенное слово", () => {
    const ops = wordDiff(["the", "cat"], ["the", "black", "cat"]);
    expect(ops.map((o) => o.type)).toEqual(["equal", "missing", "equal"]);
  });
});

describe("buildWordDiffFragment", () => {
  const render = (typed: string, correct: string) => {
    const div = document.createElement("div");
    div.appendChild(buildWordDiffFragment(typed, correct));
    return div;
  };
  it("зачёркнутое слово стоит перед правильным", () => {
    const div = render("goes", "go");
    const spans = Array.from(div.children).map((el) => el.className);
    expect(spans).toEqual(["mcq-word-wrong", "mcq-word-missing"]);
  });
  it("подсвечивает отличающиеся буквы в похожих словах", () => {
    const div = render("shcool", "school");
    expect(div.querySelector(".mcq-char-wrong")?.textContent).toBe("h");
    expect(div.querySelector(".mcq-char-missing")?.textContent).toBe("h");
  });
  it("пустой ответ помечается «нет ответа»", () => {
    const div = render("", "day");
    expect(div.querySelector(".mcq-word-empty")?.textContent).toBe("нет ответа");
  });
});
