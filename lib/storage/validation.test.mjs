import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadTs(path, imports = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => Object.hasOwn(imports, name) ? imports[name] : require(name), loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}
const collections = loadTs("../admin/collections.ts");
const { validateUploadRequest, validateFileSignature, attachmentDisposition, IMAGE_MAX_BYTES, PDF_MAX_BYTES } = loadTs("./validation.ts", {
  "@/lib/admin/collections": collections,
});
const pdf = { collection: "pyq", field: "paper_url", fileName: "Exam paper.pdf", contentType: "application/pdf", size: 1024 };

test("upload tickets only accept real collection media fields and bounded supported files", () => {
  assert.equal(validateUploadRequest(pdf).safeName, "Exam_paper.pdf");
  assert.equal(validateUploadRequest({ ...pdf, contentType: "" }).contentType, "application/pdf");
  for (const patch of [
    { collection: "admins" }, { field: "title" }, { size: PDF_MAX_BYTES + 1 },
    { size: -1 }, { size: 1.5 }, { fileName: "../paper.pdf" },
    { fileName: "attack.svg", contentType: "image/svg+xml" }, { contentType: "image/png" },
  ]) assert.throws(() => validateUploadRequest({ ...pdf, ...patch }));
  assert.throws(() => validateUploadRequest({ collection: "success-photos", field: "src", fileName: "photo.jpg", contentType: "image/jpeg", size: IMAGE_MAX_BYTES + 1 }));
  assert.equal(validateUploadRequest({ collection: "success-photos", field: "src", fileName: "photo.jpg", contentType: "image/jpeg", size: 400 }).contentType, "image/jpeg");
});

test("server validation rejects spoofed headers and truncated PDFs", () => {
  const bytes = (value) => new TextEncoder().encode(value);
  validateFileSignature("application/pdf", bytes("%PDF-1.7\n"), bytes("startxref\n123\n%%EOF\n"));
  assert.throws(() => validateFileSignature("application/pdf", bytes("<html>fake"), bytes("%%EOF")));
  assert.throws(() => validateFileSignature("application/pdf", bytes("%PDF-1.7\n"), bytes("truncated")));
  assert.throws(() => validateFileSignature("image/png", bytes("%PDF-1.7")));
  validateFileSignature("image/png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  validateFileSignature("image/jpeg", new Uint8Array([255, 216, 255, 224]));
  validateFileSignature("image/webp", bytes("RIFF1234WEBP"));
  validateFileSignature("image/gif", bytes("GIF89a"));
  assert.throws(() => validateFileSignature("image/svg+xml", bytes("<svg/>")));
});

test("download disposition preserves Unicode safely without header injection", () => {
  const value = attachmentDisposition('Study "guide" বাংলা.pdf');
  assert.match(value, /^attachment; filename="Study _guide_ _+\.pdf";/);
  assert.match(value, /filename\*=UTF-8''Study%20%22guide%22%20/);
  assert.doesNotMatch(attachmentDisposition("bad\r\nInjected: yes.pdf"), /[\r\n]/);
});
