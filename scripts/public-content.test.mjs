import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadTs(path, imports = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => Object.hasOwn(imports, name) ? imports[name] : require(name),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const settings = loadTs("../lib/settings.ts");
const { default: SubjectSyllabus } = loadTs("../components/sections/SubjectSyllabus.tsx");

test("published batch seat counts come from the saved record, including the former hardcoded batch", async () => {
  const saved = {
    id: "43a69ab8-97a7-4451-a498-0fead3580736",
    name: "Updated batch",
    start_date: "Tomorrow",
    mode: "Hybrid",
    timing: "Evenings",
    seats_filled: 12,
    seats_total: 80,
  };
  const data = loadTs("../lib/data.ts", {
    "next/cache": { unstable_cache: (fn) => fn },
    "./settings": settings,
    "./cloudflare/d1": { isDatabaseConfigured: () => true },
    "./db/repository": {
      getSettings: async () => ({}),
      getPublishedPost: async () => null,
      listPublishedRows: async () => [saved],
    },
  });
  assert.deepEqual(await data.getBatches(), [{
    id: saved.id,
    name: saved.name,
    startDate: saved.start_date,
    mode: saved.mode,
    timing: saved.timing,
    seatsFilled: 12,
    seatsTotal: 80,
  }]);
});

test("site phone and WhatsApp settings produce independent contact links", () => {
  const site = settings.buildSite({
    ...settings.SITE_DEFAULTS,
    phone: "9876543210",
    whatsappNumber: "918888888888",
    whatsappPrefill: "Course details please",
  });
  assert.equal(site.phoneHref, "tel:+919876543210");
  assert.match(site.whatsapp.chatUrl, /^https:\/\/wa\.me\/918888888888\?text=/);
  assert.equal(settings.buildSite({ ...settings.SITE_DEFAULTS, phone: "442012345678" }).phoneHref, "tel:+442012345678");
  assert.equal(settings.buildSite({ ...settings.SITE_DEFAULTS, phone: "" }).phoneHref, "");
});

test("homepage subject cards use stable IDs, omit missing PDFs, and never restore deleted subjects", () => {
  const subject = {
    id: "new-database-uuid",
    sid: "biology",
    name: "Updated Biology",
    blurb: "Updated published subject",
    questions: 25,
    fileUrl: "",
    fileName: "",
  };
  const html = renderToStaticMarkup(createElement(SubjectSyllabus, { subjects: [subject] }));
  assert.match(html, /Updated Biology/);
  assert.match(html, /lucide-dna/);
  assert.doesNotMatch(html, /Download PDF|href=""/);
  assert.equal(renderToStaticMarkup(createElement(SubjectSyllabus, { subjects: [] })), "");
  const withPdf = renderToStaticMarkup(createElement(SubjectSyllabus, {
    subjects: [{ ...subject, fileUrl: "https://assets.example.test/biology.pdf" }],
  }));
  assert.match(withPdf, /href="https:\/\/assets\.example\.test\/biology\.pdf"/);
});

async function renderSyllabus(subjects, downloads) {
  const { default: Page } = loadTs("../app/syllabus/page.tsx", {
    "@/lib/data": { getSubjects: async () => subjects, getSyllabusDownloads: async () => downloads },
    "@/components/ui/ComingSoon": () => createElement("p", null, "Syllabus pending"),
    "@/components/seo/JsonLd": () => null,
    "@/lib/seo": {
      absoluteUrl: (path) => `https://example.test${path}`,
      createPageMetadata: (value) => value,
      createPageSchema: (value) => value,
    },
  });
  return renderToStaticMarkup(await Page());
}

test("published full syllabus PDFs remain visible when all subjects are unpublished or deleted", async () => {
  const html = await renderSyllabus([], [{
    id: "full-pdf",
    label: "Complete syllabus download",
    caption: "All subjects",
    fileUrl: "https://assets.example.test/complete.pdf",
    fileName: "complete.pdf",
  }]);
  assert.match(html, /Complete syllabus download/);
  assert.match(html, /href="https:\/\/assets\.example\.test\/complete\.pdf"/);
  assert.doesNotMatch(html, /Syllabus pending|0 QUESTIONS/);
  assert.match(await renderSyllabus([], []), /Syllabus pending/);
});

test("a published syllabus with zero question counts renders finite progress widths", async () => {
  const html = await renderSyllabus([{
    id: "subject", sid: "biology", name: "Biology", blurb: "Topic list",
    questions: 0, fileUrl: "", fileName: "",
  }], []);
  assert.doesNotMatch(html, /NaN|Infinity|href=""/);
  assert.match(html, /width:0%/);
});

test("monthly current affairs shows the administrator's month as well as its download", async () => {
  const { default: Page } = loadTs("../app/(site)/current-affairs/page.tsx", {
    "@/lib/data": {
      getMonthlyCA: async () => [{
        id: "monthly", title: "Current affairs collection", month: "November 2026",
        description: "Monthly update", language: "English", fileSize: "1 MB",
        fileUrl: "https://assets.example.test/monthly.pdf", isNew: true,
      }],
      getDailyCA: async () => [],
      getSiteSettings: async () => settings.SITE_DEFAULTS,
    },
    "@/components/ui/ComingSoon": () => null,
    "@/components/seo/JsonLd": () => null,
    "@/lib/utils": { formatDateShort: (date) => date },
    "@/lib/seo": {
      absoluteUrl: (path) => `https://example.test${path}`,
      createPageMetadata: (value) => value,
      createPageSchema: (value) => value,
    },
  });
  const html = renderToStaticMarkup(await Page());
  assert.match(html, /November 2026/);
  assert.match(html, /href="https:\/\/assets\.example\.test\/monthly\.pdf"/);
});
