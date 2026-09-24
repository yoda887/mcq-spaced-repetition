import type { Decoration as DecorationT, DecorationSet, EditorView, ViewPlugin as ViewPluginT, ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/*
 * Подсветка {{type:...}} и строк :::block / :::test в Live Preview.
 *
 * Модули CodeMirror загружаются через require внутри try, чтобы при их
 * отсутствии (очень старая версия Obsidian) плагин продолжал работать,
 * просто без подсветки.
 */
declare const require: (id: string) => any;

let cmView: typeof import("@codemirror/view") | null = null;
let cmState: typeof import("@codemirror/state") | null = null;
try {
  cmView = require("@codemirror/view");
  cmState = require("@codemirror/state");
} catch (e) {
  console.error("MCQ SR: failed to load CodeMirror modules, gap highlighting disabled", e);
}

const GAP_REGEX_LIVE = /\{\{\s*type\s*:\s*([^{}]*)\}\}/gi;
const GAP_PREFIX_REGEX_LIVE = /^\{\{\s*type\s*:\s*/i;
const FENCE_LINE_REGEX = /^:::(block|test)\b/i;
/** Расширение редактора или null, если CodeMirror недоступен. */
export let gapHighlightViewPlugin: Extension | null = null;

interface PendingDeco {
  from: number;
  to: number;
  deco: DecorationT;
}

if (cmView && cmState) {
  const { Decoration, ViewPlugin, WidgetType } = cmView;
  const { RangeSetBuilder } = cmState;

  /** Показывает ответ пропуска вместо синтаксиса {{type:...}}. */
  class GapAnswerWidget extends WidgetType {
    text: string;

    constructor(text: string) {
      super();
      this.text = text;
    }
    eq(other: GapAnswerWidget): boolean {
      return other.text === this.text;
    }
    toDOM(): HTMLElement {
      const span = document.createElement("span");
      span.className = "mcq-live-preview-gap";
      span.textContent = this.text;
      return span;
    }
    ignoreEvent(): boolean {
      return false;
    }
  }

  class GapHighlightPluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
    buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<DecorationT>();
      try {
        const selRanges = view.state.selection.ranges;
        const decos: PendingDeco[] = [];
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          GAP_REGEX_LIVE.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = GAP_REGEX_LIVE.exec(text)) !== null) {
            const fullMatchText = match[0];
            const answerText = match[1] || "";
            const fullStart = from + match.index;
            const fullEnd = fullStart + fullMatchText.length;
            const cursorInside = selRanges.some(
              (r) => r.from <= fullEnd && r.to >= fullStart
            );
            if (!cursorInside) {
              decos.push({
                from: fullStart,
                to: fullEnd,
                deco: Decoration.replace({
                  widget: new GapAnswerWidget(answerText)
                })
              });
            } else {
              const prefixMatch = GAP_PREFIX_REGEX_LIVE.exec(fullMatchText);
              const prefixLen = prefixMatch ? prefixMatch[0].length : 0;
              const suffixLen = 2;
              if (prefixLen > 0) {
                decos.push({
                  from: fullStart,
                  to: fullStart + prefixLen,
                  deco: Decoration.mark({ class: "mcq-syntax-marker" })
                });
              }
              const suffixStart = fullEnd - suffixLen;
              if (suffixStart > fullStart + prefixLen) {
                decos.push({
                  from: suffixStart,
                  to: fullEnd,
                  deco: Decoration.mark({ class: "mcq-syntax-marker" })
                });
              }
            }
          }
          const startLine = view.state.doc.lineAt(from).number;
          const endLine = view.state.doc.lineAt(to).number;
          for (let ln = startLine; ln <= endLine; ln++) {
            const line = view.state.doc.line(ln);
            const trimmed = line.text.trim();
            if (FENCE_LINE_REGEX.test(trimmed) || trimmed === ":::") {
              decos.push({
                from: line.from,
                to: line.to,
                deco: Decoration.mark({ class: "mcq-syntax-marker" })
              });
            }
          }
        }
        decos.sort((a, b) => a.from - b.from || a.to - b.to);
        for (const d of decos) {
          if (d.from < d.to) {
            builder.add(d.from, d.to, d.deco);
          }
        }
      } catch (e) {
        console.error("MCQ SR: error building gap-highlight decorations", e);
      }
      return builder.finish();
    }
  }

  gapHighlightViewPlugin = (ViewPlugin as typeof ViewPluginT).fromClass(GapHighlightPluginValue, {
    decorations: (v) => v.decorations
  });
}
