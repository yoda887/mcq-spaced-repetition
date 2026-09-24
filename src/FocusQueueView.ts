import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { sanitizeDueDate, sanitizeEase, sanitizeInterval, toDateStr, todayStr } from "./FlashcardParser";
import { collectFileTags } from "./tags";
import type McqSpacedRepetitionPlugin from "./main";

export const FOCUS_QUEUE_VIEW_TYPE = "focus-queue-view";

type SidebarTab = "focus" | "decks" | "skills" | "stats";

/** Боковая панель: Focus Queue, колоды, дерево навыков и статистика. */
export class FocusQueueView extends ItemView {
  private plugin: McqSpacedRepetitionPlugin;
  private activeTab: SidebarTab;

  constructor(leaf: WorkspaceLeaf, plugin: McqSpacedRepetitionPlugin) {
    super(leaf);
    this.activeTab = "focus";
    this.plugin = plugin;
  }
  getViewType(): string {
    return FOCUS_QUEUE_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Spaced Repetition";
  }
  getIcon(): string {
    return "rotate-ccw";
  }
  async onOpen() {
    this.refresh();
  }
  async onClose() {
  }
  async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mcq-focus-view-container");
    const nav = contentEl.createDiv({ cls: "mcq-sidebar-nav" });
    const focusTabBtn = nav.createEl("button", {
      cls: `mcq-nav-btn ${this.activeTab === "focus" ? "active" : ""}`,
      attr: { title: "Ошибки (Focus Queue)" }
    });
    setIcon(focusTabBtn, "rotate-ccw");
    const decksTabBtn = nav.createEl("button", {
      cls: `mcq-nav-btn ${this.activeTab === "decks" ? "active" : ""}`,
      attr: { title: "Колоды (Decks)" }
    });
    setIcon(decksTabBtn, "folder");
    const skillsTabBtn = nav.createEl("button", {
      cls: `mcq-nav-btn ${this.activeTab === "skills" ? "active" : ""}`,
      attr: { title: "Навыки (Skill Tree)" }
    });
    setIcon(skillsTabBtn, "award");
    const statsTabBtn = nav.createEl("button", {
      cls: `mcq-nav-btn ${this.activeTab === "stats" ? "active" : ""}`,
      attr: { title: "Статистика" }
    });
    setIcon(statsTabBtn, "bar-chart-3");
    focusTabBtn.addEventListener("click", () => {
      this.activeTab = "focus";
      this.refresh();
    });
    decksTabBtn.addEventListener("click", () => {
      this.activeTab = "decks";
      this.refresh();
    });
    skillsTabBtn.addEventListener("click", () => {
      this.activeTab = "skills";
      this.refresh();
    });
    statsTabBtn.addEventListener("click", () => {
      this.activeTab = "stats";
      this.refresh();
    });
    if (this.activeTab === "focus") {
      await this.renderFocusQueueTab(contentEl);
    } else if (this.activeTab === "decks") {
      await this.renderDecksTab(contentEl);
    } else if (this.activeTab === "skills") {
      await this.renderSkillsTab(contentEl);
    } else if (this.activeTab === "stats") {
      await this.renderStatsTab(contentEl);
    }
  }
  private async renderFocusQueueTab(contentEl: HTMLElement): Promise<void> {
    const headerContainer = contentEl.createDiv({ cls: "mcq-header-container" });
    headerContainer.createEl("h2", { text: `Focus Queue (${this.plugin.settings.focusQueue.length})`, cls: "mcq-header" });
    if (this.plugin.settings.focusQueue.length > 0) {
      const clearAllBtn = headerContainer.createEl("button", {
        text: "Очистить всё",
        cls: "mcq-focus-clear-btn"
      });
      clearAllBtn.addEventListener("click", async () => {
        this.plugin.settings.focusQueue = [];
        await this.plugin.saveSettings();
        this.refresh();
        new Notice("Focus Queue очищена!");
      });
    }
    contentEl.createEl("p", {
      text: "Здесь собраны карточки, на которые вы ответили 'Again' или 'Hard'. Работа над ошибками.",
      cls: "mcq-focus-desc"
    });
    if (this.plugin.settings.focusQueue.length === 0) {
      contentEl.createDiv({
        text: "В очереди ошибок пусто. Отличная работа!",
        cls: "mcq-focus-empty"
      });
      return;
    }
    const actionContainer = contentEl.createDiv({ cls: "mcq-focus-actions" });
    const startReviewBtn = actionContainer.createEl("button", {
      text: "Повторить ошибки (Сессия)",
      cls: "mcq-focus-start-btn"
    });
    startReviewBtn.addEventListener("click", async () => {
      await this.plugin.startFocusQueueReview();
    });
    const listContainer = contentEl.createDiv({ cls: "mcq-focus-list" });
    this.plugin.settings.focusQueue.forEach((item, index) => {
      const cardItem = listContainer.createDiv({ cls: "mcq-focus-item" });
      const infoContainer = cardItem.createDiv({ cls: "mcq-focus-item-info" });
      const fileBasename = item.filePath.split("/").pop() || item.filePath;
      const noteTitle = infoContainer.createEl("div", {
        text: fileBasename.replace(".md", ""),
        cls: "mcq-focus-item-title"
      });
      noteTitle.addEventListener("click", () => {
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (file instanceof TFile) {
          this.app.workspace.getLeaf(false).openFile(file);
        }
      });
      infoContainer.createEl("div", {
        text: `Q: ${item.question}`,
        cls: "mcq-focus-item-q"
      });
      if (item.answer) {
        infoContainer.createEl("div", {
          text: `A: ${item.answer}`,
          cls: "mcq-focus-item-a"
        });
      }
      const actions = cardItem.createDiv({ cls: "mcq-focus-item-actions" });
      const resolveBtn = actions.createEl("button", {
        text: "Resolve",
        cls: "mcq-focus-resolve-btn"
      });
      resolveBtn.addEventListener("click", async () => {
        this.plugin.settings.focusQueue.splice(index, 1);
        await this.plugin.saveSettings();
        this.refresh();
        new Notice("Карточка удалена из Focus Queue.");
      });
    });
  }
  private async renderDecksTab(contentEl: HTMLElement): Promise<void> {
    contentEl.createEl("h2", { text: "Колоды карточек", cls: "mcq-header" });
    contentEl.createEl("p", {
      text: "Повторение карточек по конкретным темам/тегам.",
      cls: "mcq-focus-desc"
    });
    const loadingDiv = contentEl.createDiv({ text: "Загрузка колод...", cls: "mcq-loading-text" });
    const files = this.plugin.app.vault.getMarkdownFiles();
    const deckMap: Record<string, { total: number; due: number }> = {};
    const now = Date.now();
    const today = todayStr();
    for (const file of files) {
      const fileTags = collectFileTags(this.plugin.app, file);
      if (fileTags.length === 0) continue;
      const fileCards = await this.plugin.getCardsForFile(file);
      fileCards.forEach((c) => {
        const isDue = this.plugin.isCardDue(c, now, today);
        fileTags.forEach((t) => {
          if (!deckMap[t]) {
            deckMap[t] = { total: 0, due: 0 };
          }
          deckMap[t].total++;
          if (isDue) {
            deckMap[t].due++;
          }
        });
      });
    }
    loadingDiv.remove();
    const decksList = Object.keys(deckMap).map((tag) => ({
      tag,
      total: deckMap[tag].total,
      due: deckMap[tag].due
    })).sort((a, b) => b.due - a.due || a.tag.localeCompare(b.tag));
    const listContainer = contentEl.createDiv({ cls: "mcq-decks-container" });
    if (decksList.length === 0) {
      listContainer.createDiv({
        text: "Колоды не найдены. Укажите теги в заметках с карточками!",
        cls: "mcq-decks-empty"
      });
      return;
    }
    decksList.forEach((deck) => {
      const row = listContainer.createDiv({ cls: "mcq-deck-row" });
      const info = row.createDiv({ cls: "mcq-deck-info" });
      info.createEl("span", { text: `#${deck.tag}`, cls: "mcq-deck-tag" });
      const countText = `${deck.due} к повторению / ${deck.total} всего`;
      info.createEl("span", { text: countText, cls: "mcq-deck-count" });
      const actions = row.createDiv({ cls: "mcq-deck-actions" });
      const playBtn = actions.createEl("button", {
        cls: "mcq-deck-play-btn clickable-icon",
        attr: { title: `Повторить #${deck.tag}` }
      });
      setIcon(playBtn, "play");
      if (deck.due === 0) {
        playBtn.disabled = true;
        playBtn.addClass("disabled");
      } else {
        playBtn.addEventListener("click", async () => {
          await this.plugin.startReviewSession(deck.tag);
        });
      }
    });
  }
  private async renderSkillsTab(contentEl: HTMLElement): Promise<void> {
    contentEl.createEl("h2", { text: "Дерево навыков", cls: "mcq-header" });
    contentEl.createEl("p", {
      text: "Ваш уровень мастерства по темам на основе успешных повторений.",
      cls: "mcq-focus-desc"
    });
    const loadingDiv = contentEl.createDiv({ text: "Сканирование карточек...", cls: "mcq-loading-text" });
    const files = this.plugin.app.vault.getMarkdownFiles();
    const tagXP: Record<string, number> = {};
    for (const file of files) {
      const fileTags = collectFileTags(this.plugin.app, file);
      if (fileTags.length === 0) continue;
      const fileCards = await this.plugin.getCardsForFile(file);
      fileCards.forEach((c) => {
        const xp = Math.floor(sanitizeInterval(c.interval) * sanitizeEase(c.ease) * 10);
        if (xp > 0) {
          fileTags.forEach((t) => {
            tagXP[t] = (tagXP[t] || 0) + xp;
          });
        }
      });
    }
    loadingDiv.remove();
    const calculateLevelInfo = (xp: number) => {
      let level = 1;
      while (level < 1e3 && xp >= Math.pow(level, 2) * 100) {
        level++;
      }
      const currentLevelBaseXP = Math.pow(level - 1, 2) * 100;
      const nextLevelBaseXP = Math.pow(level, 2) * 100;
      const progressInLevel = xp - currentLevelBaseXP;
      const requiredForNext = Math.max(1, nextLevelBaseXP - currentLevelBaseXP);
      const percentage = Math.max(0, Math.min(100, Math.floor(progressInLevel / requiredForNext * 100)));
      return { level, xp, percentage, currentLevelBaseXP, nextLevelBaseXP };
    };
    const skillsList = Object.keys(tagXP).map((tag) => ({
      tag,
      ...calculateLevelInfo(tagXP[tag])
    })).sort((a, b) => b.xp - a.xp);
    const skillsContainer = contentEl.createDiv({ cls: "mcq-skills-container" });
    if (skillsList.length === 0) {
      skillsContainer.createDiv({
        text: "Пока нет изученных навыков. Повторяйте карточки, чтобы повышать уровни тегов!",
        cls: "mcq-skills-empty"
      });
      return;
    }
    skillsList.forEach((skill) => {
      const row = skillsContainer.createDiv({ cls: "mcq-skill-row" });
      const header = row.createDiv({ cls: "mcq-skill-header" });
      header.createEl("span", { text: `#${skill.tag}`, cls: "mcq-skill-tag" });
      header.createEl("span", { text: `Lvl ${skill.level}`, cls: "mcq-skill-level" });
      const bar = row.createDiv({ cls: "mcq-skill-bar" });
      const progress = bar.createDiv({ cls: "mcq-skill-progress" });
      progress.style.width = `${skill.percentage}%`;
      const footer = row.createDiv({ cls: "mcq-skill-footer" });
      footer.createEl("span", { text: `${skill.xp} XP` });
      footer.createEl("span", { text: `Next: ${skill.nextLevelBaseXP} XP` });
    });
  }
  private async renderStatsTab(contentEl: HTMLElement): Promise<void> {
    contentEl.createEl("h2", { text: "Статистика обучения", cls: "mcq-header" });
    const loadingDiv = contentEl.createDiv({ text: "Сбор статистики...", cls: "mcq-loading-text" });
    const files = this.plugin.app.vault.getMarkdownFiles();
    let newCards = 0;
    let learningCards = 0;
    let matureCards = 0;
    for (const file of files) {
      const fileCards = await this.plugin.getCardsForFile(file);
      fileCards.forEach((c) => {
        if (c.interval === 0) {
          newCards++;
        } else if (c.interval < 21) {
          learningCards++;
        } else {
          matureCards++;
        }
      });
    }
    loadingDiv.remove();
    const total = newCards + learningCards + matureCards;
    const reviewCounts = this.plugin.settings.reviewCounts || {};
    const datesSet = new Set(Object.keys(reviewCounts).filter((d) => reviewCounts[d] > 0));
    let streak = 0;
    if (datesSet.size > 0) {
      const today = todayStr();
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = toDateStr(yesterdayDate);
      const sortedDates = Array.from(datesSet).sort((a, b) => a < b ? 1 : a > b ? -1 : 0);
      const latestReviewDate = sortedDates[0];
      if (latestReviewDate === today || latestReviewDate === yesterday) {
        const cursor = new Date(sanitizeDueDate(latestReviewDate));
        let guard = 0;
        while (guard++ < 5e3) {
          const checkStr = toDateStr(cursor);
          if (!datesSet.has(checkStr)) break;
          streak++;
          cursor.setDate(cursor.getDate() - 1);
        }
      }
    }
    const streakContainer = contentEl.createDiv({ cls: "mcq-streak-container" });
    streakContainer.createDiv({ text: `${streak} 🔥`, cls: "mcq-streak-number animate-pulse" });
    streakContainer.createDiv({ text: "Текущая серия повторений (дней)", cls: "mcq-streak-label" });
    const cardBreakdown = contentEl.createDiv({ cls: "mcq-card-breakdown" });
    const createStatBlock = (parent: HTMLElement, val: number, label: string, colorClass: string) => {
      const block = parent.createDiv({ cls: `mcq-stat-block ${colorClass}` });
      block.createDiv({ text: val.toString(), cls: "mcq-stat-val" });
      block.createDiv({ text: label, cls: "mcq-stat-lbl" });
    };
    createStatBlock(cardBreakdown, total, "Всего", "all");
    createStatBlock(cardBreakdown, newCards, "Новые", "new");
    createStatBlock(cardBreakdown, learningCards, "Изучаемые", "learning");
    createStatBlock(cardBreakdown, matureCards, "Изученные", "mature");
    contentEl.createEl("h3", { text: "Активность (последние 12 недель)", cls: "mcq-stats-subtitle" });
    const today2 = new Date();
    const currentDayOfWeek = today2.getDay();
    const startDate = new Date(today2);
    startDate.setDate(today2.getDate() - (11 * 7 + currentDayOfWeek));
    const heatmapGrid: Array<Array<{ dateStr: string; count: number; dayOfWeek: number }>> = [];
    for (let w = 0; w < 12; w++) {
      const weekDays: Array<{ dateStr: string; count: number; dayOfWeek: number }> = [];
      for (let d = 0; d < 7; d++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + w * 7 + d);
        const dateStr = toDateStr(currentDate);
        weekDays.push({
          dateStr,
          count: reviewCounts[dateStr] || 0,
          dayOfWeek: d
        });
      }
      heatmapGrid.push(weekDays);
    }
    const heatmapContainer = contentEl.createDiv({ cls: "mcq-heatmap-container" });
    heatmapGrid.forEach((week) => {
      const weekCol = heatmapContainer.createDiv({ cls: "mcq-heatmap-column" });
      week.forEach((day) => {
        let lvl = 0;
        if (day.count > 0) {
          if (day.count <= 2)
            lvl = 1;
          else if (day.count <= 5)
            lvl = 2;
          else if (day.count <= 10)
            lvl = 3;
          else
            lvl = 4;
        }
        weekCol.createDiv({
          cls: `mcq-heatmap-cell lvl-${lvl}`,
          attr: {
            title: `${day.dateStr}: ${day.count} повторений`
          }
        });
      });
    });
    if (datesSet.size > 0) {
      const clearLogContainer = contentEl.createDiv({ cls: "mcq-clear-log-container" });
      const clearLogBtn = clearLogContainer.createEl("button", {
        text: "Сбросить историю активности",
        cls: "mcq-clear-log-btn"
      });
      clearLogBtn.addEventListener("click", async () => {
        this.plugin.settings.reviewCounts = {};
        await this.plugin.saveSettings();
        this.refresh();
        new Notice("История повторений успешно сброшена!");
      });
    }
  }
}
