import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { jobDir, readStep, writeStep, cleanupJob } from "../lecture-job-cache.js";

describe("lecture-job-cache", () => {
  const jobIds: string[] = [];

  afterEach(async () => {
    await Promise.all(jobIds.splice(0).map((id) => cleanupJob(id)));
  });

  function newJobId(): string {
    const id = randomUUID();
    jobIds.push(id);
    return id;
  }

  it("rejects a jobId that isn't a well-formed uuid shape", () => {
    expect(() => jobDir("../escape")).toThrow();
  });

  it("returns null when reading a step that was never written", async () => {
    const jobId = newJobId();
    expect(await readStep(jobId, "stt-chunk-0")).toBeNull();
  });

  it("returns exactly what was written, for any JSON-serializable value", async () => {
    const jobId = newJobId();
    const data = { utterances: [{ start: 0, end: 1.5, transcript: "bonjour" }] };

    await writeStep(jobId, "stt-chunk-0", data);
    const read = await readStep(jobId, "stt-chunk-0");

    expect(read).toEqual(data);
  });

  it("keeps steps independent by key", async () => {
    const jobId = newJobId();
    await writeStep(jobId, "pass1-window-0", { a: 1 });
    await writeStep(jobId, "pass1-window-1", { a: 2 });

    expect(await readStep(jobId, "pass1-window-0")).toEqual({ a: 1 });
    expect(await readStep(jobId, "pass1-window-1")).toEqual({ a: 2 });
  });

  it("cleanupJob removes every step, and reads afterward return null", async () => {
    const jobId = newJobId();
    await writeStep(jobId, "pass2-section-0", "some markdown");
    await writeStep(jobId, "pass2-section-1", "more markdown");

    await cleanupJob(jobId);

    expect(await readStep(jobId, "pass2-section-0")).toBeNull();
    expect(await readStep(jobId, "pass2-section-1")).toBeNull();
    await expect(access(jobDir(jobId))).rejects.toThrow();
  });

  it("cleanupJob on a job that was never written does not throw", async () => {
    const jobId = newJobId();
    await expect(cleanupJob(jobId)).resolves.toBeUndefined();
  });
});
