import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadTs(path, imports = {}) {
  const source = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => (Object.hasOwn(imports, name) ? imports[name] : require(name)),
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const downloads = loadTs("../lib/downloads.ts");
const { validatePdfUpload, formatFileSize } = loadTs("../lib/admin/uploads.ts");
const { default: PreviousYearPapers } = loadTs(
  "../components/sections/PreviousYearPapers.tsx",
  {
    "@/lib/downloads": downloads,
  },
);
const paper = {
  id: "paper-2025",
  title: "ANM GNM 2025 — Set B",
  year: 2025,
  language: "Bengali + English",
  description: "Question paper",
  fileSize: "2.4 MB",
  paperUrl:
    "https://assets.example.com/files/pyq/paper.pdf",
  answerKeyUrl:
    "https://assets.example.com/files/pyq/key.pdf",
  isNew: false,
};

test("R2 PDF links preserve object URLs, signatures and filename encoding", () => {
  const url = new URL(
    downloads.getFileDownloadUrl(`${paper.paperUrl}?version=2`),
  );
  assert.equal(url.searchParams.has("download"), false);
  assert.equal(url.searchParams.get("version"), "2");
  assert.equal(
    downloads.getFileDownloadUrl("/resources/paper.pdf"),
    "/resources/paper.pdf",
  );
  const external = "https://example.org/paper.pdf?signature=keep-me";
  assert.equal(downloads.getFileDownloadUrl(external), external);
  const encoded = paper.paperUrl.replace("paper.pdf", "paper%20one.pdf");
  assert.match(
    downloads.getFileDownloadUrl(encoded),
    /paper%20one\.pdf$/,
  );
});

test("PDF uploads accept real headers even when the browser omits MIME metadata", async () => {
  await validatePdfUpload(new File(["%PDF-1.7\nfixture"], "PAPER.PDF"));
  assert.equal(formatFileSize(2.4 * 1024 * 1024), "2.4 MB");
  assert.equal(formatFileSize(256 * 1024), "256 KB");
});

test("empty, renamed, and non-PDF uploads are rejected", async () => {
  await assert.rejects(
    validatePdfUpload(new File([], "empty.pdf")),
    /not a valid PDF/,
  );
  await assert.rejects(
    validatePdfUpload(
      new File(["<html>"], "renamed.pdf", { type: "application/pdf" }),
    ),
    /not a valid PDF/,
  );
  await assert.rejects(
    validatePdfUpload(new File(["%PDF-1.7"], "paper.txt")),
    /choose a PDF/,
  );
});

test("published records supply card titles, metadata, PDFs, and optional answer keys", () => {
  const html = renderToStaticMarkup(
    createElement(PreviousYearPapers, { papers: [paper] }),
  );
  assert.match(html, /ANM GNM 2025 — Set B/);
  assert.match(html, /2\.4 MB/);
  assert.match(html, /href="https:\/\/assets\.example\.com\/files\/pyq\/paper\.pdf"/);
  assert.match(html, /href="https:\/\/assets\.example\.com\/files\/pyq\/key\.pdf"/);
  assert.doesNotMatch(html, /PDF coming soon/);
  const withoutKey = renderToStaticMarkup(
    createElement(PreviousYearPapers, {
      papers: [{ ...paper, answerKeyUrl: null }],
    }),
  );
  assert.doesNotMatch(withoutKey, /Answer key/);
});

test("empty published data has no placeholder cards or broken download links", () => {
  const html = renderToStaticMarkup(
    createElement(PreviousYearPapers, { papers: [] }),
  );
  assert.match(html, /Question papers are on their way/);
  assert.doesNotMatch(html, /<article|2025|download=/);
});

test("the public D1 paper query excludes drafts and orders by descending year", async () => {
  const calls = [];
  const settings = loadTs("../lib/settings.ts");
  const collections = loadTs("../lib/admin/collections.ts");
  const validation = loadTs("../lib/db/validation.ts", {
    "../admin/collections": collections,
    "../settings": settings,
  });
  const repository = loadTs("../lib/db/repository.ts", {
    "server-only": {},
    "../cloudflare/d1": {
      d1Query: async (sql, params) => {
        calls.push({ sql, params });
        return [{ id: "published", year: 2025, paper_url: paper.paperUrl, published: 1 }];
      },
    },
    "../admin/collections": collections,
    "./validation": validation,
  });
  const { getPYQs } = loadTs("../lib/data.ts", {
    "next/cache": { unstable_cache: (fn) => fn },
    "./batches": {},
    "./settings": settings,
    "./cloudflare/d1": { isDatabaseConfigured: () => true },
    "./db/repository": repository,
  });
  const papers = await getPYQs();
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM pyqs WHERE published = \? ORDER BY year DESC/);
  assert.match(calls[0].sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(calls[0].params, [1, 10, 0]);
  assert.equal(papers[0].paperUrl, paper.paperUrl);
});

test("homepage passes its fetched papers to the section after the hero and featured batch", async () => {
  const imports = Object.fromEntries(
    [
      "Hero",
      "ChampionBatch",
      "GnmTeaser",
      "AnmTeaser",
      "RrbTeaser",
      "JenpasTeaser",
      "NursingEntranceTeaser",
      "DPharmacyTeaser",
      "OngoingBatch",
      "SubjectSyllabus",
      "WhyMedhaup",
      "NorcetTeaser",
      "Bloghighlights",
    ].map((name) => [`@/components/sections/${name}`, () => null]),
  );
  const { default: Home } = loadTs("../app/(site)/page.tsx", {
    ...imports,
    "@/components/sections/PreviousYearPapers": PreviousYearPapers,
    "@/lib/data": {
      getBatches: async () => [],
      getSubjects: async () => [],
      getSyllabusDownloads: async () => [],
      getPosts: async () => [],
      getPYQs: async () => [paper],
    },
  });
  const tree = await Home();
  const main = tree.props.children.find((child) => child.type === "main");
  const sectionIndex = main.props.children.findIndex(
    (child) => child?.type === PreviousYearPapers,
  );
  assert.equal(
    main.props.children[sectionIndex - 1].type,
    imports["@/components/sections/ChampionBatch"],
  );
  assert.ok(main.props.children.findIndex((child) => child?.type === imports["@/components/sections/Hero"]) < sectionIndex);
  assert.deepEqual(main.props.children[sectionIndex].props.papers, [paper]);
});
