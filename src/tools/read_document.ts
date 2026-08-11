// Extension of read_file.ts (Phase 1) for a format plain text can't
// handle: a PDF already on disk, given to the agent by path the same way
// read_file is.
//
// Deliberately text-only, unlike server.ts's web-attachment path (Phase
// 30's other pdf.ts consumer) which can inject rendered page images
// straight into a user Message. A tool's ToolResult.result is a plain
// string (see types.ts) - Anthropic's tool_result blocks CAN carry images,
// but OpenAI-compatible "tool" role messages (what OpenRouter uses) can't,
// and a Tool implementation has no idea which provider is active (that
// abstraction boundary is deliberate - see ToolRegistry/Provider). Rather
// than make this tool's behavior secretly depend on which backend happens
// to be running, a "mostly visual" PDF gets an honest, uniform message
// instead of an image no OpenAI-compatible tool result could deliver
// anyway.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { extractPdfText, looksMostlyVisual } from "../documents/pdf.js";
import type { Tool, ToolResult } from "./types.js";

const schema = z.object({
  path: z.string().describe("Path to a PDF file to read."),
});

export const readDocumentTool: Tool<z.infer<typeof schema>> = {
  name: "read_document",
  description: "Read a PDF file at the given path and return its extracted text content.",
  schema,
  async execute({ path }): Promise<ToolResult> {
    try {
      const buffer = await readFile(path);
      const extraction = await extractPdfText(buffer);
      if (looksMostlyVisual(extraction)) {
        return {
          result:
            `This PDF (${extraction.pageCount} page(s)) has little to no extractable text - it looks like ` +
            "a scanned document or is mostly visual (e.g. a floor plan). Text extraction can't show it to " +
            "you; ask the user to attach it directly in the chat instead, so its pages can be rendered as " +
            "images.",
          isError: false,
        };
      }
      return { result: extraction.text, isError: false };
    } catch (err) {
      return { result: (err as Error).message, isError: true };
    }
  },
};
