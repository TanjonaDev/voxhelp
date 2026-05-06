export interface CreateInterviewRequest {
  title: string;
  candidateName: string;
  candidateEmail?: string;
  language: string;
  jobDescription?: string;
  techStack?: string;
  cvContent?: string;
  scheduledAt?: string;
}

export interface GenerateQuestionsRequest {
  interviewId: string;
}

export interface GenerateScorecardRequest {
  interviewId: string;
}

export interface GenerateSummaryRequest {
  interviewId: string;
}

export interface InterviewListItem {
  id: string;
  title: string;
  candidateName: string;
  status: string;
  scheduledAt: string | null;
  overallScore: number | null;
  recommendation: string | null;
  createdAt: string;
}

export interface InterviewDetail {
  id: string;
  title: string;
  candidateName: string;
  candidateEmail: string | null;
  status: string;
  language: string;
  jobDescription: string | null;
  techStack: string | null;
  cvContent: string | null;
  questions: QuestionItem[];
  scorecard: ScorecardDetail | null;
  summary: SummaryDetail | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface QuestionItem {
  id: string;
  text: string;
  category: string;
  difficulty: string;
  expectedAnswer: string | null;
  order: number;
  isAsked: boolean;
  answer: {
    transcript: string;
    score: number | null;
    notes: string | null;
  } | null;
}

export interface ScorecardDetail {
  id: string;
  criteria: CriterionItem[];
  overallScore: number | null;
  recommendation: string | null;
}

export interface CriterionItem {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  score: number | null;
  notes: string | null;
}

export interface SummaryDetail {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  redFlags: string[];
  keyTopics: string[];
  followUpActions: string[];
}
