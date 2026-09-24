import { App, PluginSettingTab, Setting } from "obsidian";
import type McqSpacedRepetitionPlugin from "./main";

export class McqSettingTab extends PluginSettingTab {
  private plugin: McqSpacedRepetitionPlugin;

  constructor(app: App, plugin: McqSpacedRepetitionPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Интервалы").setHeading();

    new Setting(containerEl)
      .setName("Алгоритм")
      .setDesc("FSRS точнее подбирает интервалы по истории ответов. SM-2 — прежний упрощённый алгоритм. Переключать можно в любой момент: карточки без данных FSRS переносятся по текущему интервалу и ease.")
      .addDropdown((dd) =>
        dd
          .addOption("fsrs", "FSRS")
          .addOption("sm2", "SM-2")
          .setValue(this.plugin.settings.algorithm)
          .onChange(async (value) => {
            this.plugin.settings.algorithm = value === "sm2" ? "sm2" : "fsrs";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.algorithm === "fsrs") {
      new Setting(containerEl)
        .setName("Желаемая вероятность вспомнить")
        .setDesc("С какой вероятностью вы должны помнить карточку в день повтора. Выше — чаще повторы. Обычно 0.85–0.92.")
        .addSlider((slider) =>
          slider
            .setLimits(0.7, 0.97, 0.01)
            .setValue(this.plugin.settings.desiredRetention)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.desiredRetention = value;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Максимальный интервал, дней")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.maximumInterval)).onChange(async (value) => {
          const n = parseInt(value, 10);
          if (Number.isFinite(n) && n >= 1) {
            this.plugin.settings.maximumInterval = Math.min(36500, n);
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl).setName("Сессия").setHeading();

    new Setting(containerEl)
      .setName("Перемешивать карточки")
      .setDesc("Показывать карточки в случайном порядке и не ставить подряд карточки из одной заметки.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.shuffleQueue).onChange(async (value) => {
          this.plugin.settings.shuffleQueue = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Перемешивать варианты в тестах")
      .setDesc("Менять порядок вариантов ответа в блоках :::test от сессии к сессии. Выключите, если в тестах есть варианты вроде «все перечисленные».")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.shuffleMcqOptions).onChange(async (value) => {
          this.plugin.settings.shuffleMcqOptions = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Горячие клавиши в окне повторения")
      .setDesc("1–4 — Again / Hard / Good / Easy, в тестах 1–9 — выбор варианта, Enter — проверить или рекомендованная оценка, U — отменить, S — пропустить, B — отложить до завтра.");
  }
}
