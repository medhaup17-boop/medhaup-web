import { cache } from "react";
import { unstable_cache } from "next/cache";
import { isDatabaseConfigured } from "./cloudflare/d1";
import { getPublishedPost, getSettings, listPublishedRows } from "./db/repository";
import { SITE_DEFAULTS, type SiteSettings } from "./settings";
import type { SuccessAspect, SuccessStory } from "./successStories";

export { waChatUrl } from "./settings";
export type { SiteSettings };

/* snake_case DB rows → camelCase props the components use */
const toCamel = <T>(row: Record<string, unknown>): T =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      v,
    ]),
  ) as T;

// This project retains Next's route revalidation model (cacheComponents is
// disabled). Cache DB reads explicitly so AI POSTs reuse public content too.
// Errors are caught outside the cache: outages must not cache empty results.
// Keep each cache entry below Next's 2 MB limit even for maximum-length,
// escaped text fields. Only individual pages are persisted, never the merged
// collection; the gateway also receives bounded, small result requests.
const PUBLIC_PAGE_SIZE = 10;
const readPublishedPage = unstable_cache(
  async (table: string, offset: number) =>
    listPublishedRows(table, { limit: PUBLIC_PAGE_SIZE, offset }),
  ["d1-published-content-page-v2"],
  { revalidate: 300, tags: ["content"] },
);

async function fetchPublished<T>(table: string): Promise<T[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PUBLIC_PAGE_SIZE) {
      const page = await readPublishedPage(table, offset);
      rows.push(...page.map((row) => toCamel<T>(row)));
      if (page.length < PUBLIC_PAGE_SIZE) return rows;
    }
  }
  catch { console.error(`[data] Could not load published ${table}.`); return []; }
}

/* ---------- Types (camelCase mirrors of the tables) ---------- */
export type Product = {
  id: string;
  title: string;
  category: string;
  description: string;
  price: number;
  mrp: number | null;
  language: string;
  image: string;
  inStock: boolean;
  isNew: boolean;
};

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover: string | null;
  date: string;
  readMins: number;
  tags: string[];
};

export type PYQ = {
  id: string;
  title: string;
  year: number;
  description: string;
  language: string;
  fileSize: string;
  paperUrl: string;
  answerKeyUrl: string | null;
  isNew: boolean;
};

export type GalleryItem = {
  id: string;
  src: string;
  alt: string;
  caption: string | null;
  category: string;
  aspect: "tall" | "wide" | "square";
};

export type MonthlyCA = {
  id: string;
  title: string;
  month: string;
  description: string;
  language: string;
  fileSize: string;
  fileUrl: string;
  isNew: boolean;
};

export type DailyCA = {
  id: string;
  headline: string;
  detail: string;
  date: string;
  tag: string;
};

export type Resource = {
  id: string;
  title: string;
  category: string;
  description: string;
  language: string;
  fileSize: string;
  fileUrl: string;
  isNew: boolean;
};

export type SubjectSyllabus = {
  id: string;
  sid: string;
  name: string;
  blurb: string;
  questions: number;
  fileUrl: string;
  fileName: string;
};

export type SyllabusDownload = {
  id: string;
  label: string;
  caption: string;
  fileUrl: string;
  fileName: string;
};

export type Batch = {
  id: string;
  name: string;
  startDate: string;
  mode: string;
  timing: string;
  seatsFilled: number;
  seatsTotal: number;
};

export type NorcetResourceCategory =
  | "Syllabus"
  | "Previous Year Papers"
  | "Notes"
  | "Mock Tests"
  | "Guides";

export type NorcetResource = {
  id: string;
  title: string;
  category: NorcetResourceCategory;
  stage: "Both stages" | "Stage I" | "Stage II";
  subject: string;
  description: string;
  language: string;
  fileUrl: string;
  fileSize: string;
  isNew: boolean;
};

const isValidPublicSlug = (slug: string) =>
  slug.length > 0 &&
  slug.length <= 160 &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

/* ---------- Fetchers (published rows only) ---------- */
export const getProducts = () =>
  fetchPublished<Product>("products");
export const getPosts = async () =>
  (await fetchPublished<BlogPost>("blog_posts")).filter((post) =>
    isValidPublicSlug(post.slug),
  );
export const getPYQs = () => fetchPublished<PYQ>("pyqs");
export const getGallery = () =>
  fetchPublished<GalleryItem>("gallery_items");
export async function getSuccessPhotos(): Promise<SuccessStory[]> {
  const rows = await fetchPublished<{ id: string; src: string; alt: string; aspect: string }>("success_photos");
  return rows.map((row) => {
    const aspect: SuccessAspect =
      row.aspect === "wide" || row.aspect === "square" ? row.aspect : "tall";

    return {
      id: row.id,
      image: row.src,
      alt: row.alt || "Student success photo",
      aspect,
    };
  });
}
export const getMonthlyCA = () =>
  fetchPublished<MonthlyCA>("current_affairs_monthly");
export const getDailyCA = () =>
  fetchPublished<DailyCA>("current_affairs_daily");
export const getResources = () =>
  fetchPublished<Resource>("resources");
export const getSubjects = () =>
  fetchPublished<SubjectSyllabus>("syllabus_subjects");
export const getSyllabusDownloads = () =>
  fetchPublished<SyllabusDownload>("syllabus_downloads");
export const getNorcetResources = () =>
  fetchPublished<NorcetResource>("norcet_resources");
export const getBatches = () => fetchPublished<Batch>("batches");

const readPostBySlug = unstable_cache(getPublishedPost, ["d1-published-post-v1"], { revalidate: 300, tags: ["content"] });
export const getPostBySlug = cache(
  async (slug: string): Promise<BlogPost | null> => {
    if (!isValidPublicSlug(slug) || !isDatabaseConfigured()) return null;
    try {
      const row = await readPostBySlug(slug);
      return row ? toCamel<BlogPost>(row) : null;
    } catch {
      console.error("[data] Could not load the published article.");
      return null;
    }
  },
);

/* ---------- Site settings, merged over safe defaults ---------- */
const readSettings = unstable_cache(getSettings, ["d1-public-settings-v1"], { revalidate: 300, tags: ["content"] });
export async function getSiteSettings(): Promise<SiteSettings> {
  if (!isDatabaseConfigured()) return SITE_DEFAULTS;
  try { return { ...SITE_DEFAULTS, ...await readSettings() }; }
  catch {
    console.error("[data] Could not load site settings.");
    return SITE_DEFAULTS;
  }
}
