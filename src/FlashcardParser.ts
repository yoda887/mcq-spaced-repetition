import type { App, TFile } from "obsidian";
import type { Flashcard, McqOption, Schedule } from "./types";

/** Диапазон [start, end) в тексте. */
type Region = [number, number];

interface Span {
  start: number;
  end: number;
}

interface TrailingSr {
  end: number;
  forward: string | null;
  reverse: string | null;
}

/** Поля, общие у прямой и обратной карточки из одного фрагмента текста. */
type SharedCardFields = Pick<
  Flashcard,
  "fullMatch" | "body" | "editText" | "start" | "end" | "bodyEnd" | "editStart" | "editEnd" | "srForward" | "srReverse" | "file"
>;

type CardOwnFields = Omit<Flashcard, keyof SharedCardFields>;

export function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function todayStr(): string {
  return toDateStr(new Date());
}
export function parseDateLocal(value: unknown): number {
  const raw = String(value == null ? "" : value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
  }
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : NaN;
}
export function sanitizeEase(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return 2.5;
  return Math.max(1.3, Math.min(3.5, n));
}
export function sanitizeInterval(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(365, Math.round(n)));
}
export function sanitizeDueDate(value: unknown): number {
  const t = parseDateLocal(value);
  return Number.isFinite(t) ? t : 0;
}
export function parseSchedule(srString: string | null | undefined): Schedule {
  const parts = String(srString == null ? "" : srString).split(",");
  if (parts.length < 3) {
    return { nextReview: 0, interval: 0, ease: 2.5 };
  }
  return {
    nextReview: sanitizeDueDate(parts[0]),
    interval: sanitizeInterval(parts[1]),
    ease: sanitizeEase(parts[2])
  };
}
export function hashString(str: string): string {
  let h = 2166136261;
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
export function escapeAttr(value: unknown): string {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** Делит ответ на альтернативы по словам "or" / "или". */
export function splitAlternatives(raw: string | null | undefined): string[] {
  return String(raw == null ? "" : raw).split(/\s+(?:or|или)\s+/i).map((s) => s.trim()).filter(Boolean);
}
let domIdCounter = 0;
export function nextDomId(): string {
  domIdCounter += 1;
  return `${Date.now().toString(36)}-${domIdCounter}`;
}
function detectEol(content: string): string {
  return /\r\n/.test(content) ? "\r\n" : "\n";
}
function blankOut(text: string): string {
  return text.replace(/[^\r\n]/g, " ");
}
function maskRegions(text: string, regions: Region[]): string {
  if (!regions || regions.length === 0) return text;
  const sorted = regions.slice().sort((a, b) => a[0] - b[0]);
  const parts: string[] = [];
  let pos = 0;
  for (const region of sorted) {
    const end = Math.min(region[1], text.length);
    if (end <= pos) continue;
    const start = Math.max(region[0], pos);
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(blankOut(text.slice(start, end)));
    pos = end;
  }
  parts.push(text.slice(pos));
  return parts.join("");
}
function getLines(text: string): Span[] {
  const lines: Span[] = [];
  const re = /\r?\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lines.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  lines.push({ start, end: text.length });
  return lines;
}
function getParagraphs(text: string): Span[] {
  const paragraphs: Span[] = [];
  const re = /\r?\n\r?\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    paragraphs.push({ start, end: m.index });
    start = m.index + m[0].length;
    re.lastIndex = start;
  }
  paragraphs.push({ start, end: text.length });
  return paragraphs;
}
/**
 * Затирает пробелами frontmatter, блоки кода и инлайн-код, чтобы парсер не
 * находил в них карточки. Длина и позиции строк при этом сохраняются.
 */
function maskNonCardRegions(content: string): string {
  const regions: Region[] = [];
  const fm = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/.exec(content);
  if (fm && fm.index === 0) {
    regions.push([0, fm[0].length]);
  }
  const lines = getLines(content);
  let fenceStart = -1;
  let fenceChar = "";
  for (const line of lines) {
    const text = content.slice(line.start, line.end);
    const m = /^[ \t]{0,3}(```+|~~~+)/.exec(text);
    if (fenceStart === -1) {
      if (m) {
        fenceStart = line.start;
        fenceChar = m[1].charAt(0);
      }
    } else if (m && m[1].charAt(0) === fenceChar) {
      regions.push([fenceStart, line.end]);
      fenceStart = -1;
    }
  }
  if (fenceStart !== -1) {
    regions.push([fenceStart, content.length]);
  }
  let scan = maskRegions(content, regions);
  const inlineRegions: Region[] = [];
  const inlineCode = /`[^`\r\n]+`/g;
  let ic: RegExpExecArray | null;
  while ((ic = inlineCode.exec(scan)) !== null) {
    inlineRegions.push([ic.index, ic.index + ic[0].length]);
  }
  return maskRegions(scan, inlineRegions);
}
function readTrailingSr(content: string, bodyEnd: number): TrailingSr {
  const rest = content.slice(bodyEnd);
  const m = /^(?:\r?\n[ \t]*<!--SR:[^>]*-->[ \t]*)+/.exec(rest);
  if (!m) {
    return { end: bodyEnd, forward: null, reverse: null };
  }
  const first = /<!--SR:([^>]*)-->/.exec(m[0]);
  let forward: string | null = null;
  let reverse: string | null = null;
  if (first) {
    const parts = first[1].split("!");
    forward = parts[0] || null;
    reverse = parts[1] || null;
  }
  return { end: bodyEnd + m[0].length, forward, reverse };
}
function buildMcqAnswer(options: McqOption[]): string {
  if (!options || options.length === 0) return "";
  return options.map((o) => `- [${o.isCorrect ? "x" : " "}] ${o.text}`).join("\n");
}
function stripSrLines(text: string): string {
  return text.replace(/(?:\r?\n)[ \t]*<!--SR:[^>]*-->[ \t]*(?=\r?\n|$)/g, "");
}
/** Находит все карточки в тексте заметки. */
export function extractFlashcards(content: string, file: TFile): Flashcard[] {
  const cards: Flashcard[] = [];
  if (typeof content !== "string" || content.length === 0) {
    return cards;
  }
  const filePath = file && file.path ? file.path : "";
  const idCounters: Record<string, number> = {};
  const makeId = (type: string, body: string): string => {
    const key = `${filePath}|${type}|${hashString(body)}`;
    idCounters[key] = (idCounters[key] || 0) + 1;
    return `${key}#${idCounters[key]}`;
  };
  let scan = maskNonCardRegions(content);
  const consumedRegions: Region[] = [];
  const fenceRegions: Region[] = [];
  const testRegex = /^:::test[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = testRegex.exec(scan)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    fenceRegions.push([start, end]);
    const raw = content.slice(start, end);
    const innerLines = raw.split(/\r?\n/).slice(1, -1);
    const options: McqOption[] = [];
    const questionLines: string[] = [];
    let srRaw: string | null = null;
    for (const line of innerLines) {
      const trimmed = line.trim();
      const srMatch = trimmed.match(/^<!--SR:([^>]*)-->$/);
      if (srMatch) {
        if (srRaw === null) srRaw = srMatch[1];
        continue;
      }
      const optionMatch = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/);
      if (optionMatch) {
        options.push({ isCorrect: optionMatch[1].toLowerCase() === "x", text: optionMatch[2] });
      } else {
        questionLines.push(line);
      }
    }
    const questionText = questionLines.join("\n").trim();
    const sched = parseSchedule(srRaw);
    const body = stripSrLines(raw);
    const hasCorrect = options.some((o) => o.isCorrect);
    let validationMessage = "";
    if (options.length === 0) {
      validationMessage = "В блоке :::test не найдено ни одного варианта ответа (- [ ] ...). Оцените карточку вручную.";
    } else if (!hasCorrect) {
      validationMessage = "В блоке :::test не отмечен правильный вариант (- [x] ...). Оцените карточку вручную.";
    }
    cards.push({
      id: makeId("mcq", body),
      question: questionText,
      options,
      answer: buildMcqAnswer(options),
      isValid: options.length > 0 && hasCorrect,
      validationMessage,
      fullMatch: raw,
      body,
      editText: raw,
      start,
      end,
      bodyEnd: end,
      editStart: start,
      editEnd: end,
      file,
      ease: sched.ease,
      interval: sched.interval,
      nextReview: sched.nextReview,
      type: "mcq"
    });
  }
  const blockRegex = /^:::block[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*$/gm;
  while ((m = blockRegex.exec(scan)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    fenceRegions.push([start, end]);
    const raw = content.slice(start, end);
    const innerLines = raw.split(/\r?\n/).slice(1, -1);
    let srRaw: string | null = null;
    const bodyLines: string[] = [];
    for (const line of innerLines) {
      const trimmed = line.trim();
      const srMatch = trimmed.match(/^<!--SR:([^>]*)-->$/);
      if (srMatch) {
        if (srRaw === null) srRaw = srMatch[1];
        continue;
      }
      bodyLines.push(line);
    }
    const bodyText = bodyLines.join("\n").trim();
    const questionText = bodyText.replace(/\{\{[^{}]*\}\}/g, "[...]");
    const sched = parseSchedule(srRaw);
    const body = stripSrLines(raw);
    cards.push({
      id: makeId("block", body),
      question: questionText,
      answer: bodyText,
      fullMatch: raw,
      body,
      editText: raw,
      start,
      end,
      bodyEnd: end,
      editStart: start,
      editEnd: end,
      file,
      ease: sched.ease,
      interval: sched.interval,
      nextReview: sched.nextReview,
      type: "block"
    });
  }
  scan = maskRegions(scan, fenceRegions);
  const inlineRegex = /^(.+?)[ \t]*(:::|::)[ \t]*(.+?)[ \t]*$/gm;
  while ((m = inlineRegex.exec(scan)) !== null) {
    const start = m.index;
    const bodyEnd = start + m[0].length;
    const raw = content.slice(start, bodyEnd);
    const afterQuestion = m[0].slice(m[1].length);
    const wsLen = (/^[ \t]*/.exec(afterQuestion) || [""])[0].length;
    const sepStart = m[1].length + wsLen;
    const separator = m[2];
    const question = raw.slice(0, sepStart).trim();
    const answer = raw.slice(sepStart + separator.length).trim();
    const tail = readTrailingSr(content, bodyEnd);
    inlineRegex.lastIndex = Math.max(inlineRegex.lastIndex, tail.end);
    if (!question || !answer) continue;
    if (/^:::/.test(raw.trim())) continue;
    consumedRegions.push([start, tail.end]);
    const fwd = parseSchedule(tail.forward);
    const rev = parseSchedule(tail.reverse);
    const isReversed = separator === ":::";
    const baseId = makeId(isReversed ? "reversed" : "standard", raw);
    const shared: SharedCardFields = {
      fullMatch: content.slice(start, tail.end),
      body: raw,
      editText: raw,
      start,
      end: tail.end,
      bodyEnd,
      editStart: start,
      editEnd: bodyEnd,
      srForward: tail.forward,
      srReverse: tail.reverse,
      file
    };
    cards.push(Object.assign<CardOwnFields, SharedCardFields>({
      id: baseId,
      siblingId: isReversed ? baseId + "|rev" : void 0,
      question,
      answer,
      nextReview: fwd.nextReview,
      interval: fwd.interval,
      ease: fwd.ease,
      type: isReversed ? "reversed" : "standard"
    }, shared));
    if (isReversed) {
      cards.push(Object.assign<CardOwnFields, SharedCardFields>({
        id: baseId + "|rev",
        siblingId: baseId,
        question: answer,
        answer: question,
        nextReview: rev.nextReview,
        interval: rev.interval,
        ease: rev.ease,
        type: "reversed",
        isReverseDirection: true
      }, shared));
    }
  }
  const paragraphs = getParagraphs(scan);
  for (const para of paragraphs) {
    const scanPara = scan.slice(para.start, para.end);
    const sepRegex = /\r?\n(\?\?|\?)[ \t]*\r?\n/g;
    const sepMatches: RegExpExecArray[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = sepRegex.exec(scanPara)) !== null) {
      sepMatches.push(sm);
    }
    if (sepMatches.length !== 1) continue;
    const sepMatch = sepMatches[0];
    const separator = sepMatch[1];
    const rawPara = content.slice(para.start, para.end);
    let bodyEnd = para.end;
    const trailingSr = /(?:\r?\n[ \t]*<!--SR:[^>]*-->[ \t]*)+$/.exec(rawPara);
    if (trailingSr) {
      bodyEnd = para.start + trailingSr.index;
    }
    const body = content.slice(para.start, bodyEnd);
    const question = body.slice(0, sepMatch.index).trim();
    const answer = body.slice(sepMatch.index + sepMatch[0].length).trim();
    if (!question || !answer) continue;
    const tail = readTrailingSr(content, bodyEnd);
    consumedRegions.push([para.start, tail.end]);
    const fwd = parseSchedule(tail.forward);
    const rev = parseSchedule(tail.reverse);
    const isReversed = separator === "??";
    const baseId = makeId(isReversed ? "reversed" : "multiline", body);
    const shared: SharedCardFields = {
      fullMatch: content.slice(para.start, tail.end),
      body,
      editText: body,
      start: para.start,
      end: tail.end,
      bodyEnd,
      editStart: para.start,
      editEnd: bodyEnd,
      srForward: tail.forward,
      srReverse: tail.reverse,
      file
    };
    cards.push(Object.assign<CardOwnFields, SharedCardFields>({
      id: baseId,
      siblingId: isReversed ? baseId + "|rev" : void 0,
      question,
      answer,
      nextReview: fwd.nextReview,
      interval: fwd.interval,
      ease: fwd.ease,
      type: isReversed ? "reversed" : "multiline"
    }, shared));
    if (isReversed) {
      cards.push(Object.assign<CardOwnFields, SharedCardFields>({
        id: baseId + "|rev",
        siblingId: baseId,
        question: answer,
        answer: question,
        nextReview: rev.nextReview,
        interval: rev.interval,
        ease: rev.ease,
        type: "reversed",
        isReverseDirection: true
      }, shared));
    }
  }
  const clozeScan = maskRegions(scan, consumedRegions);
  const lines = getLines(content);
  for (const line of lines) {
    const scanLine = clozeScan.slice(line.start, line.end);
    const trimmedScan = scanLine.trim();
    if (scanLine.includes("::") || trimmedScan === "?" || trimmedScan === "??") continue;
    if (!/\{\{[^{}]+\}\}|==[^=]+==/.test(scanLine)) continue;
    const rawLine = content.slice(line.start, line.end);
    const tail = readTrailingSr(content, line.end);
    const sched = parseSchedule(tail.forward);
    const question = rawLine.replace(/\{\{[^{}]+\}\}|==[^=]+==/g, "[...]");
    const answer = rawLine.replace(/\{\{([^{}]+)\}\}/g, (_mm: string, p1: string) => `**${p1.replace(/^\s*type\s*:\s*/i, "")}**`).replace(/==([^=]+)==/g, "**$1**");
    cards.push({
      id: makeId("cloze", rawLine),
      question,
      answer,
      fullMatch: content.slice(line.start, tail.end),
      body: rawLine,
      editText: rawLine,
      start: line.start,
      end: tail.end,
      bodyEnd: line.end,
      editStart: line.start,
      editEnd: line.end,
      srForward: tail.forward,
      srReverse: tail.reverse,
      file,
      nextReview: sched.nextReview,
      interval: sched.interval,
      ease: sched.ease,
      type: "cloze"
    });
  }
  return cards;
}
/** Находит карточку в актуальном тексте файла (он мог измениться после начала сессии). */
function findLiveCard(content: string, card: Flashcard): Flashcard | null {
  const live = extractFlashcards(content, card.file);
  let found = live.find((c) => c.id === card.id);
  if (!found) {
    found = live.find(
      (c) => c.type === card.type && c.question === card.question && !!c.isReverseDirection === !!card.isReverseDirection
    );
  }
  return found || null;
}
export function updateFlashcardInContent(content: string, card: Flashcard, newSrData: string): string {
  const live = findLiveCard(content, card);
  if (!live) {
    console.warn("MCQ SR: card not found in file, schedule not saved", card && card.id);
    return content;
  }
  const eol = detectEol(content);
  let newRegion: string;
  if (live.type === "mcq" || live.type === "block") {
    let replaced = false;
    newRegion = live.body.replace(/(\r?\n):::[ \t]*$/, (_mm: string, nl: string) => {
      replaced = true;
      return `${nl}${newSrData}${nl}:::`;
    });
    if (!replaced) {
      newRegion = live.body + eol + newSrData;
    }
  } else {
    const newSchedMatch = newSrData.match(/<!--SR:([^>]+)-->/);
    const newSched = newSchedMatch ? newSchedMatch[1] : newSrData;
    let forward = live.srForward || "2000-01-01,0,2.5";
    let reverse = live.srReverse || "2000-01-01,0,2.5";
    if (card.isReverseDirection) {
      reverse = newSched;
    } else {
      forward = newSched;
    }
    const comment = live.type === "reversed" ? `<!--SR:${forward}!${reverse}-->` : `<!--SR:${forward}-->`;
    newRegion = live.body + eol + comment;
  }
  return content.slice(0, live.start) + newRegion + content.slice(live.end);
}
export async function applyCardUpdate(app: App, card: Flashcard, newSrData: string): Promise<void> {
  const vault = app.vault;
  if (typeof vault.process === "function") {
    await vault.process(card.file, (data: string) => updateFlashcardInContent(data, card, newSrData));
    return;
  }
  const fileContent = await vault.read(card.file);
  const updated = updateFlashcardInContent(fileContent, card, newSrData);
  if (updated !== fileContent) {
    await vault.modify(card.file, updated);
  }
}
export async function applyCardEdit(app: App, card: Flashcard, newText: string): Promise<boolean> {
  let ok = false;
  const rewrite = (data: string): string => {
    const live = findLiveCard(data, card);
    if (!live) return data;
    ok = true;
    return data.slice(0, live.editStart) + newText + data.slice(live.editEnd);
  };
  const vault = app.vault;
  if (typeof vault.process === "function") {
    await vault.process(card.file, rewrite);
  } else {
    const fileContent = await vault.read(card.file);
    const updated = rewrite(fileContent);
    if (updated !== fileContent) {
      await vault.modify(card.file, updated);
    }
  }
  return ok;
}
