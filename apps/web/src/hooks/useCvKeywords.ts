import { useState, useCallback } from "react";

type CvKeywordsStatus = "idle" | "extracting" | "done" | "error";

interface UseCvKeywordsReturn {
  status: CvKeywordsStatus;
  keywords: string[];
  upload: (file: File) => Promise<void>;
}

export function useCvKeywords(token: string): UseCvKeywordsReturn {
  const [status, setStatus] = useState<CvKeywordsStatus>("idle");
  const [keywords, setKeywords] = useState<string[]>([]);

  const upload = useCallback(
    async (file: File) => {
      setStatus("extracting");
      try {
        const form = new FormData();
        form.append("cv", file);

        const res = await fetch(`http://${window.location.hostname}:3001/api/extract-cv-keywords`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        if (!res.ok) {
          setKeywords([]);
          setStatus("error");
          return;
        }

        const data = (await res.json()) as { keywords: string[] };
        setKeywords(data.keywords);
        setStatus("done");
      } catch {
        setKeywords([]);
        setStatus("error");
      }
    },
    [token]
  );

  return { status, keywords, upload };
}
