import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Tool, ToolResult } from "./types.js";

const schema = z.object({
  path: z.string().describe("Path to the file to read."),
});

export const readFileTool: Tool<z.infer<typeof schema>> = {
  name: "read_file",
  description: "Read the contents of a file at the given path.",
  schema,
  async execute({ path }): Promise<ToolResult> {
    try {
      const content = await readFile(path, "utf-8");
      return { result: content, isError: false };
    } catch (err) {
      return { result: (err as Error).message, isError: true };
    }
  },
};
