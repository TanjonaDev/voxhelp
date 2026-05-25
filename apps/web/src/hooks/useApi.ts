import { useState } from "react";
import type { JobAnalysis, InterviewReport, ScorecardCriterion } from "@voxhelp/shared";

interface UseApiReturn {
  analyzeJob: (jobDescription: string, techStack?: string) => Promise<JobAnalysis>;
  generateReport: (
    jobDescription: string,
    transcript: { text: string; timestamp: number }[],
    scorecard: ScorecardCriterion[]
  ) => Promise<InterviewReport>;
  isLoading: boolean;
  error: string | null;
}

export function useApi(): UseApiReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeJob = async (
    jobDescription: string,
    techStack?: string
  ): Promise<JobAnalysis> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, techStack }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as JobAnalysis;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const generateReport = async (
    jobDescription: string,
    transcript: { text: string; timestamp: number }[],
    scorecard: ScorecardCriterion[]
  ): Promise<InterviewReport> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, transcript, scorecard }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as InterviewReport;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { analyzeJob, generateReport, isLoading, error };
}
