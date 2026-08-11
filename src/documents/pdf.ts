// Phase 30: PDF handling shared by the read_document tool (agent-initiated,
// a file already on disk) and server.ts's web-attachment path (a PDF the
// user attached in the chat). pdf-parse v2 wraps pdfjs-dist internally and
// gives us both text extraction (getText) and real page rasterization
// (getScreenshot) from a single, actively-maintained package - no separate
// pdfjs-dist/canvas dependency needed at this project's level.

import { PDFParse } from "pdf-parse";
import type { Block } from "../provider/types.js";

// Caps how many pages ever get rasterized for a "mostly visual" PDF - a
// plan set or scanned contract could run to dozens of pages, and each
// rendered page is a real image payload (tokens on the API call, bytes on
// the wire). Matches the spirit of MAX_IMAGE_BYTES in web-app's ChatInput.
const MAX_RENDERED_PAGES = 5;

// Below this many extracted characters per page, a PDF is treated as
// "mostly visual" (a floor plan, a scanned document) rather than text -
// real text-based PDFs land nowhere close to this threshold even for
// sparse pages; a PDF that's actually just images has ~0.
const MIN_CHARS_PER_PAGE = 40;

export interface PdfTextResult {
  pageCount: number;
  text: string;
}

export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { pageCount: result.pages.length, text: result.text };
  } finally {
    await parser.destroy();
  }
}

export function looksMostlyVisual({ pageCount, text }: PdfTextResult): boolean {
  if (pageCount === 0) return false;
  return text.trim().length / pageCount < MIN_CHARS_PER_PAGE;
}

export interface PdfPageImages {
  renderedPages: number;
  images: { mediaType: string; data: string }[];
}

export async function renderPdfPages(buffer: Buffer, maxPages = MAX_RENDERED_PAGES): Promise<PdfPageImages> {
  const parser = new PDFParse({ data: buffer });
  try {
    const shot = await parser.getScreenshot({ first: maxPages });
    return {
      renderedPages: shot.pages.length,
      // dataUrl is "data:image/png;base64,<data>" - strip the prefix to
      // match Block's "image" variant, which stores raw base64 only.
      images: shot.pages.map((p) => ({ mediaType: "image/png", data: p.dataUrl.slice(p.dataUrl.indexOf(",") + 1) })),
    };
  } finally {
    await parser.destroy();
  }
}

export interface PdfToBlocksResult {
  mode: "text" | "images";
  pageCount: number;
  blocks: Block[];
}

// Used only by server.ts's web-attachment path (Phase 30's other consumer,
// the read_document tool, never calls this) - a PDF attached directly to a
// chat message becomes part of a user Message's content, where an "image"
// Block is valid on both providers, unlike a tool_result (see
// read_document.ts's own comment on why it can't do the same).
export async function pdfToBlocks(buffer: Buffer, filename: string): Promise<PdfToBlocksResult> {
  const extraction = await extractPdfText(buffer);
  if (!looksMostlyVisual(extraction)) {
    return {
      mode: "text",
      pageCount: extraction.pageCount,
      blocks: [{ type: "text", text: `[document: ${filename}, ${extraction.pageCount} page(s)]\n${extraction.text}` }],
    };
  }
  const rendered = await renderPdfPages(buffer);
  return {
    mode: "images",
    pageCount: extraction.pageCount,
    blocks: rendered.images.map((img) => ({ type: "image", mediaType: img.mediaType, data: img.data })),
  };
}
