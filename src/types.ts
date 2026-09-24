import type { TFile } from "obsidian";

/** Оценка ответа при повторении. */
export type Rating = "Again" | "Hard" | "Good" | "Easy";

/** Тип карточки, определяемый синтаксисом в заметке. */
export type CardType = "mcq" | "block" | "standard" | "reversed" | "multiline" | "cloze";

/** Вариант ответа в блоке :::test. */
export interface McqOption {
  isCorrect: boolean;
  text: string;
}

/** Расписание повторения, прочитанное из комментария <!--SR:...-->. */
/** Состояние карточки для алгоритма FSRS (хранится в SR-комментарии после ease). */
export interface FsrsState {
  stability: number;
  difficulty: number;
  /** 0 New, 1 Learning, 2 Review, 3 Relearning (как в ts-fsrs). */
  state: number;
  reps: number;
  lapses: number;
  /** Дата последнего повтора, мс (локальная полночь). */
  lastReview: number;
}

export interface Schedule {
  nextReview: number;
  interval: number;
  ease: number;
  /** null — у карточки ещё нет данных FSRS (новая или оценивалась по SM-2). */
  fsrs?: FsrsState | null;
}

export interface Flashcard extends Schedule {
  /** Стабильный идентификатор: путь | тип | хеш тела # порядковый номер. */
  id: string;
  /** id парной карточки у двусторонних (reversed) карточек. */
  siblingId?: string;
  type: CardType;
  question: string;
  answer: string;
  /** Только для mcq. */
  options?: McqOption[];
  isValid?: boolean;
  validationMessage?: string;
  /** Полный текст карточки вместе с SR-комментарием. */
  fullMatch: string;
  /** Текст карточки без SR-комментария. */
  body: string;
  /** Текст, который показывается в режиме редактирования. */
  editText: string;
  start: number;
  end: number;
  bodyEnd: number;
  editStart: number;
  editEnd: number;
  srForward?: string | null;
  srReverse?: string | null;
  file: TFile;
  isReverseDirection?: boolean;
  /** Вычисляется при отрисовке cloze-карточки: есть ли в ней {{type:...}}. */
  _hasTypeGap?: boolean;
}

export interface FocusQueueItem {
  question: string;
  answer: string;
  filePath: string;
  type: CardType;
  isReverseDirection?: boolean;
}

export interface PluginSettings {
  focusQueue: FocusQueueItem[];
  /** Количество повторений по датам (YYYY-MM-DD). */
  reviewCounts: Record<string, number>;
  /** id карточки -> дата, до конца которой она скрыта (парные карточки). */
  buriedCards: Record<string, string>;
  /** Алгоритм интервалов. */
  algorithm: "fsrs" | "sm2";
  /** Желаемая вероятность вспомнить карточку в день повтора (FSRS), 0.7–0.97. */
  desiredRetention: number;
  /** Максимальный интервал, дней. */
  maximumInterval: number;
  /** Перемешивать порядок карточек в сессии. */
  shuffleQueue: boolean;
  /** Перемешивать варианты ответа в тестах :::test. */
  shuffleMcqOptions: boolean;
  /** Устаревший формат журнала, мигрируется в reviewCounts при загрузке. */
  reviewLog?: string[];
}

/** Дополнительные сведения об оценке, передаваемые плагину. */
export interface ReviewInfo {
  /**
   * Повтор внутри сессии после ответа Again: расписание в заметке не меняется,
   * карточка просто должна быть отвечена верно до конца сессии.
   */
  relearnStep: boolean;
}

/** Функция, откатывающая изменения плагина (очередь ошибок, счётчики и т.п.). */
export type UndoFn = () => Promise<void>;
