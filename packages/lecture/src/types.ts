export type SectionType = "content" | "digression" | "student_question" | "administrative";
export type GlossaryCategory = "proper_noun" | "technical_term" | "concept" | "acronym" | "foreign_term";
export type ReferenceType = "author" | "work" | "article" | "scripture" | "date" | "concept";

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: number;
  confidence: number;
}

export interface CourseContext {
  title: string;
  discipline?: string;
  instructor?: string;
  language: string;
}

export interface GlossaryEntry {
  term: string;
  heardVariants: string[];
  category: GlossaryCategory;
  sourceLanguage?: string;
  shortDefinition?: string;
  occurrences: number;
  confidence: number;
}

export interface Pass1Input {
  transcript: TranscriptSegment[];
  course: CourseContext;
  existingGlossary: GlossaryEntry[];
}

export interface LectureSection {
  index: number;
  title: string;
  startMs: number;
  endMs: number;
  oneLineSummary: string;
  type: SectionType;
  confidence: number;
}

export interface Reference {
  type: ReferenceType;
  rawCitation: string;
  normalized?: string;
  contextMs: number;
  confidence: number;
}

export interface UncertainZone {
  startMs: number;
  endMs: number;
  excerpt: string;
  reason: string;
}

export interface Pass1Output {
  detectedLanguage: string;
  transcriptQuality: number;
  plan: LectureSection[];
  glossary: GlossaryEntry[];
  references: Reference[];
  uncertainZones: UncertainZone[];
}
