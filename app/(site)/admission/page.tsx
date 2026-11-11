import { getBatches } from "@/lib/data";
import AdmissionPageContent from "@/components/sections/admission/AdmissionPageContent";
import JsonLd from "@/components/seo/JsonLd";
import { createPageMetadata, createPageSchema } from "@/lib/seo";
import { CHAMPION_BATCH } from "@/lib/champion-batch";
import { formatINR } from "@/lib/coursePricing";

export const revalidate = 60;

const title = "ANM/GNM 2027 Course Admission";
const description = `Join medhaup's ${CHAMPION_BATCH.name} for ANM/GNM 2027. Diwali offer: ${formatINR(CHAMPION_BATCH.offerPrice)} total, join with ${formatINR(CHAMPION_BATCH.joiningAmount)}. Get personal admission guidance in Bengali or English.`;

export const metadata = createPageMetadata({
  title,
  description,
  path: "/admission",
  keywords: [
    "ANM GNM 2027 admission",
    "ANM GNM online course admission",
    "ANM GNM course fees",
  ],
});

export default async function AdmissionPage() {
  const batches = await getBatches();
  const batch =
    batches.find(
      (item) => /\bchampion\b/i.test(item.name) && /\b2027\b/.test(item.name),
    ) ?? null;
  const schema = createPageSchema({
    path: "/admission",
    name: `${title} | medhaup`,
    description,
    breadcrumbs: [
      { name: "Home", path: "/" },
      { name: "Course", path: "/course" },
      { name: "Admission", path: "/admission" },
    ],
    mainEntity: {
      "@type": "Course",
      "@id": "https://medhaup.com/course#course",
      name: CHAMPION_BATCH.name,
      provider: { "@id": "https://medhaup.com/#organization" },
      hasCourseInstance: {
        "@type": "CourseInstance",
        name: batch?.name ?? CHAMPION_BATCH.name,
        courseMode: "Online",
        inLanguage: ["Bengali", "English"],
        ...(batch?.startDate ? { startDate: batch.startDate } : {}),
      },
    },
  });

  return (
    <>
      <JsonLd data={schema} />
      <AdmissionPageContent batch={batch} />
    </>
  );
}
