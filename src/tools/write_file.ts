import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Tool, ToolResult } from "./types.js";

const schema = z.object({
  path: z.string().describe("Path to the file to write."),
  content: z.string().describe("The content to write."),
});

export const writeFileTool: Tool<z.infer<typeof schema>> = {
  name: "write_file",
  description: "Write content to a file at the given path. Creates or overwrites.",
  schema,
  requiresConfirmation: true,
  async execute({ path, content }): Promise<ToolResult> {
    try {
      await writeFile(path, content, "utf-8");
      return { result: `wrote ${Buffer.byteLength(content)} bytes to ${path}`, isError: false };
    } catch (err) {
      return { result: (err as Error).message, isError: true };
    }
  },
};
