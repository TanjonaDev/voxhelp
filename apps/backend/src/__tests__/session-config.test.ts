import { describe, it, expect } from "vitest";
import {
  parseSessionConfig,
  INVALID_SESSION_CONFIG,
  MAX_KEYWORDS,
  MAX_KEYWORD_LENGTH,
} from "../session-config.js";

const REJECTED = { ok: false, error: INVALID_SESSION_CONFIG };

describe("parseSessionConfig", () => {
  it("exposes the client-facing error message", () => {
    expect(INVALID_SESSION_CONFIG).toBe("Configuration de session invalide");
  });

  describe("valid configs", () => {
    it("passes a full real-front config through identically", () => {
      const raw = {
        language: "fr",
        keywords: ["Kubernetes", "RMC BFM", "Cléo"],
        jobContext: { title: "Dev Backend", level: "Senior", stack: "Node, Postgres" },
        candidateName: "Awa Diallo",
        sttProvider: "inworld",
      };
      expect(parseSessionConfig(raw)).toEqual({ ok: true, config: raw });
    });

    it("keeps only the language when everything else is absent", () => {
      const parsed = parseSessionConfig({ language: "en" });
      expect(parsed).toEqual({ ok: true, config: { language: "en" } });
      if (parsed.ok) {
        expect(parsed.config.keywords).toBeUndefined();
        expect(parsed.config.jobContext).toBeUndefined();
        expect(parsed.config.candidateName).toBeUndefined();
        expect(parsed.config.sttProvider).toBeUndefined();
      }
    });

    it.each(["fr", "en", "es", "pt", "zh"])("accepts language %s", (language) => {
      expect(parseSessionConfig({ language })).toEqual({ ok: true, config: { language } });
    });

    it("keeps an empty sttProvider string (server default) as is", () => {
      const parsed = parseSessionConfig({ language: "fr", sttProvider: "" });
      expect(parsed.ok && parsed.config.sttProvider).toBe("");
    });

    it("accepts an empty keywords array", () => {
      const parsed = parseSessionConfig({ language: "fr", keywords: [] });
      expect(parsed.ok && parsed.config.keywords).toEqual([]);
    });
  });

  describe("rejections", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["an array", [{ language: "fr" }]],
      ["a string", "fr"],
      ["a number", 42],
      ["a boolean", true],
    ])("rejects a raw config that is %s", (_label, raw) => {
      expect(parseSessionConfig(raw)).toEqual(REJECTED);
    });

    it.each([
      ["missing", {}],
      ["unknown", { language: "xx" }],
      ["a number", { language: 1 }],
      ["null", { language: null }],
      ["wrong case", { language: "FR" }],
    ])("rejects a language that is %s", (_label, raw) => {
      expect(parseSessionConfig(raw)).toEqual(REJECTED);
    });

    it.each([
      ["a string", "abc"],
      ["a number", 3],
      ["an object", { 0: "abc", length: 1 }],
      ["null", null],
      ["a boolean", false],
    ])("rejects keywords that are %s", (_label, keywords) => {
      expect(parseSessionConfig({ language: "fr", keywords })).toEqual(REJECTED);
    });

    it.each([
      ["a string", "x"],
      ["null", null],
      ["an array", [{ title: "a" }]],
      ["a number", 1],
    ])("rejects a jobContext that is %s", (_label, jobContext) => {
      expect(parseSessionConfig({ language: "fr", jobContext })).toEqual(REJECTED);
    });

    it.each([
      ["a number", 12],
      ["null", null],
      ["an object", { name: "Awa" }],
    ])("rejects a candidateName that is %s", (_label, candidateName) => {
      expect(parseSessionConfig({ language: "fr", candidateName })).toEqual(REJECTED);
    });

    it.each([
      ["a number", 5],
      ["null", null],
      ["an object", { id: "inworld" }],
      ["a boolean", true],
    ])("rejects an sttProvider that is %s", (_label, sttProvider) => {
      expect(parseSessionConfig({ language: "fr", sttProvider })).toEqual(REJECTED);
    });
  });

  describe("keywords filtering", () => {
    it("drops non-string items", () => {
      const parsed = parseSessionConfig({ language: "fr", keywords: [1, null, "Kubernetes", {}, ["x"], true] });
      expect(parsed.ok && parsed.config.keywords).toEqual(["Kubernetes"]);
    });

    it("drops empty and whitespace-only items and trims the others", () => {
      const parsed = parseSessionConfig({ language: "fr", keywords: ["", "   ", "\t\n", "  React  ", "Node"] });
      expect(parsed.ok && parsed.config.keywords).toEqual(["React", "Node"]);
    });

    it("drops items longer than MAX_KEYWORD_LENGTH but keeps those exactly at the limit", () => {
      const atLimit = "a".repeat(MAX_KEYWORD_LENGTH);
      const tooLong = "b".repeat(MAX_KEYWORD_LENGTH + 1);
      const parsed = parseSessionConfig({ language: "fr", keywords: [tooLong, atLimit, "ok"] });
      expect(parsed.ok && parsed.config.keywords).toEqual([atLimit, "ok"]);
    });

    it("truncates to the first MAX_KEYWORDS items, order preserved", () => {
      const keywords = Array.from({ length: MAX_KEYWORDS + 25 }, (_, i) => `term-${i}`);
      const parsed = parseSessionConfig({ language: "fr", keywords });
      expect(parsed.ok && parsed.config.keywords).toEqual(keywords.slice(0, MAX_KEYWORDS));
    });

    it("counts only the kept items toward MAX_KEYWORDS", () => {
      const junk = Array.from({ length: 30 }, () => 42);
      const valid = Array.from({ length: MAX_KEYWORDS }, (_, i) => `term-${i}`);
      const parsed = parseSessionConfig({ language: "fr", keywords: [...junk, ...valid, "extra"] });
      expect(parsed.ok && parsed.config.keywords).toEqual(valid);
    });

    it("returns a valid 50-term list identically", () => {
      const keywords = Array.from({ length: 50 }, (_, i) => `Terme ${i}`);
      const parsed = parseSessionConfig({ language: "fr", keywords });
      expect(parsed.ok && parsed.config.keywords).toEqual(keywords);
    });
  });

  describe("jobContext", () => {
    it("turns non-string fields into empty strings", () => {
      const parsed = parseSessionConfig({
        language: "fr",
        jobContext: { title: 12, level: null, stack: ["node"] },
      });
      expect(parsed.ok && parsed.config.jobContext).toEqual({ title: "", level: "", stack: "" });
    });

    it("fills missing fields with empty strings", () => {
      const parsed = parseSessionConfig({ language: "fr", jobContext: { title: "Dev" } });
      expect(parsed.ok && parsed.config.jobContext).toEqual({ title: "Dev", level: "", stack: "" });
    });

    it("drops extra fields of jobContext", () => {
      const parsed = parseSessionConfig({
        language: "fr",
        jobContext: { title: "Dev", level: "Junior", stack: "Go", secret: "x" },
      });
      expect(parsed.ok && parsed.config.jobContext).toEqual({ title: "Dev", level: "Junior", stack: "Go" });
    });
  });

  describe("candidateName", () => {
    it("truncates very long names to 200 characters", () => {
      const parsed = parseSessionConfig({ language: "fr", candidateName: "x".repeat(500) });
      expect(parsed.ok && parsed.config.candidateName).toBe("x".repeat(200));
    });

    it("keeps a normal name as is, without trimming", () => {
      const parsed = parseSessionConfig({ language: "fr", candidateName: " Awa Diallo " });
      expect(parsed.ok && parsed.config.candidateName).toBe(" Awa Diallo ");
    });
  });

  describe("extra fields", () => {
    it("never copies unknown top-level fields", () => {
      const parsed = parseSessionConfig({ language: "fr", admin: true, __proto__: { polluted: true }, extra: "x" });
      expect(parsed).toEqual({ ok: true, config: { language: "fr" } });
      if (parsed.ok) {
        expect(Object.keys(parsed.config)).toEqual(["language"]);
      }
    });
  });
});
