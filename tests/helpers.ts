import type { TFile } from "obsidian";

/** Минимальная заглушка файла: парсеру нужны только path и basename. */
export function fakeFile(path = "note.md"): TFile {
  return { path, basename: path.replace(/\.md$/, "") } as unknown as TFile;
}
