import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { backupStore } from "../backup/store.js";
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
      // Phase 31: snapshot whatever's currently there before overwriting -
      // the safety net /rollback (commands.ts) restores from. Skipped for
      // a brand-new file (nothing to restore to) and for a no-op rewrite
      // (identical content) - the same "no changes" case buildWriteDiff
      // (diff.ts, Phase 11) already special-cases in the approval prompt,
      // checked directly here rather than re-parsing that function's
      // formatted diff string just to throw it away. Best-effort: any
      // failure reading the existing file (missing, unreadable, whatever)
      // just skips the backup instead of blocking the write itself.
      let backedUp = false;
      try {
        const existing = await readFile(path, "utf-8");
        if (existing !== content) {
          await backupStore.save(path, existing);
          backedUp = true;
        }
      } catch {
        // no existing file (or unreadable) - nothing to back up
      }

      await writeFile(path, content, "utf-8");
      const note = backedUp ? " (backup saved - /rollback to undo)" : "";
      return { result: `wrote ${Buffer.byteLength(content)} bytes to ${path}${note}`, isError: false };
    } catch (err) {
      return { result: (err as Error).message, isError: true };
    }
  },
};
