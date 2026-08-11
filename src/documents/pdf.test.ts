// Fixtures are built with pdf-lib (a devDependency, not shipped with the
// harness itself) rather than checked-in binary PDF files - same
// "construct it, don't commit a binary blob" preference the rest of this
// project's tests use (mkdtemp + writeFile for config/skills fixtures).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { extractPdfText, looksMostlyVisual, pdfToBlocks, renderPdfPages } from "./pdf.js";

async function textPdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 20, y: 350, size: 12, font });
  return Buffer.from(await doc.save());
}

async function blankPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawRectangle({ x: 0, y: 0, width: 200, height: 200, color: rgb(1, 0, 0) });
  return Buffer.from(await doc.save());
}

test("extractPdfText: pulls real text content and the correct page count out of a text PDF", async () => {
  const buffer = await textPdf("The secret code word is PELICAN-7739.");
  const result = await extractPdfText(buffer);

  assert.equal(result.pageCount, 1);
  assert.match(result.text, /PELICAN-7739/);
});

test("looksMostlyVisual: false for a PDF with real extracted text", async () => {
  const result = await extractPdfText(await textPdf("This page has a reasonable amount of readable text on it."));
  assert.equal(looksMostlyVisual(result), false);
});

test("looksMostlyVisual: true for a PDF with no extractable text (a solid-color page, no text drawn)", async () => {
  const result = await extractPdfText(await blankPdf());
  assert.equal(looksMostlyVisual(result), true);
});

test("looksMostlyVisual: false for a zero-page PDF (nothing to call visual)", () => {
  assert.equal(looksMostlyVisual({ pageCount: 0, text: "" }), false);
});

test("renderPdfPages: rasterizes a real PNG per page", async () => {
  const result = await renderPdfPages(await blankPdf());

  assert.equal(result.renderedPages, 1);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].mediaType, "image/png");
  // PNG magic number, base64-encoded ("iVBORw0K...") - confirms this is
  // real image data, not an empty or malformed buffer.
  assert.match(result.images[0].data, /^iVBORw0K/);
});

test("renderPdfPages: caps rendering at maxPages", async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([100, 100]);
  const buffer = Buffer.from(await doc.save());

  const result = await renderPdfPages(buffer, 2);
  assert.equal(result.renderedPages, 2);
});

test("pdfToBlocks: a text PDF becomes a single text Block naming the file and page count", async () => {
  const result = await pdfToBlocks(await textPdf("Some real readable content goes here for this test."), "report.pdf");

  assert.equal(result.mode, "text");
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, "text");
  const text = (result.blocks[0] as { text: string }).text;
  assert.match(text, /^\[document: report\.pdf, 1 page\(s\)\]/);
  assert.match(text, /Some real readable content/);
});

test("pdfToBlocks: a mostly-visual PDF becomes image Blocks instead, one per rendered page", async () => {
  const result = await pdfToBlocks(await blankPdf(), "plan.pdf");

  assert.equal(result.mode, "images");
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, "image");
  assert.equal((result.blocks[0] as { mediaType: string }).mediaType, "image/png");
});
