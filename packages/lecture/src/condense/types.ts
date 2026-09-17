import type { CourseContext, LectureSection } from "../types.js";

export type CondenseMode = "synthesis" | "revision";

export interface CondenseInput {
  course: CourseContext;
  plan: LectureSection[];
  document: string;
}
