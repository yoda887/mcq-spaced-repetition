import { App, Component, MarkdownRenderer, Modal, Notice, setIcon } from "obsidian";
import { buildWordDiffFragment, evaluateAnswer, normalizeAnswer } from "./AnswerCheck";
import {
  applyCardEdit,
  applyCardUpdate,
  escapeAttr,
  extractFlashcards,
  nextDomId,
  sanitizeDueDate,
  toDateStr
} from "./FlashcardParser";
import { calculateNextReview } from "./SM2";
import type { Flashcard, Rating } from "./types";

export type CardReviewedCallback = (card: Flashcard, rating: Rating) => Promise<void> | void;

async function renderCardMarkdown(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
  if (MarkdownRenderer.render) {
    await MarkdownRenderer.render(app, markdown, el, sourcePath, component);
  } else {
    // Старые версии Obsidian (< 1.3) без MarkdownRenderer.render
    await (MarkdownRenderer as any).renderMarkdown(markdown, el, sourcePath, component);
  }
}
function applyGapInputWidths(container: HTMLElement): void {
  const inputs = container.querySelectorAll<HTMLInputElement>("input.mcq-cloze-input");
  inputs.forEach((inputEl) => {
    const ans = inputEl.getAttribute("data-answer") || "";
    const widthCh = Math.max(3, ans.length + 2);
    inputEl.style.width = `${widthCh}ch`;
  });
}

export class ReviewModal extends Modal {
  private flashcards: Flashcard[];
  private onComplete: () => void;
  private onCardReviewed?: CardReviewedCallback;
  private mdComponent: Component;
  private currentIndex: number;
  private isEditMode: boolean;
  private isClosed: boolean;
  private isProcessing: boolean;
  private timeouts: number[];

  constructor(app: App, flashcards: Flashcard[], onComplete: () => void, onCardReviewed?: CardReviewedCallback) {
    super(app);
    this.currentIndex = 0;
    this.isEditMode = false;
    this.isClosed = false;
    this.isProcessing = false;
    this.timeouts = [];
    this.flashcards = flashcards;
    this.onComplete = onComplete;
    this.onCardReviewed = onCardReviewed;
    this.mdComponent = new Component();
  }
  onOpen() {
    this.modalEl.addClass("mcq-review-modal");
    this.mdComponent.load();
    this.scope.register([], "Enter", (evt) => {
      return this.handleKeyPress("Enter", evt);
    });
    this.scope.register([], " ", (evt) => {
      return this.handleKeyPress("Space", evt);
    });
    this.scope.register([], "1", (evt) => {
      return this.handleKeyPress("1", evt);
    });
    this.scope.register([], "2", (evt) => {
      return this.handleKeyPress("2", evt);
    });
    this.scope.register([], "3", (evt) => {
      return this.handleKeyPress("3", evt);
    });
    this.scope.register([], "4", (evt) => {
      return this.handleKeyPress("4", evt);
    });
    this.renderCurrentCard();
  }
  /** Возвращает false, чтобы Obsidian не обрабатывал нажатие дальше. */
  private handleKeyPress(key: string, evt: KeyboardEvent): boolean {
    if (this.isEditMode)
      return true;
    const target = (evt && evt.target) as HTMLElement | null;
    const isClozeInputFocused = !!(target && target.classList && (target.classList.contains("mcq-cloze-input") || target.classList.contains("mcq-block-input")));
    if (isClozeInputFocused) {
      if (key === "Enter") {
        const checkBtn2 = this.contentEl.querySelector<HTMLButtonElement>(".mcq-cloze-check-btn");
        if (checkBtn2 && checkBtn2.style.display !== "none") {
          checkBtn2.click();
        }
        return false;
      }
      return true;
    }
    const card = this.flashcards[this.currentIndex];
    if (!card)
      return false;
    const showAnswerBtn = this.contentEl.querySelector<HTMLElement>(".mcq-show-answer-link");
    const isAnswerShown = !showAnswerBtn || showAnswerBtn.style.display === "none";
    if (card.type === "mcq") {
      if (key === "1" || key === "2" || key === "3" || key === "4") {
        const idx = parseInt(key) - 1;
        const options = this.contentEl.querySelectorAll(".mcq-option-row");
        if (options && options[idx]) {
          const radio = options[idx].querySelector<HTMLInputElement>("input[type='radio']");
          if (radio && !radio.disabled) {
            radio.click();
          }
        }
      }
    } else if (card.type === "block" || card.type === "cloze" && card._hasTypeGap) {
      if (key === "Enter") {
        const checkBtn2 = this.contentEl.querySelector<HTMLButtonElement>(".mcq-cloze-check-btn");
        if (checkBtn2 && checkBtn2.style.display !== "none") {
          checkBtn2.click();
        } else {
          const suggestedBtn = this.contentEl.querySelector<HTMLButtonElement>(".mcq-grading-buttons button.mcq-suggested");
          if (suggestedBtn && !suggestedBtn.disabled)
            suggestedBtn.click();
        }
      } else {
        this.clickGradeByKey(key);
      }
    } else {
      if (!isAnswerShown) {
        if (key === "Space" || key === "Enter") {
          if (showAnswerBtn)
            showAnswerBtn.click();
        }
      } else {
        this.clickGradeByKey(key);
      }
    }
    return false;
  }
  private clickGradeByKey(key: string): void {
    const map: Record<string, string> = { "1": ".mcq-btn-again", "2": ".mcq-btn-hard", "3": ".mcq-btn-good", "4": ".mcq-btn-easy" };
    const sel = map[key];
    if (!sel)
      return;
    const btn = this.contentEl.querySelector<HTMLButtonElement>(sel);
    if (btn && !btn.disabled)
      btn.click();
  }
  private renderGradingButtons(container: HTMLElement, card: Flashcard, suggested: Rating | null): void {
    const buttonsContainer = container.createDiv({ cls: "mcq-grading-buttons" });
    const defs: Array<{ rating: Rating; cls: string; key: string }> = [
      { rating: "Again", cls: "mcq-btn-again", key: "1" },
      { rating: "Hard", cls: "mcq-btn-hard", key: "2" },
      { rating: "Good", cls: "mcq-btn-good", key: "3" },
      { rating: "Easy", cls: "mcq-btn-easy", key: "4" }
    ];
    const buttons = defs.map((def) => {
      const interval = calculateNextReview(card.ease, card.interval, def.rating).interval;
      const btn = buttonsContainer.createEl("button", {
        text: `${def.rating} (${interval}d)`,
        cls: def.cls,
        attr: { title: `Клавиша ${def.key}` }
      });
      if (def.rating === suggested)
        btn.classList.add("mcq-suggested");
      return btn;
    });
    buttons.forEach((btn, idx) => {
      btn.addEventListener("click", async () => {
        buttons.forEach((b) => b.disabled = true);
        await this.processAnswer(card, defs[idx].rating);
      });
    });
    container.createDiv({
      cls: "mcq-key-hint",
      text: suggested ? "1–4 — оценка, Enter — рекомендованная" : "1–4 — оценка"
    });
  }
  onClose() {
    this.isClosed = true;
    this.timeouts.forEach((id) => window.clearTimeout(id));
    this.timeouts = [];
    const { contentEl } = this;
    contentEl.empty();
    this.mdComponent.unload();
    this.onComplete();
  }
  private async renderCurrentCard(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    if (this.currentIndex >= this.flashcards.length) {
      contentEl.createEl("h2", { text: "Поздравляем! Вы повторили все доступные карточки." });
      return;
    }
    const card = this.flashcards[this.currentIndex];
    this.modalEl.removeClass("mcq-modal-mcq");
    this.modalEl.removeClass("mcq-modal-multiline");
    this.modalEl.removeClass("mcq-modal-standard");
    if (card.type === "mcq") {
      this.modalEl.addClass("mcq-modal-mcq");
    } else if (card.type === "multiline" || card.type === "block") {
      this.modalEl.addClass("mcq-modal-multiline");
    } else {
      this.modalEl.addClass("mcq-modal-standard");
    }
    const headerContainer = contentEl.createDiv({ cls: "mcq-header-container" });
    const titleRow = headerContainer.createDiv({ cls: "mcq-title-row" });
    titleRow.createEl("h2", { text: "Повторение (Spaced Repetition)", cls: "mcq-header" });
    const editBtn = titleRow.createEl("button", {
      cls: "mcq-edit-btn clickable-icon",
      attr: { title: "Редактировать карточку" }
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", () => {
      this.isEditMode = true;
      this.renderEditMode(card);
    });
    const pathParts = card.file.path.split("/");
    pathParts[pathParts.length - 1] = card.file.basename;
    const breadcrumbs = pathParts.join(" › ");
    const fileLinkContainer = headerContainer.createDiv({ cls: "mcq-file-link-container" });
    const fileLink = fileLinkContainer.createEl("a", {
      text: `Из заметки: ${breadcrumbs}`,
      cls: "mcq-file-link",
      href: "#"
    });
    fileLink.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.workspace.getLeaf(false).openFile(card.file);
      this.close();
    });
    const cardBodyEl = contentEl.createDiv({ cls: "mcq-card-body" });
    if (this.isEditMode) {
      this.renderEditMode(card);
      return;
    }
    const questionContainer = cardBodyEl.createDiv({ cls: "mcq-question mcq-question-card" });
    if (card.type === "cloze") {
      const bareCardLine = card.body || card.fullMatch || "";
      let gapIndex = 0;
      let hasTypeGap = false;
      const questionHtml = bareCardLine.replace(/\{\{([^{}]+)\}\}/g, (_match: string, p1: string) => {
        const raw = p1.trim();
        const idx = gapIndex++;
        const typeMatch = raw.match(/^type\s*:\s*(.*)$/i);
        if (typeMatch) {
          hasTypeGap = true;
          const rawAns = typeMatch[1].trim();
          const ans = escapeAttr(rawAns);
          const widthCh = Math.max(3, rawAns.length + 2);
          return `<input type="text" class="mcq-cloze-input" data-answer="${ans}" data-gap-index="${idx}" autocomplete="off" autocapitalize="off" spellcheck="false" style="width: ${widthCh}ch;" />`;
        }
        const ans = escapeAttr(raw);
        return `<span class="mcq-cloze-gap" data-answer="${ans}" data-gap-index="${idx}">[...]</span>`;
      }).replace(/==([^=]+)==/g, (_match: string, p1: string) => {
        const idx = gapIndex++;
        const ans = escapeAttr(p1.trim());
        return `<span class="mcq-cloze-gap" data-answer="${ans}" data-gap-index="${idx}">[...]</span>`;
      });
      card._hasTypeGap = hasTypeGap;
      await renderCardMarkdown(this.app, questionHtml, questionContainer, card.file.path, this.mdComponent);
      applyGapInputWidths(questionContainer);
    } else if (card.type === "block") {
      let gapIndex = 0;
      const rawLines = (card.answer || "").split(/\r?\n/);
      const markdownLines = rawLines.map((line) => {
        return line.replace(/\{\{\s*type\s*:\s*([^{}]*)\}\}/gi, (_m: string, p1: string) => {
          const idx = gapIndex++;
          const rawAns = p1.trim();
          const ans = escapeAttr(rawAns);
          const widthCh = Math.max(3, rawAns.length + 2);
          return `<input type="text" class="mcq-cloze-input mcq-block-input" data-answer="${ans}" data-gap-index="${idx}" autocomplete="off" autocapitalize="off" spellcheck="false" style="width: ${widthCh}ch;" />`;
        });
      });
      const questionMarkdown = markdownLines.join("\n");
      questionContainer.addClass("mcq-block-question");
      await renderCardMarkdown(this.app, questionMarkdown, questionContainer, card.file.path, this.mdComponent);
      applyGapInputWidths(questionContainer);
    } else {
      await renderCardMarkdown(this.app, card.question, questionContainer, card.file.path, this.mdComponent);
    }
    const mcqUsable = card.type === "mcq" && Array.isArray(card.options) && card.options.length > 0 && card.options.some((o) => o.isCorrect);
    if (card.type === "mcq" && !mcqUsable) {
      cardBodyEl.createDiv({
        text: card.validationMessage || "Карточка :::test заполнена некорректно — оцените её вручную.",
        cls: "mcq-focus-desc"
      });
    }
    if (mcqUsable) {
      const optionsContainer = cardBodyEl.createDiv({ cls: "mcq-options" });
      const groupName = `mcq-answer-${nextDomId()}`;
      card.options.forEach((option, index) => {
        const optionRow = optionsContainer.createDiv({ cls: "mcq-option-row" });
        const radioId = `${groupName}-${index}`;
        const radio = optionRow.createEl("input", {
          type: "radio",
          attr: {
            id: radioId,
            name: groupName,
            value: index.toString()
          }
        });
        optionRow.createEl("label", {
          text: option.text,
          attr: {
            for: radioId
          }
        });
        radio.addEventListener("change", () => {
          const allRadios = optionsContainer.querySelectorAll<HTMLInputElement>("input[type='radio']");
          allRadios.forEach((r) => r.disabled = true);
          const isCorrect = option.isCorrect;
          if (isCorrect) {
            optionRow.addClass("mcq-correct");
          } else {
            optionRow.addClass("mcq-incorrect");
            const correctIndex = card.options.findIndex((o) => o.isCorrect);
            if (correctIndex >= 0) {
              const correctRow = optionsContainer.children[correctIndex] as HTMLElement | undefined;
              if (correctRow) correctRow.addClass("mcq-correct");
            }
          }
          const timer = window.setTimeout(() => {
            if (this.isClosed) return;
            this.processAnswer(card, isCorrect ? "Good" : "Hard");
          }, 1500);
          this.timeouts.push(timer);
        });
      });
    } else if (card.type === "cloze" && card._hasTypeGap || card.type === "block") {
      const controlsContainer = cardBodyEl.createDiv({ cls: "mcq-controls-container" });
      const checkBtn = controlsContainer.createEl("button", { text: "Проверить", cls: "mcq-cloze-check-btn" });
      const clozeInputs = questionContainer.querySelectorAll<HTMLInputElement>(".mcq-cloze-input");
      const clozeGaps = questionContainer.querySelectorAll<HTMLElement>(".mcq-cloze-gap");
      let checked = false;
      const doCheck = async () => {
        if (checked)
          return;
        checked = true;
        let exactCount = 0;
        let almostCount = 0;
        const total = clozeInputs.length;
        clozeInputs.forEach((inputEl) => {
          const correctAns = (inputEl.getAttribute("data-answer") || "").trim();
          const typedAns = (inputEl.value || "").trim();
          const result = evaluateAnswer(typedAns, correctAns);
          const field = document.createElement("span");
          field.classList.add("mcq-word-diff-field");
          let afterEl: HTMLElement = field;
          if (result.status === "correct") {
            exactCount++;
            field.classList.add("mcq-result-correct");
            field.textContent = typedAns;
            const mark = document.createElement("span");
            mark.className = "mcq-cloze-correct-mark";
            mark.textContent = "✓";
            mark.setAttribute("aria-label", "Верно");
            inputEl.replaceWith(field);
            field.insertAdjacentElement("afterend", mark);
            afterEl = mark;
          } else {
            if (result.status === "almost") {
              almostCount++;
              field.classList.add("mcq-result-almost");
              field.setAttribute("title", "Почти верно — опечатка");
            } else {
              field.classList.add("mcq-result-wrong");
            }
            field.appendChild(buildWordDiffFragment(typedAns, result.best));
            inputEl.replaceWith(field);
          }
          const others = result.alternatives.filter((a) => normalizeAnswer(a) !== normalizeAnswer(result.best));
          if (others.length > 0) {
            const altsEl = document.createElement("span");
            altsEl.className = "mcq-word-diff-alts";
            altsEl.textContent = `(также: ${others.join(" / ")})`;
            afterEl.insertAdjacentElement("afterend", altsEl);
          }
        });
        clozeGaps.forEach((gap) => {
          const ans = gap.getAttribute("data-answer") || "";
          gap.setText(ans);
          gap.addClass("mcq-cloze-revealed");
          gap.removeClass("mcq-cloze-gap");
        });
        checkBtn.hide();
        let suggested: Rating = "Good";
        if (total > 0 && exactCount < total) {
          suggested = exactCount + almostCount === 0 ? "Again" : "Hard";
        }
        if (total > 0) {
          const summary = controlsContainer.createDiv({ cls: "mcq-check-summary" });
          summary.classList.add(exactCount === total ? "is-correct" : exactCount + almostCount === 0 ? "is-wrong" : "is-partial");
          let text = `Верно: ${exactCount} из ${total}`;
          if (almostCount > 0) {
            text += ` · с опечаткой: ${almostCount}`;
          }
          summary.setText(text);
        }
        this.renderGradingButtons(controlsContainer, card, suggested);
      };
      checkBtn.addEventListener("click", (e) => {
        e.preventDefault();
        doCheck();
      });
      if (clozeInputs.length > 0) {
        clozeInputs[0].focus();
      } else {
        doCheck();
      }
    } else {
      const controlsContainer = cardBodyEl.createDiv({ cls: "mcq-controls-container" });
      const showAnswerBtn = controlsContainer.createEl("a", { text: "Показать ответ", cls: "mcq-show-answer-link", href: "#" });
      showAnswerBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        showAnswerBtn.hide();
        if (card.type === "cloze") {
          const gaps = questionContainer.querySelectorAll<HTMLElement>(".mcq-cloze-gap");
          gaps.forEach((gap) => {
            const ans = gap.getAttribute("data-answer") || "";
            gap.setText(ans);
            gap.addClass("mcq-cloze-revealed");
            gap.removeClass("mcq-cloze-gap");
          });
        } else {
          const answerContainer = cardBodyEl.createDiv({ cls: "mcq-answer mcq-answer-card" });
          await renderCardMarkdown(this.app, card.answer || "", answerContainer, card.file.path, this.mdComponent);
          cardBodyEl.appendChild(controlsContainer);
        }
        this.renderGradingButtons(controlsContainer, card, null);
      });
    }
  }
  private renderEditMode(card: Flashcard): void {
    const { contentEl } = this;
    let cardBodyEl = contentEl.querySelector<HTMLElement>(".mcq-card-body");
    if (!cardBodyEl) {
      cardBodyEl = contentEl.createDiv({ cls: "mcq-card-body" });
    }
    cardBodyEl.empty();
    const originalText = card.editText || card.body || card.fullMatch || "";
    cardBodyEl.createEl("h3", { text: "Редактирование карточки", cls: "mcq-edit-title" });
    const textarea = cardBodyEl.createEl("textarea", {
      cls: "mcq-edit-textarea",
      attr: { rows: "6" }
    });
    textarea.value = originalText;
    const actionButtons = cardBodyEl.createDiv({ cls: "mcq-edit-actions" });
    const saveBtn = actionButtons.createEl("button", { text: "Сохранить", cls: "mcq-edit-save-btn" });
    const cancelBtn = actionButtons.createEl("button", { text: "Отмена", cls: "mcq-edit-cancel-btn" });
    cancelBtn.addEventListener("click", () => {
      this.isEditMode = false;
      this.renderCurrentCard();
    });
    saveBtn.addEventListener("click", async () => {
      const newText = textarea.value.trim();
      if (!newText) {
        new Notice("Карточка не может быть пустой!");
        return;
      }
      saveBtn.disabled = true;
      try {
        const saved = await applyCardEdit(this.app, card, newText);
        if (!saved) {
          new Notice("Ошибка: не удалось найти исходный текст в файле.");
        } else {
          const reparsed = extractFlashcards(newText, card.file);
          const updated = reparsed.find(
            (c) => c.type === card.type && !!c.isReverseDirection === !!card.isReverseDirection
          ) || reparsed[0];
          if (updated) {
            card.question = updated.question;
            card.answer = updated.answer;
            card.options = updated.options;
            card.isValid = updated.isValid;
            card.validationMessage = updated.validationMessage;
            card.body = updated.body;
            card.editText = updated.editText;
            card.fullMatch = updated.fullMatch;
            card._hasTypeGap = void 0;
          }
          new Notice("Карточка сохранена!");
        }
      } catch (e) {
        console.error("MCQ SR: failed to save card edit", e);
        new Notice("Не удалось сохранить карточку — подробности в консоли разработчика.");
      } finally {
        saveBtn.disabled = false;
      }
      if (this.isClosed) return;
      this.isEditMode = false;
      this.renderCurrentCard();
    });
  }
  private async processAnswer(card: Flashcard, rating: Rating): Promise<void> {
    if (this.isClosed || this.isProcessing) return;
    this.isProcessing = true;
    try {
      const { ease, interval } = calculateNextReview(card.ease, card.interval, rating);
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + interval);
      const dateString = toDateStr(nextDate);
      const newSrData = `<!--SR:${dateString},${interval},${ease.toFixed(2)}-->`;
      await applyCardUpdate(this.app, card, newSrData);
      card.ease = ease;
      card.interval = interval;
      card.nextReview = sanitizeDueDate(dateString);
      if (this.onCardReviewed) {
        await this.onCardReviewed(card, rating);
      }
    } catch (e) {
      console.error("MCQ SR: failed to save review result", e);
      new Notice("Не удалось сохранить результат повтора — подробности в консоли разработчика.");
    } finally {
      this.isProcessing = false;
    }
    if (this.isClosed) return;
    this.currentIndex++;
    this.renderCurrentCard();
  }
}
