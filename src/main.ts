import {
  Debouncer,
  Editor,
  Menu,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  debounce
} from "obsidian";
import { extractFlashcards, todayStr } from "./FlashcardParser";
import { FOCUS_QUEUE_VIEW_TYPE, FocusQueueView } from "./FocusQueueView";
import { gapHighlightViewPlugin } from "./livePreview";
import { processFenceCardsForReading, processGapTextForReading } from "./readingView";
import { buildReviewQueue } from "./queue";
import { ReviewModal } from "./ReviewModal";
import { McqSettingTab } from "./settings";
import { collectFileTags } from "./tags";
import type { Flashcard, PluginSettings, Rating, ReviewInfo, UndoFn } from "./types";

interface CachedFileCards {
  mtime: number;
  size: number;
  cards: Flashcard[];
}

export default class McqSpacedRepetitionPlugin extends Plugin {
  settings: PluginSettings;
  private cardCache = new Map<string, CachedFileCards>();
  private statusBarItemEl: HTMLElement;
  private scheduleStatusBarUpdate: Debouncer<[], void>;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (gapHighlightViewPlugin) {
      this.registerEditorExtension(gapHighlightViewPlugin);
    } else {
      console.error("MCQ SR: gap highlighting extension is unavailable in this Obsidian version");
    }
    this.statusBarItemEl = this.addStatusBarItem();
    this.scheduleStatusBarUpdate = debounce(() => {
      this.updateStatusBar().catch((e) => console.error("MCQ SR: status bar update failed", e));
    }, 1500, false);
    this.registerEvent(
      this.app.vault.on("modify", (file) => this.invalidateCache(file))
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.invalidateCache(file))
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => this.invalidateCache(file))
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (oldPath) this.cardCache.delete(oldPath);
        this.invalidateCache(file);
      })
    );
    this.registerView(
      FOCUS_QUEUE_VIEW_TYPE,
      (leaf) => new FocusQueueView(leaf, this)
    );
    this.addSettingTab(new McqSettingTab(this.app, this));
    this.addRibbonIcon("brain-cog", "Start MCQ Spaced Repetition", () => {
      this.startReviewSession();
    });
    this.addCommand({
      id: "start-review-session",
      name: "Start Spaced Repetition Session",
      callback: () => {
        this.startReviewSession();
      }
    });
    this.addCommand({
      id: "show-focus-queue",
      name: "Show Focus Queue",
      callback: () => {
        this.showFocusQueue();
      }
    });
    this.addCommand({
      id: "wrap-selection-as-type-gap",
      name: "Обрамить выделенное как {{type:...}}",
      editorCallback: (editor: Editor) => {
        this.wrapSelectionAsTypeGap(editor);
      }
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        const selection = editor.getSelection();
        if (selection && selection.trim().length > 0) {
          menu.addItem((item) => {
            item.setTitle("Обрамить как {{type:...}}").setIcon("text-cursor-input").onClick(() => {
              this.wrapSelectionAsTypeGap(editor);
            });
          });
        }
      })
    );
    this.registerMarkdownPostProcessor((el) => {
      try {
        processGapTextForReading(el);
        processFenceCardsForReading(el);
      } catch (e) {
        console.error("MCQ SR: reading view post-processing error", e);
      }
    });
    this.app.workspace.onLayoutReady(() => this.scheduleStatusBarUpdate());
  }
  onunload(): void {
    this.cardCache.clear();
  }
  private invalidateCache(file: TAbstractFile): void {
    if (file && file.path) {
      this.cardCache.delete(file.path);
    }
    if (this.scheduleStatusBarUpdate) {
      this.scheduleStatusBarUpdate();
    }
  }
  /** Карточки файла; кэш сбрасывается при изменении mtime/size. */
  async getCardsForFile(file: TFile): Promise<Flashcard[]> {
    const stat = file.stat || ({} as TFile["stat"]);
    const cached = this.cardCache.get(file.path);
    if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
      return cached.cards;
    }
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (e) {
      console.error("MCQ SR: failed to read file", file.path, e);
      return [];
    }
    const cards = extractFlashcards(content, file);
    this.cardCache.set(file.path, { mtime: stat.mtime, size: stat.size, cards });
    return cards;
  }
  async getAllCards(): Promise<Flashcard[]> {
    const files = this.app.vault.getMarkdownFiles();
    const all: Flashcard[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      seen.add(file.path);
      const cards = await this.getCardsForFile(file);
      all.push(...cards);
    }
    for (const key of Array.from(this.cardCache.keys())) {
      if (!seen.has(key)) {
        this.cardCache.delete(key);
      }
    }
    return all;
  }
  isCardDue(card: Flashcard, now: number, today: string): boolean {
    if (!Number.isFinite(card.nextReview)) return false;
    if (card.nextReview > now) return false;
    return this.settings.buriedCards[card.id] !== today;
  }
  private wrapSelectionAsTypeGap(editor: Editor): void {
    const selection = editor.getSelection();
    if (!selection || !selection.trim()) {
      return;
    }
    editor.replaceSelection(`{{type:${selection}}}`);
  }
  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign(
      { focusQueue: [], reviewCounts: {}, buriedCards: {}, shuffleQueue: true, shuffleMcqOptions: true },
      data
    );
    if (!Array.isArray(this.settings.focusQueue)) {
      this.settings.focusQueue = [];
    }
    if (!this.settings.reviewCounts || typeof this.settings.reviewCounts !== "object") {
      this.settings.reviewCounts = {};
    }
    if (!this.settings.buriedCards || typeof this.settings.buriedCards !== "object") {
      this.settings.buriedCards = {};
    }
    if (Array.isArray(this.settings.reviewLog) && this.settings.reviewLog.length > 0) {
      for (const date of this.settings.reviewLog) {
        if (typeof date === "string" && date) {
          this.settings.reviewCounts[date] = (this.settings.reviewCounts[date] || 0) + 1;
        }
      }
    }
    delete this.settings.reviewLog;
    const today = todayStr();
    for (const key of Object.keys(this.settings.buriedCards)) {
      if (this.settings.buriedCards[key] !== today) {
        delete this.settings.buriedCards[key];
      }
    }
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshFocusQueueView();
    if (this.scheduleStatusBarUpdate) {
      this.scheduleStatusBarUpdate();
    }
  }
  private async updateStatusBar(): Promise<void> {
    if (!this.statusBarItemEl) return;
    const allCards = await this.getAllCards();
    const now = Date.now();
    const today = todayStr();
    const dueCards = allCards.filter((card) => this.isCardDue(card, now, today));
    if (dueCards.length > 0) {
      this.statusBarItemEl.setText(`🧠 ${dueCards.length}`);
      this.statusBarItemEl.show();
    } else {
      this.statusBarItemEl.setText("");
      this.statusBarItemEl.hide();
    }
  }
  async startReviewSession(deckTag?: string): Promise<void> {
    const allCards = await this.getAllCards();
    const now = Date.now();
    const today = todayStr();
    let dueCards = allCards.filter((card) => this.isCardDue(card, now, today));
    if (deckTag) {
      const cleanTag = deckTag.toLowerCase().replace("#", "").trim();
      dueCards = dueCards.filter((card) => collectFileTags(this.app, card.file).indexOf(cleanTag) !== -1);
    }
    if (dueCards.length === 0) {
      new Notice(deckTag ? `Нет карточек для повторения в колоде #${deckTag}!` : "Нет карточек для повторения!");
      return;
    }
    const queue = buildReviewQueue(dueCards, this.settings.shuffleQueue);
    new Notice(`Найдено карточек: ${queue.length}`);
    new ReviewModal(this.app, queue, {
      onComplete: () => {
        new Notice("Сессия повторения завершена");
      },
      onCardReviewed: (card, rating, info) => this.handleCardReviewed(card, rating, info),
      onCardBuried: (card) => this.buryCard(card),
      shuffleMcqOptions: this.settings.shuffleMcqOptions
    }).open();
  }

  /**
   * Запоминает изменяемые при повторении данные плагина и возвращает функцию,
   * которая их восстанавливает (для отмены оценки или откладывания).
   */
  private snapshotReviewData(): UndoFn {
    const saved = JSON.stringify({
      focusQueue: this.settings.focusQueue,
      reviewCounts: this.settings.reviewCounts,
      buriedCards: this.settings.buriedCards
    });
    return async () => {
      const data = JSON.parse(saved);
      this.settings.focusQueue = data.focusQueue;
      this.settings.reviewCounts = data.reviewCounts;
      this.settings.buriedCards = data.buriedCards;
      await this.saveSettings();
    };
  }

  /** Откладывает карточку до конца сегодняшнего дня. */
  private async buryCard(card: Flashcard): Promise<UndoFn> {
    const undo = this.snapshotReviewData();
    this.settings.buriedCards[card.id] = todayStr();
    await this.saveSettings();
    return undo;
  }

  private async handleCardReviewed(card: Flashcard, rating: Rating, info: ReviewInfo): Promise<UndoFn> {
    const undo = this.snapshotReviewData();
    const today = todayStr();
    this.settings.reviewCounts[today] = (this.settings.reviewCounts[today] || 0) + 1;
    if (card.siblingId) {
      this.settings.buriedCards[card.siblingId] = today;
    }
    if (rating === "Hard" || rating === "Again") {
      const alreadyInQueue = this.settings.focusQueue.some(
        (item) => item.question === card.question && item.filePath === card.file.path && !!item.isReverseDirection === !!card.isReverseDirection
      );
      if (!alreadyInQueue) {
        this.settings.focusQueue.push({
          question: card.question,
          answer: card.answer,
          filePath: card.file.path,
          type: card.type,
          isReverseDirection: card.isReverseDirection
        });
        new Notice("Добавлено в Focus Queue!");
      }
    }
    await this.saveSettings();
    return undo;
  }
  async showFocusQueue(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(FOCUS_QUEUE_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) {
        new Notice("Не удалось открыть боковую панель Spaced Repetition.");
        return;
      }
      leaf = rightLeaf;
      await leaf.setViewState({
        type: FOCUS_QUEUE_VIEW_TYPE,
        active: true
      });
    }
    workspace.revealLeaf(leaf);
    this.refreshFocusQueueView();
  }
  refreshFocusQueueView(): void {
    const leaves = this.app.workspace.getLeavesOfType(FOCUS_QUEUE_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof FocusQueueView) {
        leaf.view.refresh();
      }
    }
  }
  async startFocusQueueReview(): Promise<void> {
    const focusItems = this.settings.focusQueue;
    if (focusItems.length === 0) {
      new Notice("Focus Queue пуста!");
      return;
    }
    const cardsToReview: Flashcard[] = [];
    for (const item of focusItems) {
      const file = this.app.vault.getAbstractFileByPath(item.filePath);
      if (file instanceof TFile) {
        const fileCards = await this.getCardsForFile(file);
        const matchedCard = fileCards.find(
          (c) => c.question === item.question && c.type === item.type && !!c.isReverseDirection === !!item.isReverseDirection
        );
        if (matchedCard) {
          cardsToReview.push(matchedCard);
        }
      }
    }
    if (cardsToReview.length === 0) {
      new Notice("Не удалось найти карточки в файлах! Возможно, файлы были изменены.");
      return;
    }
    const queue = buildReviewQueue(cardsToReview, this.settings.shuffleQueue);
    new ReviewModal(this.app, queue, {
      onComplete: () => {
        new Notice("Повторение Focus Queue завершено");
      },
      onCardReviewed: async (card, rating, info) => {
        const undo = this.snapshotReviewData();
        const today = todayStr();
        this.settings.reviewCounts[today] = (this.settings.reviewCounts[today] || 0) + 1;
        // Верный ответ после ошибки в этой же сессии не снимает карточку с очереди ошибок.
        if ((rating === "Good" || rating === "Easy") && !info.relearnStep) {
          this.settings.focusQueue = this.settings.focusQueue.filter(
            (item) => !(item.question === card.question && item.filePath === card.file.path && !!item.isReverseDirection === !!card.isReverseDirection)
          );
        }
        await this.saveSettings();
        return undo;
      },
      onCardBuried: (card) => this.buryCard(card),
      shuffleMcqOptions: this.settings.shuffleMcqOptions
    }).open();
  }
}
