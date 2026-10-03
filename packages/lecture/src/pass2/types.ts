import type {
  CourseContext,
  GlossaryEntry,
  LectureSection,
  Reference,
  TranscriptSegment,
  UncertainZone,
} from "../types.js";
import type { PdfAnalysis } from "../pdf/types.js";

export interface Pass2Input {
  transcript: TranscriptSegment[];
  course: CourseContext;
  plan: LectureSection[];
  glossary: GlossaryEntry[];
  references: Reference[];
  uncertainZones: UncertainZone[];
  pdfAnalyses?: PdfAnalysis[];
}

/**
 * Injectable checkpoint for the per-group pass2 rewrite, same spirit as
 * Pass1Cache in analyze.ts: this package stays pure, the backend wires it up
 * to a disk-backed cache when a jobId is available. The cached value is the
 * group's raw rewritten Markdown text (not JSON-structured output).
 */
export interface Pass2Cache {
  get(groupIndex: number): Promise<string | null>;
  set(groupIndex: number, text: string): Promise<void>;
}
