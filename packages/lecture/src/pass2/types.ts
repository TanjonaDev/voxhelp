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
  pdfAnalysis?: PdfAnalysis;
}
