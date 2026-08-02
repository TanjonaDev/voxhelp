import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

const MAX_CHARS = 20000;

export async function extractTextFromCv(buffer: Buffer, mimetype: string): Promise<string> {
  let text: string;

  if (mimetype === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    throw new Error(`Unsupported CV mimetype: ${mimetype}`);
  }

  return text.slice(0, MAX_CHARS);
}
