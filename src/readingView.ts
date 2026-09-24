/*
 * Режим чтения: скрывает ответы {{type:...}} за «•••» и оформляет
 * блоки :::block / :::test как карточки.
 */

const GAP_REGEX_READ = /\{\{\s*type\s*:\s*([^{}]*)\}\}/gi;
export function processGapTextForReading(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while (n = walker.nextNode()) {
    if (n.nodeValue && /\{\{\s*type\s*:/i.test(n.nodeValue)) {
      nodes.push(n as Text);
    }
  }
  for (const node of nodes) {
    const text = node.nodeValue;
    GAP_REGEX_READ.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let found = false;
    const frag = document.createDocumentFragment();
    while ((match = GAP_REGEX_READ.exec(text)) !== null) {
      found = true;
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const answer = (match[1] || "").trim();
      const span = document.createElement("span");
      span.className = "mcq-reading-gap";
      span.setAttribute("data-answer", answer);
      span.textContent = "•••";
      span.title = "Нажмите, чтобы показать ответ";
      span.addEventListener("click", (evt) => {
        evt.stopPropagation();
        const revealed = span.classList.toggle("mcq-reading-gap-revealed");
        span.textContent = revealed ? span.getAttribute("data-answer") : "•••";
      });
      frag.appendChild(span);
      lastIndex = match.index + match[0].length;
    }
    if (found) {
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      node.parentNode.replaceChild(frag, node);
    }
  }
}
function stripLeadingFenceMarker(el: Element, kind: string): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (!first) {
    return;
  }
  const re = new RegExp("^\\s*:::" + kind + "\\b\\s*", "i");
  first.nodeValue = first.nodeValue.replace(re, "");
  if (first.nodeValue === "") {
    const parent = first.parentNode;
    const next = first.nextSibling;
    parent.removeChild(first);
    if (next && next.nodeName === "BR") {
      parent.removeChild(next);
    }
  }
}
function tryStripTrailingFenceMarker(el: Element): boolean {
  const trimmedFull = (el.textContent || "").trim();
  if (!/:::$/.test(trimmedFull)) {
    return false;
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let last: Node | null = null;
  while (node = walker.nextNode()) {
    last = node;
  }
  if (!last) {
    return false;
  }
  last.nodeValue = last.nodeValue.replace(/\s*:::\s*$/, "");
  if (last.nodeValue === "") {
    const parent = last.parentNode;
    const prev = last.previousSibling;
    parent.removeChild(last);
    if (prev && prev.nodeName === "BR") {
      parent.removeChild(prev);
    }
  }
  return true;
}
function processOneFenceCard(root: HTMLElement): boolean {
  if (!root.children || root.children.length === 0) {
    return false;
  }
  const children = Array.from(root.children);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.hasAttribute && child.hasAttribute("data-mcq-fence-skip")) {
      continue;
    }
    const trimmed = (child.textContent || "").trim();
    const startMatch = trimmed.match(/^:::(block|test)/i);
    if (!startMatch) {
      continue;
    }
    const kind = startMatch[1].toLowerCase();
    stripLeadingFenceMarker(child, kind);
    if (/^:::(block|test)/i.test((child.textContent || "").trim())) {
      if (child.setAttribute) {
        child.setAttribute("data-mcq-fence-skip", "1");
      }
      continue;
    }
    let endIndex = i;
    let endStripped = tryStripTrailingFenceMarker(children[endIndex]);
    while (!endStripped && endIndex < children.length - 1) {
      endIndex++;
      endStripped = tryStripTrailingFenceMarker(children[endIndex]);
    }
    const groupEls = children.slice(i, endIndex + 1);
    const card = document.createElement("div");
    card.className = "mcq-reading-card " + (kind === "block" ? "mcq-reading-card-block" : "mcq-reading-card-test");
    const label = document.createElement("div");
    label.className = "mcq-reading-card-label";
    label.textContent = kind === "block" ? "📝 Заполните пропуски" : "🔘 Выберите ответ";
    label.style.cursor = "pointer";
    label.title = "Нажмите, чтобы показать/скрыть все ответы";
    label.addEventListener("click", () => {
      const gaps = card.querySelectorAll<HTMLElement>(".mcq-reading-gap");
      if (gaps.length === 0) {
        return;
      }
      const anyHidden = Array.from(gaps).some((g) => !g.classList.contains("mcq-reading-gap-revealed"));
      gaps.forEach((g) => {
        if (anyHidden) {
          g.classList.add("mcq-reading-gap-revealed");
          g.textContent = g.getAttribute("data-answer");
        } else {
          g.classList.remove("mcq-reading-gap-revealed");
          g.textContent = "•••";
        }
      });
    });
    const firstEl = groupEls[0];
    if (!firstEl.parentNode) {
      return false;
    }
    firstEl.parentNode.insertBefore(card, firstEl);
    card.appendChild(label);
    groupEls.forEach((g) => {
      const isEmpty = (g.textContent || "").trim() === "" && g.children.length === 0 && g.tagName !== "IMG";
      if (isEmpty) {
        g.remove();
      } else {
        card.appendChild(g);
      }
    });
    return true;
  }
  return false;
}
export function processFenceCardsForReading(root: HTMLElement): void {
  let guard = 0;
  while (guard++ < 200) {
    if (!processOneFenceCard(root)) {
      return;
    }
  }
  console.warn("MCQ SR: fence card processing aborted after too many iterations");
}
