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
export interface Schedule {
  nextReview: number;
  interval: number;
  ease: number;
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
  /** Устаревший формат журнала, мигрируется в reviewCounts при загрузке. */
  reviewLog?: string[];
}
