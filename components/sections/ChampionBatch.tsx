import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  GraduationCap,
  ImageIcon,
  MessageCircle,
  Phone,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { PLAY_STORE_URL } from "@/lib/app-links";
import { CHAMPION_BATCH } from "@/lib/champion-batch";
import { formatINR } from "@/lib/coursePricing";

const FEATURES = [
  "Live Interactive Classes",
  "Recorded Classes – Learn Anytime",
  "Complete Syllabus Coverage",
  "Chapter-wise Study Materials (PDF)",
  "Daily Practice Papers (DPPs)",
  "Chapter-wise MCQ Practice",
  "Regular Mock Tests",
  "Previous Year Questions (PYQs) Practice",
  "Revision & Doubt-Solving Sessions",
  "Course Access Till Examination",
];

const FACULTY = [
  { subject: "Mathematics & Logical Reasoning", name: "Suprabha Ma’am" },
  { subject: "General Knowledge (GK)", name: "Tanima Ma’am" },
  { subject: "English", name: "Oengila Ma’am" },
  { subject: "Biology", name: "Arushi Ma’am" },
];

const TERMS = [
  {
    title: "Non-Refundable Fees:",
    text: "All payments made towards this batch, including the initial joining amount of ₹450, are non-refundable, except where a refund is required by applicable law.",
  },
  {
    text: "The total discounted course fee is ₹1,350. Students enrolling with ₹450 must pay the remaining ₹900 according to the applicable payment schedule.",
  },
  {
    text: "Course access will remain available until the ANM/GNM 2027 entrance examination, subject to the platform’s access policy.",
  },
];

export default function ChampionBatch() {
  return (
    <section
      id="champion-batch"
      aria-labelledby="champion-batch-heading"
      className="scroll-mt-24 bg-white py-16 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-9 flex flex-col gap-5 sm:mb-12 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-orange/25 bg-orange/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-navy">
              <Sparkles size={14} aria-hidden="true" />
              New batch · ANM/GNM 2027
            </p>
            <h2
              id="champion-batch-heading"
              className="font-heading mt-5 text-3xl font-extrabold leading-tight tracking-tight text-navy sm:text-4xl lg:text-5xl"
            >
              CHAMPION BATCH <span className="text-orange-dark">– 2027</span>
            </h2>
            <p className="mt-3 text-sm text-navy/70 sm:text-base">
              By <span className="font-bold text-navy">medhaup</span>
              <span aria-hidden="true" className="mx-2 text-navy/30">
                |
              </span>
              Clear Concept, Score Up
            </p>
          </div>
          <p className="max-w-64 text-sm leading-6 text-navy/65">
            Your Preparation. Our Guidance.
            <br />
            <span className="font-semibold text-navy">Your Success.</span>
          </p>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-navy/10 bg-cream shadow-xl shadow-navy/5">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-5 sm:p-8">
              {/* Replace this placeholder with the batch artwork when available. */}
              <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-navy p-6 text-center text-white">
                <div
                  aria-hidden="true"
                  className="absolute -right-16 -top-16 h-56 w-56 rounded-full border-[32px] border-white/5"
                />
                <div
                  aria-hidden="true"
                  className="absolute -bottom-20 -left-12 h-64 w-64 rounded-full border-[40px] border-orange/15"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-4 rounded-xl border border-dashed border-white/25"
                />
                <div className="relative">
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/15 bg-white/10">
                    <ImageIcon size={28} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <p className="font-heading mt-5 text-lg font-bold">
                    Batch image placeholder
                  </p>
                  <p className="mt-2 text-xs font-medium uppercase tracking-widest text-white/65">
                    ANM/GNM 2027 · Champion Batch
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-start gap-3">
                <GraduationCap
                  size={22}
                  className="mt-0.5 shrink-0 text-orange-dark"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-navy/60">
                    Exam name
                  </p>
                  <p className="font-heading mt-1 text-base font-bold leading-6 text-navy">
                    WB ANM (R) &amp; GNM Entrance Examination 2027
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-center border-t border-navy/10 bg-white p-6 sm:p-9 lg:border-l lg:border-t-0">
              <p className="text-xs font-bold uppercase tracking-widest text-navy/60">
                Course fees
              </p>
              <h3 className="font-heading mt-2 text-xl font-extrabold text-navy">
                Diwali Special Offer
              </h3>
              <p className="mt-6 text-sm text-navy/65">
                Regular price{" "}
                <del className="ml-2 decoration-navy/50">{formatINR(CHAMPION_BATCH.regularPrice)}</del>
              </p>
              <p className="font-heading mt-2 flex flex-wrap items-baseline gap-x-3 text-navy">
                <span className="text-5xl font-extrabold tracking-tight sm:text-6xl">
                  {formatINR(CHAMPION_BATCH.offerPrice)}
                </span>
                <span className="text-lg font-bold">Only</span>
              </p>
              <p className="mt-2 text-sm text-navy/65">
                Total discounted course fee
              </p>

              <dl className="mt-6 grid grid-cols-2 divide-x divide-orange/25 rounded-2xl border border-orange/25 bg-orange/10 py-4">
                <div className="px-4 sm:px-5">
                  <dt className="text-xs font-semibold text-navy/70">
                    Join now
                  </dt>
                  <dd className="font-heading mt-1 text-2xl font-extrabold text-navy">
                    {formatINR(CHAMPION_BATCH.joiningAmount)} <span className="text-xs font-semibold">Only</span>
                  </dd>
                </div>
                <div className="px-4 sm:px-5">
                  <dt className="text-xs font-semibold text-navy/70">
                    Remaining amount
                  </dt>
                  <dd className="font-heading mt-1 text-2xl font-extrabold text-navy">
                    {formatINR(CHAMPION_BATCH.remainingAmount)}
                  </dd>
                </div>
              </dl>

              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-analytics-placement="champion-batch"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-orange px-5 py-3.5 text-sm font-bold text-navy transition-colors hover:bg-orange-dark focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
              >
                Join now for {formatINR(CHAMPION_BATCH.joiningAmount)}
                <ArrowUpRight size={18} aria-hidden="true" />
                <span className="sr-only">
                  {" "}
                  in the medhaup app on Google Play (opens in a new tab)
                </span>
              </a>
              <p className="mt-3 text-center text-xs leading-5 text-navy/65">
                Enroll through the medhaup app. ₹900 remains payable as per the
                applicable payment schedule.
              </p>
              <Link
                href={CHAMPION_BATCH.guidanceHref}
                data-analytics-placement="champion-batch-guidance"
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-navy/20 px-5 py-3 text-sm font-bold text-navy transition-colors hover:border-navy hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
              >
                <MessageCircle size={18} aria-hidden="true" />
                Get admission guidance
              </Link>
              <p className="mt-2 text-center text-xs leading-5 text-navy/65">
                Need help enrolling? Share your details and we&apos;ll guide you.
              </p>
              <p className="mt-4 border-t border-navy/10 pt-4 text-xs leading-5 text-navy/65">
                Fees, including the ₹450 joining amount, are non-refundable,
                except where required by applicable law. Review the terms below
                before paying.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-10 lg:mt-12 lg:grid-cols-[1.35fr_1fr] lg:gap-12">
          <div>
            <h3 className="font-heading text-xl font-extrabold text-navy sm:text-2xl">
              Course features
            </h3>
            <ul className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-3 text-sm leading-6 text-navy/80"
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-orange/15 text-navy">
                    <Check size={12} strokeWidth={3} aria-hidden="true" />
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-heading text-xl font-extrabold text-navy sm:text-2xl">
              Our expert faculty
            </h3>
            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              {FACULTY.map((teacher) => (
                <div
                  key={teacher.subject}
                  className="flex flex-col rounded-2xl border border-navy/10 bg-cream px-4 py-4"
                >
                  <dt className="text-xs leading-5 text-navy/65">
                    {teacher.subject}
                  </dt>
                  <dd className="font-heading mt-auto pt-2 text-sm font-bold text-navy">
                    {teacher.name}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-10 grid gap-6 rounded-2xl bg-navy p-6 text-white sm:p-8 lg:mt-12 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-10">
          <div className="flex items-start gap-4">
            <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10 text-orange sm:grid">
              <Smartphone size={24} aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-heading text-xl font-bold">How to enroll?</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/80">
                Download the medhaup App from{" "}
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-analytics-placement="champion-batch"
                  className="font-semibold text-white underline decoration-orange underline-offset-4 hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange"
                >
                  Google Play Store
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                and enroll in the CHAMPION BATCH.
              </p>
              <Link
                href={CHAMPION_BATCH.guidanceHref}
                data-analytics-placement="champion-batch-guidance"
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-white underline decoration-orange underline-offset-4 hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange"
              >
                <MessageCircle size={16} aria-hidden="true" />
                Need help? Get admission guidance
              </Link>
            </div>
          </div>
          <div className="border-t border-white/20 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <p className="text-xs font-medium text-white/75">
              For Admission &amp; Enquiries
            </p>
            <a
              href="tel:+918910840928"
              data-analytics-placement="champion-batch"
              className="font-heading mt-2 inline-flex items-center gap-2 text-xl font-bold text-white hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange"
            >
              <Phone size={18} className="text-orange" aria-hidden="true" />
              8910840928
            </a>
          </div>
        </div>

        <details className="group mt-6 rounded-2xl border border-navy/10 bg-cream">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-5 text-sm font-bold text-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy sm:px-6 [&::-webkit-details-marker]:hidden">
            Important Terms &amp; Conditions
            <ChevronDown
              size={18}
              aria-hidden="true"
              className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ol className="mx-5 list-decimal space-y-3 border-t border-navy/10 py-5 pl-5 pr-1 text-sm leading-7 text-navy/75 sm:mx-6">
            {TERMS.map((term) => (
              <li key={term.text} className="pl-1">
                {term.title && (
                  <strong className="font-semibold text-navy">
                    {term.title}{" "}
                  </strong>
                )}
                {term.text}
              </li>
            ))}
          </ol>
        </details>

        <p className="mt-7 text-center text-xs font-medium text-navy/60">
          medhaup – Clear Concept, Score Up
        </p>
      </div>
    </section>
  );
}
