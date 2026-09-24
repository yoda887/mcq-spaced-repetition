import type { App, TFile } from "obsidian";

/** Теги заметки (frontmatter и inline) в нижнем регистре, без "#". */
export function collectFileTags(app: App, file: TFile): string[] {
  const fileCache = app.metadataCache.getFileCache(file);
  const tags = new Set<string>();
  if (!fileCache) return [];
  const frontmatter = fileCache.frontmatter;
  const fmTags = frontmatter ? frontmatter.tags || frontmatter.tag : null;
  if (fmTags) {
    if (Array.isArray(fmTags)) {
      fmTags.forEach((t: unknown) => tags.add(String(t).toLowerCase().replace("#", "").trim()));
    } else if (typeof fmTags === "string") {
      fmTags.split(",").forEach((t) => tags.add(t.toLowerCase().replace("#", "").trim()));
    }
  }
  if (fileCache.tags) {
    fileCache.tags.forEach((t) => {
      tags.add(t.tag.toLowerCase().replace("#", "").trim());
    });
  }
  return Array.from(tags).filter(Boolean);
}
