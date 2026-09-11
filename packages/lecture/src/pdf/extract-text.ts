import { extractText, getDocumentProxy } from "unpdf";
import type { PdfPage } from "./types.js";

export async function extractPdfPages(buffer: Buffer): Promise<PdfPage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: false });
  return result.text.map((text, index) => ({ page: index + 1, text }));
}
