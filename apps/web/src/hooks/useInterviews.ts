import { supabase } from "../lib/supabase";

export interface InterviewSummary {
  id: string;
  title: string;
  candidate_name: string;
  status: "prep" | "live" | "review" | "completed";
  overall_score: number | null;
  recommendation: string | null;
  created_at: string;
  duration_seconds: number | null;
}

export interface TranscriptRow {
  text: string;
  timestamp_ms: number;
}

export interface AssistCardRow {
  cat: string;
  evidence: string;
  title: string;
  body: string;
  relance: string | null;
  timestamp_ms: number;
}

export interface ReportPayload {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  red_flags: string[];
  recommendation: string;
  overall_score: number;
  scored_criteria: unknown;
}

export function useInterviews(userId: string | undefined) {
  const list = async () => {
    if (!userId) return [];
    const { data, error } = await supabase
      .from("interviews")
      .select(
        "id, title, candidate_name, status, overall_score, recommendation, created_at, duration_seconds"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  };

  const get = async (id: string) => {
    const { data, error } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  };

  const create = async (interview: {
    title: string;
    candidateName: string;
    jobDescription: string;
    techStack?: string;
    language?: string;
  }) => {
    const { data, error } = await supabase
      .from("interviews")
      .insert({
        user_id: userId,
        title: interview.title,
        candidate_name: interview.candidateName,
        job_description: interview.jobDescription,
        tech_stack: interview.techStack || null,
        language: interview.language || "fr",
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const update = async (id: string, fields: Record<string, unknown>) => {
    const { error } = await supabase.from("interviews").update(fields).eq("id", id);
    if (error) throw error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("interviews").delete().eq("id", id);
    if (error) throw error;
  };

  const saveTranscripts = async (interviewId: string, transcripts: TranscriptRow[]) => {
    const rows = transcripts.map((t) => ({
      interview_id: interviewId,
      text: t.text,
      timestamp_ms: t.timestamp_ms,
    }));
    const { error } = await supabase.from("transcripts").insert(rows);
    if (error) throw error;
  };

  const saveAssistCards = async (interviewId: string, cards: AssistCardRow[]) => {
    const rows = cards.map((c) => ({
      interview_id: interviewId,
      ...c,
    }));
    const { error } = await supabase.from("assist_cards").insert(rows);
    if (error) throw error;
  };

  const saveReport = async (interviewId: string, report: ReportPayload) => {
    const { error } = await supabase.from("reports").insert({
      interview_id: interviewId,
      ...report,
    });
    if (error) throw error;
  };

  const getReport = async (interviewId: string) => {
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("interview_id", interviewId)
      .single();
    if (error && error.code !== "PGRST116") throw error; // PGRST116 = not found
    return data;
  };

  const getTranscripts = async (interviewId: string) => {
    const { data, error } = await supabase
      .from("transcripts")
      .select("*")
      .eq("interview_id", interviewId)
      .order("timestamp_ms", { ascending: true });
    if (error) throw error;
    return data;
  };

  const getAssistCards = async (interviewId: string) => {
    const { data, error } = await supabase
      .from("assist_cards")
      .select("*")
      .eq("interview_id", interviewId)
      .order("timestamp_ms", { ascending: true });
    if (error) throw error;
    return data;
  };

  return {
    list,
    get,
    create,
    update,
    remove,
    saveTranscripts,
    saveAssistCards,
    saveReport,
    getReport,
    getTranscripts,
    getAssistCards,
  };
}
