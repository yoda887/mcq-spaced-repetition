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
      .setDesc("1–4 — Again / Hard / Good / Easy, Enter — проверить или рекомендованная оценка, U — отменить, S — пропустить, B — отложить до завтра.");
  }
}
