import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { appPrivacy } from "./appPrivacy.js";
import type { Finding } from "./check.js";
import { needsImpressum, pageURL, type Facts } from "./facts.js";
import { CURRENT_VERSION, usesIndentedLists } from "./migrate.js";
import type { ScanResult } from "./scan.js";

/**
 * The go-live checklist for an iOS app. Items ShelfReady can verify are ticked automatically
 * from `check` (and `check --online`); the rest are manual and ticked with `shelf checklist --done <id>`,
 * which stores the date in shelfready.yaml.
 */
export type Status = "done" | "todo" | "fail";

export interface Context {
  facts: Facts;
  scan: ScanResult;
  findings: Finding[];
  /** Findings from `check --online`; undefined when not run. */
  online?: Finding[];
}

interface Item {
  id: string;
  group: string;
  title: string;
  /** What to do, shown while the item isn't done. */
  how: (c: Context) => string;
  /** Automatic items return a status; manual items leave this out. */
  auto?: (c: Context) => { status: Status; detail?: string };
  applies?: (facts: Facts) => boolean;
}

export interface ChecklistRow {
  id: string;
  group: string;
  title: string;
  status: Status;
  automatic: boolean;
  detail?: string;
  how?: string;
}

const has = (c: Context, prefix: string) => c.findings.some((f) => f.level === "error" && f.rule.startsWith(prefix));
const de = (f: Facts) => needsImpressum(f);

function onlineItem(page: "privacy" | "support" | "impressum") {
  return (c: Context) => {
    if (!c.online) return { status: "todo" as Status, detail: "run with --online to verify" };
    const f = c.online.filter((x) => x.rule.startsWith(`online.${page}`));
    if (f.some((x) => x.level === "error")) return { status: "fail" as Status, detail: f.find((x) => x.level === "error")!.message };
    if (f.some((x) => x.level === "warn")) return { status: "fail" as Status, detail: f.find((x) => x.level === "warn")!.message };
    return { status: "done" as Status, detail: pageURL(c.facts, page) };
  };
}

export const ITEMS: Item[] = [
  // Code and privacy (automatic)
  {
    id: "privacy-manifest",
    group: "Code and privacy",
    title: "Privacy manifests in every target",
    how: () => "Add PrivacyInfo.xcprivacy to the app and each extension.",
    auto: (c) => (has(c, "manifest.") ? { status: "fail" } : { status: "done", detail: `${c.scan.privacyManifests.length} found` }),
  },
  {
    id: "no-drift",
    group: "Code and privacy",
    title: "Pages match the code (no new SDKs or data types)",
    how: () => "Run `shelf check` and update shelfready.yaml.",
    auto: (c) => (has(c, "drift.") ? { status: "fail", detail: "see `shelf check`" } : { status: "done" }),
  },
  {
    id: "purpose-strings",
    group: "Code and privacy",
    title: "Permission texts are real, not placeholders",
    how: () => "Write a specific NS…UsageDescription for every permission you ask for.",
    auto: (c) => (has(c, "purpose.") ? { status: "fail" } : { status: "done", detail: `${Object.keys(c.scan.purposeStrings).length} permission texts` }),
  },
  {
    id: "export-compliance",
    group: "Code and privacy",
    title: "Export compliance declared",
    how: () => "Set ITSAppUsesNonExemptEncryption (NO if you only use Apple's built-in encryption such as HTTPS), so uploads don't stop at the encryption question.",
    auto: (c) =>
      c.scan.usesNonExemptEncryption === undefined
        ? { status: "todo" }
        : { status: "done", detail: `ITSAppUsesNonExemptEncryption = ${c.scan.usesNonExemptEncryption ? "YES" : "NO"}` },
  },
  {
    id: "app-privacy-answers",
    group: "Code and privacy",
    title: "App Privacy answers derived from the manifests",
    how: (c) => {
      const { unmapped } = appPrivacy(c.facts);
      return unmapped.length
        ? `Answer by hand in App Store Connect: ${unmapped.join(", ")}`
        : "Declare collected data in your privacy manifests; `shelf store` turns them into App Store Connect's App Privacy answers.";
    },
    auto: (c) => {
      const { entries, unmapped } = appPrivacy(c.facts);
      if (unmapped.length) return { status: "todo" };
      const summary = entries[0]?.data_protections.includes("DATA_NOT_COLLECTED") ? "Data Not Collected" : `${entries.length} data categories`;
      return { status: "done", detail: `${summary} (\`shelf store\` writes the fastlane file)` };
    },
  },

  // Pages
  { id: "privacy-page", group: "Pages", title: "Privacy policy is live and current", how: () => "Run `shelf pages`, deploy, then `shelf checklist --online`.", auto: onlineItem("privacy") },
  { id: "support-page", group: "Pages", title: "Support page is live and current", how: () => "Run `shelf pages`, deploy, then `shelf checklist --online`.", auto: onlineItem("support") },
  { id: "impressum-page", group: "Pages", title: "Impressum is live", how: () => "Publish the Impressum page (or set pages.impressumURL to a shared one).", auto: onlineItem("impressum"), applies: de },
  {
    id: "impressum-in-app",
    group: "Pages",
    title: "Impressum reachable inside the app",
    how: (c) => (c.facts.publisher.trader ? "Show LegalView from Settings: `shelf pages --swiftui`." : "Add a link to the Impressum in Settings."),
    auto: (c) => (c.findings.some((f) => f.rule.startsWith("impressum.")) ? { status: c.facts.publisher.trader ? "fail" : "todo" } : { status: "done" }),
    applies: de,
  },
  {
    id: "trader-details",
    group: "Pages",
    title: "Trader details complete (address, second contact, register)",
    how: () => "Fill publisher.* in shelfready.yaml; `shelf check` lists what's missing.",
    auto: (c) => (has(c, "trader.") ? { status: "fail", detail: "see `shelf check`" } : { status: "done" }),
    applies: (f) => f.publisher.trader && de(f),
  },

  // Legal (manual)
  {
    id: "trademark",
    group: "Legal",
    title: "Trademark search for the app name",
    how: (c) => `Search "${c.facts.app.name}" in classes 9 and 42 on https://www.tmdn.org/tmview (EU) and https://tmsearch.uspto.gov (US).`,
  },
  {
    id: "trader-status",
    group: "Legal",
    title: "EU trader status declared in App Store Connect",
    how: (c) =>
      c.facts.publisher.trader
        ? "App Store Connect › Business: declare that you're a trader; Apple verifies and shows your address and phone on the EU store page."
        : "App Store Connect › Business: declare that you're not a trader (free app, no in-app purchases).",
  },
  {
    id: "paid-agreements",
    group: "Legal",
    title: "Paid Apps agreement, banking and tax",
    how: () => "App Store Connect › Business: accept the Paid Apps agreement, add bank and tax details; consider the Small Business Program.",
    applies: (f) => f.publisher.trader,
  },

  // App Store Connect (manual)
  { id: "asc-app-info", group: "App Store Connect", title: "App information", how: () => "Name and subtitle (30 characters each), category, copyright." },
  {
    id: "asc-urls",
    group: "App Store Connect",
    title: "Privacy policy and support URLs entered",
    how: (c) => `Privacy policy URL: ${pageURL(c.facts, "privacy")} · Support URL: ${pageURL(c.facts, "support")}`,
  },
  {
    id: "asc-app-privacy",
    group: "App Store Connect",
    title: "App Privacy answers submitted",
    how: () => "`shelf store`, then `fastlane run upload_app_privacy_details_to_app_store json_path:fastlane/app_privacy_details.json`, or answer by hand.",
  },
  { id: "asc-age-rating", group: "App Store Connect", title: "Age rating questionnaire", how: () => "Answer every content question in App Store Connect." },
  { id: "asc-screenshots", group: "App Store Connect", title: "Screenshots", how: () => "Upload screenshots for the largest iPhone size App Store Connect asks for (and iPad if you support it)." },

  // Release (manual)
  { id: "testflight", group: "Release", title: "TestFlight build tested on a device", how: () => "Upload a build, install it with TestFlight, and test a fresh install." },
  { id: "submitted", group: "Release", title: "Submitted for App Review", how: () => "Add the build to the version and submit." },
];

export function checklist(c: Context): ChecklistRow[] {
  const ticks = c.facts.checklist ?? {};
  return ITEMS.filter((i) => !i.applies || i.applies(c.facts)).map((i) => {
    if (i.auto) {
      const r = i.auto(c);
      return { id: i.id, group: i.group, title: i.title, status: r.status, automatic: true, ...(r.detail ? { detail: r.detail } : {}), ...(r.status !== "done" ? { how: i.how(c) } : {}) };
    }
    const date = ticks[i.id];
    return date
      ? { id: i.id, group: i.group, title: i.title, status: "done", automatic: false, detail: `ticked ${date}` }
      : { id: i.id, group: i.group, title: i.title, status: "todo", automatic: false, how: i.how(c) };
  });
}

export function checklistMarkdown(rows: ChecklistRow[], appName: string): string {
  const out = [`# ${appName} go-live checklist`, "", `_${rows.filter((r) => r.status === "done").length} of ${rows.length} done. Generated by \`shelf checklist --markdown\`._`, ""];
  for (const group of [...new Set(rows.map((r) => r.group))]) {
    out.push(`## ${group}`, "");
    for (const r of rows.filter((x) => x.group === group)) {
      const note = r.status === "done" ? (r.detail ? ` (${r.detail})` : "") : r.how ? `: ${r.how}` : "";
      out.push(`- [${r.status === "done" ? "x" : " "}] **${r.title}**${note}${r.automatic ? "" : ` \`${r.id}\``}`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** Tick or untick manual items in shelfready.yaml, keeping comments and style. Returns the new file text. */
export function setTicks(path: string, ids: string[], done: boolean, date = new Date().toISOString().slice(0, 10)): string {
  const text = readFileSync(path, "utf8");
  const doc = parseDocument(text);
  const version = Number(doc.get("version"));
  if (version !== CURRENT_VERSION) throw new Error(`shelfready.yaml is schema v${version}; run \`shelf migrate\` first.`);
  for (const id of ids) {
    const item = ITEMS.find((i) => i.id === id);
    if (!item) throw new Error(`Unknown checklist item "${id}". Manual items: ${ITEMS.filter((i) => !i.auto).map((i) => i.id).join(", ")}`);
    if (item.auto) throw new Error(`"${id}" is checked automatically; fix it in the repo or pages instead.`);
    if (done) doc.setIn(["checklist", id], date);
    else doc.deleteIn(["checklist", id]);
  }
  return doc.toString({ lineWidth: 100, indentSeq: usesIndentedLists(text) });
}
