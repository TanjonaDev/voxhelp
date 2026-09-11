export type PdfBlockType = "heading" | "paragraph" | "citation" | "table" | "exercise";

export interface PdfBlock {
  page: number;
  type: PdfBlockType;
  anchorTitle?: string;
  content: string;
  reference?: string;
}

export interface PdfAnalysis {
  sourceFilename: string;
  blocks: PdfBlock[];
}

export interface PdfPage {
  page: number;
  text: string;
}
