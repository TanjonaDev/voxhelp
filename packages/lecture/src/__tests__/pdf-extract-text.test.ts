import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDocumentProxy = vi.hoisted(() => vi.fn());
const mockExtractText = vi.hoisted(() => vi.fn());

vi.mock("unpdf", () => ({
  getDocumentProxy: mockGetDocumentProxy,
  extractText: mockExtractText,
}));

const { extractPdfPages } = await import("../pdf/extract-text.js");

describe("extractPdfPages", () => {
  beforeEach(() => {
    mockGetDocumentProxy.mockReset();
    mockExtractText.mockReset();
  });

  it("maps unpdf's per-page text array to PdfPage[] with 1-based page numbers", async () => {
    const fakeProxy = { id: "fake-pdf-proxy" };
    mockGetDocumentProxy.mockResolvedValueOnce(fakeProxy);
    mockExtractText.mockResolvedValueOnce({
      totalPages: 3,
      text: ["Page un.", "Page deux.", "Page trois."],
    });

    const pages = await extractPdfPages(Buffer.from("fake pdf bytes"));

    expect(mockExtractText).toHaveBeenCalledWith(fakeProxy, { mergePages: false });
    expect(pages).toEqual([
      { page: 1, text: "Page un." },
      { page: 2, text: "Page deux." },
      { page: 3, text: "Page trois." },
    ]);
  });

  it("returns an empty array for a PDF with no extractable text", async () => {
    mockGetDocumentProxy.mockResolvedValueOnce({});
    mockExtractText.mockResolvedValueOnce({ totalPages: 0, text: [] });

    const pages = await extractPdfPages(Buffer.from("fake pdf bytes"));

    expect(pages).toEqual([]);
  });
});
