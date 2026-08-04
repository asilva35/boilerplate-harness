// Equivalent to internal/tool/bash.go, which does exec.CommandContext(ctx,
// "sh", "-c", cmd) and gathers CombinedOutput(). spawn() doesn't give us
// that combination for free — stdout and stderr are separate streams — so
// we accumulate them by hand and concatenate them at the end, like
// CombinedOutput would.

import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolResult } from "./types.js";

const schema = z.object({
  command: z.string().describe("The shell command to execute."),
});

export const bashTool: Tool<z.infer<typeof schema>> = {
  name: "bash",
  description: "Run a shell command. Returns combined stdout and stderr.",
  schema,
  requiresConfirmation: true,
  execute({ command }): Promise<ToolResult> {
    return new Promise((resolve) => {
      const child = spawn("sh", ["-c", command]);
      let output = "";

      child.stdout.on("data", (chunk: Buffer) => (output += chunk));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk));

      child.on("error", (err) => {
        resolve({ result: err.message, isError: true });
      });

      child.on("close", (code) => {
        if (code !== 0) {
          resolve({ result: `${output}\n[exit code: ${code}]`, isError: true });
        } else {
          resolve({ result: output, isError: false });
        }
      });
    });
  },
};
