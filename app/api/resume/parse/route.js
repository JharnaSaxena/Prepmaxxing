import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { currentUser, requireUser } from "../../../../lib/auth";
import { jsonError } from "../../../../lib/http";
import { extractPdfTextWithGemini, extractPdfTextWithOcrSpace } from "../../../../lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  try {
    requireUser(await currentUser());
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") throw Object.assign(new Error("Choose a PDF, DOCX, or TXT resume."), { status: 400 });
    if (file.size > 8 * 1024 * 1024) throw Object.assign(new Error("Resume files must be 8 MB or smaller."), { status: 413 });
    const extension = String(file.name || "").toLowerCase().split(".").pop();
    const kind = extension === "pdf" || file.type === "application/pdf" ? "pdf"
      : extension === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx"
        : extension === "txt" || file.type === "text/plain" ? "txt" : "";
    let text = "";
    if (kind === "txt") text = await file.text();
    else if (kind === "docx") {
      const parsed = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
      text = parsed.value;
    } else if (kind === "pdf") {
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.subarray(0, 5).toString() !== "%PDF-") throw Object.assign(new Error("This file is labeled as a PDF but does not contain a valid PDF document."), { status: 422 });
      let parserError = false;
      const parser = new PDFParse({ data: bytes });
      try { text = (await parser.getText())?.text || ""; }
      catch { parserError = true; }
      finally { await parser.destroy(); }
      if (parserError || text.trim().length < 30) {
        let ocrError;
        try { text = await extractPdfTextWithOcrSpace(bytes); } catch (error) { ocrError = error; }
        if (text.trim().length < 30) {
          try { text = await extractPdfTextWithGemini(bytes); } catch (error) { ocrError ||= error; }
        }
        if (text.trim().length < 30 && ocrError) throw ocrError;
      }
    } else throw Object.assign(new Error("Use a PDF, DOCX, or TXT resume."), { status: 415 });
    const cleaned = String(text).replace(/\u0000/g, "").trim().slice(0, 18000);
    if (cleaned.length < 30) throw Object.assign(new Error("We couldn't find enough readable resume text. Scanned PDFs need OCR_SPACE_API_KEY or GEMINI_API_KEY; otherwise paste the resume text manually."), { status: 422 });
    return NextResponse.json({ text: cleaned, filename: String(file.name).slice(0, 150) });
  } catch (error) { return jsonError(error); }
}
