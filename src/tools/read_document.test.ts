import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readDocumentTool } from "./read_document.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "read-document-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeTextPdf(filePath: string, text: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 20, y: 350, size: 12, font });
  await writeFile(filePath, await doc.save());
}

async function writeVisualPdf(filePath: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawRectangle({ x: 0, y: 0, width: 200, height: 200, color: rgb(1, 0, 0) });
  await writeFile(filePath, await doc.save());
}

test("returns the extracted text for a real text-based PDF on disk", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "report.pdf");
    await writeTextPdf(file, "The secret code word is PELICAN-7739.");

    const result = await readDocumentTool.execute({ path: file });

    assert.equal(result.isError, false);
    assert.match(result.result, /PELICAN-7739/);
  });
});

test("reports a mostly-visual PDF honestly instead of trying to return image content", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "plan.pdf");
    await writeVisualPdf(file);

    const result = await readDocumentTool.execute({ path: file });

    assert.equal(result.isError, false);
    assert.match(result.result, /mostly visual|scanned/);
    assert.match(result.result, /attach it directly in the chat/);
  });
});

test("returns an error result (not a thrown exception) for a missing file", async () => {
  const result = await readDocumentTool.execute({ path: "/nonexistent/path/to/file.pdf" });
  assert.equal(result.isError, true);
});
