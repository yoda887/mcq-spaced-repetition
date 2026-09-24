import { splitAlternatives } from "./FlashcardParser";

export type AnswerStatus = "correct" | "almost" | "wrong" | "empty";

export interface AnswerEvaluation {
  status: AnswerStatus;
  /** Альтернатива, с которой сравнивается ответ (самая близкая к введённому). */
  best: string;
  alternatives: string[];
}

export interface DiffOp {
  type: "equal" | "wrong" | "missing";
  word: string;
}

interface DiffBlock {
  wrong: string[];
  missing: string[];
}

interface CharDiff {
  aChars: string[];
  aSame: boolean[];
  bChars: string[];
  bSame: boolean[];
}

/**
 * Приводит ответ к виду для сравнения: Unicode NFKC (полноширинные буквы, лигатуры),
 * регистр, ё/е, типографские кавычки,
 * апострофы и тире, лишние пробелы, знаки препинания по краям.
 */
export function normalizeAnswer(value: unknown): string {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,!?;:\u2026"]+|[\s.,!?;:\u2026"]+$/g, "")
    .trim();
}
/** Расстояние Дамерау–Левенштейна (перестановка соседних букв = 1 правка). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = ca.length, m = cb.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, (_, i: number) => {
    const row = new Array(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ca[i - 1] === cb[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && ca[i - 1] === cb[j - 2] && ca[i - 2] === cb[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}
function isNearMiss(typedNorm: string, altNorm: string): boolean {
  if (!typedNorm || altNorm.length < 4) return false;
  const maxDist = altNorm.length >= 10 ? 2 : 1;
  const d = levenshtein(typedNorm, altNorm);
  return d > 0 && d <= maxDist;
}
/** Сравнивает введённый ответ с правильным (с учётом альтернатив и опечаток). */
export function evaluateAnswer(typed: string, correctRaw: string): AnswerEvaluation {
  let alternatives = splitAlternatives(correctRaw);
  if (alternatives.length === 0) alternatives = [String(correctRaw || "").trim()];
  const typedNorm = normalizeAnswer(typed);
  if (!typedNorm) {
    return { status: "empty", best: alternatives[0], alternatives };
  }
  const exact = alternatives.find((alt) => normalizeAnswer(alt) === typedNorm);
  if (exact !== void 0) {
    return { status: "correct", best: exact, alternatives };
  }
  const near = alternatives.find((alt) => isNearMiss(typedNorm, normalizeAnswer(alt)));
  if (near !== void 0) {
    return { status: "almost", best: near, alternatives };
  }
  return { status: "wrong", best: pickClosestAlternative(typed, alternatives), alternatives };
}
/**
 * Пословный diff (LCS). Внутри каждого блока расхождений сначала идут
 * неправильные слова (wrong), затем правильные (missing).
 */
export function wordDiff(typedWords: string[], correctWords: string[]): DiffOp[] {
  const n = typedWords.length;
  const m = correctWords.length;
  const tn = typedWords.map(normalizeAnswer);
  const cn = correctWords.map(normalizeAnswer);
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (tn[i - 1] === cn[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  let i = n, j = m;
  const ops: DiffOp[] = [];
  while (i > 0 && j > 0) {
    if (tn[i - 1] === cn[j - 1]) {
      ops.push({ type: "equal", word: typedWords[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "wrong", word: typedWords[i - 1] });
      i--;
    } else {
      ops.push({ type: "missing", word: correctWords[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: "wrong", word: typedWords[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: "missing", word: correctWords[j - 1] });
    j--;
  }
  ops.reverse();
  const ordered: DiffOp[] = [];
  let wrongBuf: DiffOp[] = [];
  let missingBuf: DiffOp[] = [];
  const flush = () => {
    ordered.push(...wrongBuf, ...missingBuf);
    wrongBuf = [];
    missingBuf = [];
  };
  ops.forEach((op) => {
    if (op.type === "wrong") {
      wrongBuf.push(op);
    } else if (op.type === "missing") {
      missingBuf.push(op);
    } else {
      flush();
      ordered.push(op);
    }
  });
  flush();
  return ordered;
}
function pickClosestAlternative(typed: string, alternatives: string[]): string {
  const typedWords = typed.trim().split(/\s+/).filter(Boolean);
  const typedNorm = normalizeAnswer(typed);
  let best = alternatives[0];
  let bestScore = -1;
  let bestDist = Infinity;
  alternatives.forEach((alt) => {
    const altWords = alt.trim().split(/\s+/).filter(Boolean);
    const ops = wordDiff(typedWords, altWords);
    const equalCount = ops.filter((o) => o.type === "equal").length;
    const dist = levenshtein(typedNorm, normalizeAnswer(alt));
    if (equalCount > bestScore || equalCount === bestScore && dist < bestDist) {
      bestScore = equalCount;
      bestDist = dist;
      best = alt;
    }
  });
  return best;
}
/** Посимвольное сравнение двух похожих слов: какие буквы совпадают. */
function charDiffMarks(a: string, b: string): CharDiff {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const na = ca.map((ch) => normalizeAnswer(ch) || ch);
  const nb = cb.map((ch) => normalizeAnswer(ch) || ch);
  const n = ca.length, m = cb.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      dp[i2][j2] = na[i2] === nb[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  const aSame: boolean[] = new Array(n).fill(false);
  const bSame: boolean[] = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) {
      aSame[i] = true;
      bSame[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { aChars: ca, aSame, bChars: cb, bSame };
}
function wordsAreSimilar(a: string, b: string): boolean {
  const na = normalizeAnswer(a);
  const nb = normalizeAnswer(b);
  if (!na || !nb) return false;
  const limit = Math.max(1, Math.floor(Math.max(na.length, nb.length) / 3));
  return levenshtein(na, nb) <= limit;
}
function createWordSpan(word: string, cls: string, chars?: string[], same?: boolean[], charCls?: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = cls;
  if (!chars) {
    span.textContent = word;
    return span;
  }
  let buf = "";
  let bufSame: boolean | null = null;
  const flushBuf = () => {
    if (!buf) return;
    if (bufSame) {
      span.appendChild(document.createTextNode(buf));
    } else {
      const mark = document.createElement("span");
      mark.className = charCls;
      mark.textContent = buf;
      span.appendChild(mark);
    }
    buf = "";
  };
  chars.forEach((ch, idx) => {
    if (bufSame !== null && same[idx] !== bufSame) flushBuf();
    bufSame = same[idx];
    buf += ch;
  });
  flushBuf();
  return span;
}
/** Строит DOM-фрагмент с подсветкой отличий введённого ответа от правильного. */
export function buildWordDiffFragment(typed: string, correct: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const typedWords = (typed || "").trim().split(/\s+/).filter(Boolean);
  const correctWords = (correct || "").trim().split(/\s+/).filter(Boolean);
  const tokens: HTMLElement[] = [];
  if (typedWords.length === 0) {
    const empty = document.createElement("span");
    empty.className = "mcq-word-empty";
    empty.textContent = "нет ответа";
    tokens.push(empty);
    correctWords.forEach((w) => tokens.push(createWordSpan(w, "mcq-word-missing")));
  } else {
    const items: Array<DiffOp | DiffBlock> = [];
    let block: DiffBlock | null = null;
    wordDiff(typedWords, correctWords).forEach((op) => {
      if (op.type === "equal") {
        block = null;
        items.push(op);
      } else {
        if (!block) {
          block = { wrong: [], missing: [] };
          items.push(block);
        }
        block[op.type as "wrong" | "missing"].push(op.word);
      }
    });
    items.forEach((item) => {
      if ("type" in item) {
        tokens.push(createWordSpan(item.word, "mcq-word-correct"));
        return;
      }
      const wrongSpans: HTMLSpanElement[] = [];
      const missingSpans: HTMLSpanElement[] = [];
      const pairs = Math.max(item.wrong.length, item.missing.length);
      for (let k = 0; k < pairs; k++) {
        const w = item.wrong[k];
        const c = item.missing[k];
        if (w !== void 0 && c !== void 0 && wordsAreSimilar(w, c)) {
          const d = charDiffMarks(w, c);
          wrongSpans.push(createWordSpan(w, "mcq-word-wrong", d.aChars, d.aSame, "mcq-char-wrong"));
          missingSpans.push(createWordSpan(c, "mcq-word-missing", d.bChars, d.bSame, "mcq-char-missing"));
        } else {
          if (w !== void 0) wrongSpans.push(createWordSpan(w, "mcq-word-wrong"));
          if (c !== void 0) missingSpans.push(createWordSpan(c, "mcq-word-missing"));
        }
      }
      tokens.push(...wrongSpans, ...missingSpans);
    });
  }
  tokens.forEach((tok, idx) => {
    if (idx > 0) frag.appendChild(document.createTextNode(" "));
    frag.appendChild(tok);
  });
  return frag;
}
