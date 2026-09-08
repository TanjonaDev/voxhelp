import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

const MAX_CHARS = 20000;

export type CvFormat = "pdf" | "docx";

export async function extractTextFromCv(buffer: Buffer, format: CvFormat): Promise<string> {
  let text: string;

  if (format === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  }

  return text.slice(0, MAX_CHARS);
}
