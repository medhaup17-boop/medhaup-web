"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Smartphone,
  MessageCircle,
  CalendarDays,
  Clock,
  Wifi,
  IndianRupee,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  ShieldCheck,
  Download,
  UserRound,
  PhoneCall,
  Rocket,
} from "lucide-react";
import { useSite } from "@/components/provider/SiteProvider";
import { trackGAEvent } from "@/lib/analytics";
import { appendAttributionToFormData } from "@/lib/attribution";
import { PLAY_STORE_URL } from "@/lib/app-links";
import { CHAMPION_BATCH } from "@/lib/champion-batch";
import { formatINR } from "@/lib/coursePricing";
import type { Batch } from "@/lib/data";

/* Web3Forms access key for admission guidance requests. */
const WEB3FORMS_ACCESS_KEY = "e4e66ca4-46d3-42dc-97cb-af9fe61a4cd1";

const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL;

const APP_STEPS = [
  { icon: Download, text: "Download the medhaup app" },
  { icon: UserRound, text: "Create your account" },
  { icon: Rocket, text: "Pay in-app & start learning" },
];

const FORM_STEPS = [
  { icon: Send, text: "Send your admission guidance request" },
  { icon: PhoneCall, text: "We call / WhatsApp you within 24 hours" },
  { icon: Rocket, text: "Complete admission with our guidance" },
];

const FAQS = [
  {
    q: "When do I pay?",
    a: "If you use the app, you pay securely inside the app when you enrol. If you request admission guidance, we'll explain the process before you pay. Submitting this form does not make a payment or confirm admission.",
  },
  {
    q: "Can I join with an initial payment?",
    a: `Yes. The Diwali offer fee for ${CHAMPION_BATCH.name} is ${formatINR(CHAMPION_BATCH.offerPrice)}, reduced from ${formatINR(CHAMPION_BATCH.regularPrice)}. Join with ${formatINR(CHAMPION_BATCH.joiningAmount)} and pay the remaining ${formatINR(CHAMPION_BATCH.remainingAmount)} according to the applicable payment schedule. Ask our team to explain the schedule before paying.`,
  },
  {
    q: "What if the batch fills up?",
    a: "Seats are limited per batch. If the current batch fills before your admission completes, you'll get priority for the next batch — we'll tell you honestly either way.",
  },
  {
    q: "Can I talk to someone before deciding?",
    a: "Yes. Request admission guidance using the form above. We'll help you understand the course, fees and app enrollment process in Bengali or English before you decide.",
  },
];

type Status = "idle" | "sending" | "success" | "error";

export default function AdmissionPageContent({
  batch,
}: {
  batch: Batch | null;
}) {
  const SITE = useSite();
  const [status, setStatus] = useState<Status>("idle");

  /* Fallback keeps the page working even with no published batch —
     the admin panel controls this via the Batches collection. */
  const CURRENT_BATCH: Batch = batch ?? {
    id: "",
    name: CHAMPION_BATCH.name,
    startDate: "To be announced",
    mode: "Online",
    timing: "To be announced",
    seatsFilled: 0,
    seatsTotal: 30,
  };

  const ADMISSION_WHATSAPP_URL = `https://wa.me/${SITE.whatsapp.number}?text=${encodeURIComponent(
    `Hi, I need admission guidance for ${CURRENT_BATCH.name} of the ANM/GNM course.`,
  )}`;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");

    const form = e.currentTarget;
    const data = new FormData(form);
    data.append("access_key", WEB3FORMS_ACCESS_KEY);
    data.append("from_name", "medhaup Admission Guidance");
    data.append("form_type", "admission");
    data.append("request_type", "admission_guidance");
    data.append("batch", CURRENT_BATCH.name);
    appendAttributionToFormData(data);

    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: data,
      });
      const json = await res.json();
      if (json.success) {
        trackGAEvent("generate_lead", {
          lead_type: "admission_guidance",
          batch_name: CURRENT_BATCH.name,
        });
        setStatus("success");
        form.reset();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  const batchInfo = [
    { icon: CalendarDays, label: "Starts", value: CURRENT_BATCH.startDate },
    { icon: Clock, label: "Timing", value: CURRENT_BATCH.timing },
    { icon: Wifi, label: "Mode", value: `100% ${CURRENT_BATCH.mode}` },
    {
      icon: IndianRupee,
      label: "Fee",
      value: `${formatINR(CHAMPION_BATCH.offerPrice)} total · Join with ${formatINR(CHAMPION_BATCH.joiningAmount)}`,
    },
  ];

  return (
    <main className="w-full overflow-x-hidden">
      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden bg-navy pt-32 pb-14 sm:pt-40 sm:pb-16">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute -right-28 -top-28 h-80 w-80 rounded-full bg-orange/20 blur-3xl"
        />

        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <motion.span
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-block rounded-full border border-orange/40 bg-orange/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-orange"
          >
            {CURRENT_BATCH.name} · Now Enrolling
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="font-heading mt-5 text-4xl font-extrabold tracking-tight text-white sm:text-5xl"
          >
            Reserve your <span className="text-orange">seat</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.16 }}
            className="mx-auto mt-4 max-w-xl text-white/65 sm:text-lg"
          >
            Two ways to join — do it yourself in the app in minutes, or let us
            guide you through it personally. Both lead to the same classroom.
          </motion.p>

          {/* Batch info strip */}
          <motion.ul
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.24 }}
            className="mx-auto mt-9 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {batchInfo.map((item) => (
              <li
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-sm"
              >
                <item.icon size={17} className="mx-auto text-orange" />
                <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  {item.label}
                </p>
                <p className="font-heading mt-0.5 text-xs font-bold text-white sm:text-sm">
                  {item.value}
                </p>
              </li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* ============ TWO PATHS ============ */}
      <section className="bg-white py-14 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
            {/* ---------- Path A: App (primary) ---------- */}
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55 }}
              className="relative flex flex-col overflow-hidden rounded-3xl bg-navy p-7 text-white shadow-2xl shadow-navy/25 sm:p-9"
            >
              <div
                aria-hidden="true"
                className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-orange/20 blur-3xl"
              />

              <div className="relative flex-1">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white">
                  Fastest Way
                </span>
                <span className="mt-5 grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-orange">
                  <Smartphone size={27} />
                </span>
                <h2 className="font-heading mt-4 text-2xl font-extrabold">
                  Admit yourself in the app
                </h2>
                <p className="mt-2.5 text-sm leading-relaxed text-white/65">
                  Download the medhaup app and choose {CHAMPION_BATCH.name}.
                  The Diwali offer fee is {formatINR(CHAMPION_BATCH.offerPrice)}.
                  Join with {formatINR(CHAMPION_BATCH.joiningAmount)} and pay the
                  remaining {formatINR(CHAMPION_BATCH.remainingAmount)} according
                  to the applicable payment schedule.
                </p>

                <ol className="mt-6 space-y-3">
                  {APP_STEPS.map((s, i) => (
                    <li key={s.text} className="flex items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold text-orange">
                        {i + 1}
                      </span>
                      <span className="flex items-center gap-2 text-sm text-white/85">
                        <s.icon size={15} className="text-orange" />
                        {s.text}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Store buttons */}
              <div className="relative mt-7 flex flex-col gap-3 sm:flex-row">
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-orange px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange/25 transition-all duration-200 hover:bg-orange-dark"
                >
                  <Download size={17} />
                  Google Play
                </a>

                {APP_STORE_URL ? (
                  <a
                    href={APP_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-center gap-2 rounded-full border-2 border-white/25 px-5 py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:border-white hover:bg-white/10"
                  >
                    <Download size={17} />
                    App Store
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    className="flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-full border-2 border-white/10 px-5 py-3.5 text-sm font-semibold text-white/45"
                  >
                    <Download size={17} />
                    App Store · Coming soon
                  </span>
                )}
              </div>
            </motion.div>

            {/* ---------- Path B: Admission guidance form ---------- */}
            <motion.div
              id="admission-guidance"
              role="region"
              aria-labelledby="admission-guidance-heading"
              tabIndex={-1}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="flex min-w-0 scroll-mt-28 flex-col rounded-3xl border border-navy/10 bg-cream p-7 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy sm:p-9"
            >
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-navy/8 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-navy">
                Need help enrolling?
              </span>
              <h2 id="admission-guidance-heading" className="font-heading mt-5 text-2xl font-extrabold text-navy">
                Admission guidance
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-navy/60">
                Have questions first? Fill this in and we&apos;ll personally
                guide you through admission — in Bengali or English.
              </p>

              <div className="mt-5 rounded-2xl border border-orange/25 bg-white p-4 sm:p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-navy/65">Diwali Special Offer</p>
                <p className="font-heading mt-1 text-sm font-bold text-navy">{CHAMPION_BATCH.name}</p>
                <p className="mt-3 text-sm text-navy/65">
                  Regular price <del>{formatINR(CHAMPION_BATCH.regularPrice)}</del>
                </p>
                <p className="font-heading mt-1 text-3xl font-extrabold text-navy">
                  {formatINR(CHAMPION_BATCH.offerPrice)} <span className="text-sm font-semibold">total</span>
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-navy/10 pt-4 text-sm">
                  <div>
                    <dt className="text-navy/65">Joining amount</dt>
                    <dd className="mt-1 font-bold text-navy">{formatINR(CHAMPION_BATCH.joiningAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-navy/65">Remaining amount</dt>
                    <dd className="mt-1 font-bold text-navy">{formatINR(CHAMPION_BATCH.remainingAmount)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-navy/65">
                  Pay the remaining amount according to the applicable payment schedule.
                  Course access lasts until the ANM/GNM 2027 entrance examination,
                  subject to the platform&apos;s access policy.
                </p>
                <p className="mt-2 text-xs leading-5 text-navy/65">
                  Fees, including the joining amount, are non-refundable except
                  where required by applicable law. Review the course details,
                  fee structure and terms before paying.
                </p>
              </div>

              {status === "success" ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-6 text-center"
                >
                  <CheckCircle2 className="mx-auto h-9 w-9 text-green-600" />
                  <p className="font-heading mt-3 font-bold text-navy">
                    Admission guidance request received!
                  </p>
                  <p className="mt-1 text-sm text-navy/65">
                    We&apos;ll contact you on WhatsApp or call within 24 hours
                    to help you complete admission. Can&apos;t wait?
                  </p>

                  <a
                    href={ADMISSION_WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110"
                  >
                    <MessageCircle size={16} />
                    WhatsApp us now
                  </a>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} aria-labelledby="admission-guidance-heading" className="mt-6 space-y-4">
                  <input
                    type="checkbox"
                    name="botcheck"
                    className="hidden"
                    tabIndex={-1}
                    autoComplete="off"
                  />

                  <div>
                    <label
                      htmlFor="adm-name"
                      className="mb-1.5 block text-sm font-semibold text-navy"
                    >
                      Full name
                    </label>
                    <input
                      id="adm-name"
                      name="name"
                      type="text"
                      required
                      placeholder="Student's full name"
                      className="w-full rounded-xl border border-navy/15 bg-white px-4 py-3 text-sm text-navy outline-none transition-colors placeholder:text-navy/35 focus:border-orange focus:ring-2 focus:ring-orange/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="adm-phone"
                      className="mb-1.5 block text-sm font-semibold text-navy"
                    >
                      Phone (WhatsApp)
                    </label>
                    <input
                      id="adm-phone"
                      name="phone"
                      type="tel"
                      required
                      inputMode="numeric"
                      pattern="[0-9+ -]{10,15}"
                      placeholder="10-digit mobile number"
                      className="w-full rounded-xl border border-navy/15 bg-white px-4 py-3 text-sm text-navy outline-none transition-colors placeholder:text-navy/35 focus:border-orange focus:ring-2 focus:ring-orange/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="adm-message"
                      className="mb-1.5 block text-sm font-semibold text-navy"
                    >
                      Any questions?{" "}
                      <span className="font-normal text-navy/45">
                        (optional)
                      </span>
                    </label>
                    <textarea
                      id="adm-message"
                      name="message"
                      rows={3}
                      placeholder="Tell us where you need help — app enrollment, fees, payment schedule or eligibility"
                      className="w-full resize-none rounded-xl border border-navy/15 bg-white px-4 py-3 text-sm text-navy outline-none transition-colors placeholder:text-navy/35 focus:border-orange focus:ring-2 focus:ring-orange/20"
                    />
                  </div>

                  {status === "error" && (
                    <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      Something went wrong. Try again, or message us directly on
                      WhatsApp.
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="group flex w-full items-center justify-center gap-2 rounded-full bg-orange px-6 py-3.5 font-semibold text-white shadow-lg shadow-orange/30 transition-all duration-200 hover:bg-orange-dark hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "sending" ? (
                      <>
                        <Loader2 className="h-[18px] w-[18px] animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Send className="h-[17px] w-[17px]" />
                        Get admission guidance
                      </>
                    )}
                  </button>

                  <p className="text-xs leading-5 text-navy/60">
                    This form requests guidance only. No payment is collected
                    and your admission is not confirmed by submitting it.
                  </p>

                  {/* Admission guidance steps */}
                  <ol className="space-y-2 pt-2">
                    {FORM_STEPS.map((s, i) => (
                      <li
                        key={s.text}
                        className="flex items-center gap-2.5 text-xs text-navy/55"
                      >
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-navy/8 text-[10px] font-bold text-navy">
                          {i + 1}
                        </span>
                        {s.text}
                      </li>
                    ))}
                  </ol>
                </form>
              )}
            </motion.div>
          </div>

          {/* Trust strip */}
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center text-xs text-navy/50"
          >
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-orange" />
              No payment on this website
            </span>
            <span className="flex items-center gap-1.5">
              <UserRound size={14} className="text-orange" />
              Talk to Arushi directly, not a sales team
            </span>
            <span className="flex items-center gap-1.5">
              <IndianRupee size={14} className="text-orange" />
              Fee confirmed before you pay anything
            </span>
          </motion.p>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className="bg-cream py-14 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="font-heading text-center text-2xl font-extrabold text-navy sm:text-3xl"
          >
            Admission <span className="text-orange">questions</span>
          </motion.h2>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2">
            {FAQS.map((faq, i) => (
              <motion.div
                key={faq.q}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: i * 0.07 }}
                className="rounded-2xl border border-navy/10 bg-white p-5 sm:p-6"
              >
                <h3 className="font-heading font-bold text-navy">{faq.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy/65">
                  {faq.a}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
