import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";
import { waitForMessage } from "./helpers/ws.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({ callbacks: null as STTCallbacks | null }));
const mockLlm = vi.hoisted(() => ({
  streamAssist: vi.fn(),
}));

vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
    }
    async start() { stt.callbacks?.onListening(); }
    sendAudio() {}
    close() {}
  },
}));

vi.mock("../llm.js", () => ({
  streamAssist: mockLlm.streamAssist,
  callClaudeJSON: vi.fn(),
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

function connectAndStart(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:ready") resolve(ws);
    });
  });
}

function awsCard(title: string): string {
  return [
    "[strength] [high] [aws-serverless]",
    `# ${title}`,
    "Détail technique sur ce sujet.",
  ].join("\n");
}

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

describe("Session theme streak", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("adds the forced-pivot instruction once 3 consecutive cards share the same theme", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(awsCard("Fullstack serverless"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("ETL et data pipeline"));
    stt.callbacks!.onTranscript("On a un pipeline ETL derrière.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("Gestion de microservices"));
    stt.callbacks!.onTranscript("On gère une dizaine de microservices.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("SQS vs SNS"));
    stt.callbacks!.onTranscript("On utilise SQS plutôt que SNS.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const fourthPrompt = mockLlm.streamAssist.mock.calls[3][0] as string;
    expect(fourthPrompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(fourthPrompt).toContain("ATTENTION — ce thème a déjà été couvert par 3 cards consécutives");
    expect(fourthPrompt).toContain("DOIT changer complètement de sujet");
  });

  it("resets the streak and does not warn when the theme changes", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(awsCard("Fullstack serverless"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[translation] [medium] [methodologie-travail]",
        "# Méthode de travail en équipe",
        "Le candidat décrit sa méthode agile.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On travaille en méthode agile avec des sprints.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("ETL et data pipeline"));
    stt.callbacks!.onTranscript("On a aussi un pipeline ETL.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const thirdPrompt = mockLlm.streamAssist.mock.calls[2][0] as string;
    expect(thirdPrompt).toContain("Thème de la dernière card : « methodologie-travail »");
    expect(thirdPrompt).not.toContain("ATTENTION — ce thème a déjà été couvert");
  });
});
