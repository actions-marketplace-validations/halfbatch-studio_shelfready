import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { appPrivacy } from "./appPrivacy.js";
import { factsFromScan, isCompany, needsImpressum, pageURL, type Facts } from "./facts.js";
import type { ScanResult } from "./scan.js";
import { CURRENT_VERSION } from "./migrate.js";
import { lookup, sdkCollects } from "./knowledge.js";

const KNOWN_TOP = new Set(["version", "app", "publisher", "data", "privacyNotes", "support", "pages", "checklist"]);
const KNOWN_PUBLISHER = new Set([
  "brand", "voice", "name", "country", "email", "trader", "address",
  "phone", "contactURL", "vatId", "legalForm", "representative", "register",
]);

export type Level = "error" | "warn" | "ok";
export interface Finding {
  level: Level;
  rule: string;
  message: string;
}

/**
 * Local preflight. Compares shelfready.yaml with what the repo says today, so a new SDK or
 * manifest change that the pages don't reflect fails the build (`shelf check --ci`).
 */
export function check(facts: Facts, scan: ScanResult, opts: { fileVersion?: number } = {}): Finding[] {
  const findings: Finding[] = [];
  const add = (level: Level, rule: string, message: string) => findings.push({ level, rule, message });

  // The config file itself
  const fileVersion = opts.fileVersion ?? facts.version;
  if (fileVersion < CURRENT_VERSION) add("warn", "config.outdated", `shelfready.yaml is schema v${fileVersion}; this shelf uses v${CURRENT_VERSION}. Run \`shelf migrate\` and review the new fields.`);
  for (const k of Object.keys(facts)) if (!KNOWN_TOP.has(k)) add("warn", "config.unknownKey", `Unknown key "${k}" in shelfready.yaml (typo, or from a newer shelf?).`);
  for (const k of Object.keys(facts.publisher ?? {})) if (!KNOWN_PUBLISHER.has(k)) add("warn", "config.unknownKey", `Unknown key "publisher.${k}" in shelfready.yaml.`);
  if (facts.publisher.voice !== "I" && facts.publisher.voice !== "we") add("error", "config.voice", `publisher.voice must be "I" or "we", not "${facts.publisher.voice}".`);
  const now = factsFromScan(scan, facts.publisher);
  const p = facts.publisher;

  // Drift between the facts and the repo
  const key = (x: unknown) => JSON.stringify(x);
  const missing = now.data.collected.filter((c) => !facts.data.collected.some((f) => key(f) === key(c)));
  const extra = facts.data.collected.filter((f) => !now.data.collected.some((c) => key(c) === key(f)));
  if (missing.length) {
    const short = (type: string) => type.replace("NSPrivacyCollectedDataType", "");
    const origin = (type: string) => {
      const sdks = now.data.packages.map((p) => lookup(p)).filter((e) => e && sdkCollects(e).some((c) => c.type === type)).map((e) => e!.name);
      return sdks.length ? `${short(type)} (${sdks.join(", ")})` : short(type);
    };
    add("error", "drift.collected", `The app or its SDKs collect data not in shelfready.yaml: ${[...new Set(missing.map((m) => m.type))].map(origin).join(", ")}. Add it to data.collected in shelfready.yaml.`);
  }
  if (extra.length) add("warn", "drift.collected", `shelfready.yaml lists data no manifest declares: ${extra.map((m) => m.type).join(", ")}`);
  if (now.data.tracking !== facts.data.tracking) add("error", "drift.tracking", `Manifests say tracking=${now.data.tracking}, shelfready.yaml says ${facts.data.tracking}`);
  const newPackages = now.data.packages.filter((x) => !facts.data.packages.includes(x));
  if (newPackages.length) add("error", "drift.packages", `New packages since the pages were written: ${newPackages.join(", ")}. Check what they collect, then update shelfready.yaml.`);

  // Third-party SDKs against the knowledge base
  for (const pkg of now.data.packages) {
    const entry = lookup(pkg);
    if (!entry) {
      add("warn", "sdk.unknown", `${pkg}: not in ShelfReady's knowledge base. Check its PrivacyInfo.xcprivacy or the vendor's docs and add what it collects to data.collected.`);
    } else if (sdkCollects(entry).length === 0 && entry.notes) {
      add("warn", "sdk.yourData", `${entry.name}: ${entry.notes}`);
    }
  }
  if (key(now.app.bundleIdentifiers) !== key(facts.app.bundleIdentifiers)) add("warn", "drift.bundleIDs", "Bundle identifiers changed since shelfready.yaml was written.");

  // Repo hygiene
  if (scan.privacyManifests.length === 0) add("error", "manifest.missing", "No PrivacyInfo.xcprivacy found. Apple requires a privacy manifest.");
  for (const [k, v] of Object.entries(scan.purposeStrings)) {
    if (!v.trim() || /todo|lorem|placeholder/i.test(v)) add("error", "purpose.placeholder", `${k} looks like a placeholder: "${v}"`);
  }
  for (const m of scan.privacyManifests) {
    for (const api of m.accessedAPIs) if (api.reasons.length === 0) add("error", "manifest.reasons", `${m.path}: ${api.category} has no reason codes`);
  }

  // Publisher and pages
  if (!p.email) add("error", "publisher.email", "A public contact email is required on the support page.");
  if (!facts.pages.baseURL) add("warn", "pages.baseURL", "pages.baseURL is empty: set where the pages will live before publishing.");
  if (p.trader) {
    if (!p.name) add("error", "trader.name", "Traders must give a legal name.");
    if (!p.address.street || !p.address.city) add("error", "trader.address", "Traders must give a business address (never a home address).");
  }
  if (needsImpressum(facts)) {
    const inApp = findInAppImpressum(scan.root, pageURL(facts, "impressum"));
    if (p.trader) {
      // Paid apps: the Impressum should work offline, so the text belongs in the app.
      if (inApp !== "legalView") add("error", "impressum.legalView", "DE/AT traders should show the full Impressum inside the app (it must work offline), not only a link: run `shelf pages --swiftui` and show LegalView from Settings.");
      if (!p.phone?.trim() && !p.contactURL?.trim()) add("error", "trader.contact", "Add a second fast contact channel besides email: publisher.phone or publisher.contactURL.");
      if (!p.vatId?.trim()) add("warn", "trader.vatId", "No publisher.vatId. Add your USt-IdNr. or Wirtschafts-ID if you have one.");
      if (isCompany(facts)) {
        if (!p.representative?.trim()) add("error", "trader.representative", `${p.legalForm}: name the managing director(s) in publisher.representative.`);
        if (!p.register?.court?.trim() || !p.register?.number?.trim()) add("error", "trader.register", `${p.legalForm}: add publisher.register.court and publisher.register.number.`);
      }
    } else if (!inApp) {
      add("warn", "impressum.inApp", "The app neither shows a LegalView nor links to the Impressum: add a link, or run `shelf pages --swiftui`.");
    }
  }
  const privacy = appPrivacy(facts);
  if (privacy.unmapped.length) add("warn", "appPrivacy.unmapped", `Answer these by hand in App Store Connect: ${privacy.unmapped.join(", ")}`);

  if (!findings.some((f) => f.level !== "ok")) add("ok", "all", "shelfready.yaml matches the repo.");
  return findings;
}

/** Whether a Swift file defines LegalView (full text) or only links to the Impressum URL. */
function findInAppImpressum(root: string, impressumURL: string): "legalView" | "link" | undefined {
  let link = false;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules" || name === "build" || name === "DerivedData") continue;
      const path = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDir) stack.push(path);
      else if (name.endsWith(".swift")) {
        const source = readFileSync(path, "utf8");
        if (source.includes("struct LegalView")) return "legalView";
        if (impressumURL.startsWith("http") && source.includes(impressumURL)) link = true;
      }
    }
  }
  return link ? "link" : undefined;
}
