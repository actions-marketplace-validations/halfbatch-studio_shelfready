import { stringify } from "yaml";
import { CURRENT_VERSION, migrateFile } from "./migrate.js";
import { lookup, sdkCollects, sdkTracks } from "./knowledge.js";
import type { AccessedAPI, CollectedDataType, ScanResult } from "./scan.js";

/**
 * `shelfready.yaml`: the single source of truth for an app's legal and privacy pages.
 * Scan results fill `app` and `data`; the developer confirms `publisher` and writes `notes` and `faq`.
 */
export interface Facts {
  version: number;
  app: {
    name: string;
    bundleIdentifiers: string[];
    /** Optional one-line description, e.g. "a plain-text task planner for iPhone". */
    tagline?: string;
  };
  publisher: {
    /** Brand or studio name shown on pages, e.g. "Half Batch". */
    brand: string;
    /** How pages speak: "I" for a solo developer, "we" for a team or company. */
    voice: "I" | "we";
    /** Legal name. Required for traders; may stay empty for a non-trader hobby release. */
    name: string;
    /** ISO 3166-1 alpha-2, e.g. "DE". Decides which pages are required. */
    country: string;
    email: string;
    /** EU Digital Services Act trader status (charging for the app or in-app purchases). */
    trader: boolean;
    /** Business or virtual-office address for traders. Never a home address. */
    address: { street: string; city: string; country: string };
    /** Second fast contact channel for traders (§ 5 DDG): phone, or a contact form URL. */
    phone?: string;
    contactURL?: string;
    /** USt-IdNr. or Wirtschafts-Identifikationsnummer, if you have one. */
    vatId?: string;
    /** Empty for a sole trader; e.g. "UG (haftungsbeschränkt)" or "GmbH" for a company. */
    legalForm?: string;
    /** Managing director(s) of a company (Vertretungsberechtigte). */
    representative?: string;
    /** Commercial register entry for companies, e.g. court "Amtsgericht Berlin-Charlottenburg", number "HRB 123456 B". */
    register?: { court: string; number: string };
  };
  data: {
    tracking: boolean;
    collected: CollectedDataType[];
    accessedAPIs: AccessedAPI[];
    /** Swift packages found in the repo; check each against the knowledge base. */
    packages: string[];
  };
  /** App-specific sections for the privacy policy, e.g. where data is stored. Markdown. */
  privacyNotes: { heading: string; body: string }[];
  support: {
    replyTime: string;
    /** What bug reports should include, e.g. "your iPhone model and iOS version". */
    askFor: string;
    faq: { q: string; a: string }[];
  };
  /** Manual go-live steps you've ticked with `shelf checklist done <id>`: id → date. */
  checklist?: Record<string, string>;
  pages: {
    baseURL: string;
    /** Optional shared Impressum, e.g. a studio-wide page. Defaults to `<baseURL>impressum/`. */
    impressumURL?: string;
    /** Optional privacy notice for the website itself; adds a "This website" section. */
    sitePrivacyURL?: string;
    policyUpdated: string;
  };
}

/** Absolute URL of a page, or a relative link when no baseURL is set. */
export function pageURL(facts: Facts, page: "privacy" | "support" | "impressum"): string {
  if (page === "impressum" && facts.pages.impressumURL) return facts.pages.impressumURL;
  const base = facts.pages.baseURL;
  return base ? base.replace(/\/?$/, "/") + `${page}/` : `../${page}/`;
}

export function needsImpressum(facts: Facts): boolean {
  return ["DE", "AT"].includes(facts.publisher.country.toUpperCase());
}

/** A sole trader leaves legalForm empty; anything else is treated as a company that needs register details. */
export function isCompany(facts: Facts): boolean {
  const form = (facts.publisher.legalForm ?? "").trim().toLowerCase();
  return form !== "" && !["einzelunternehmen", "einzelunternehmer", "sole trader", "freiberufler"].includes(form);
}

/**
 * The lines of a trader's Impressum, shared by the web page and the in-app LegalView so they never differ.
 * Draft based on § 5 DDG; not legal advice.
 */
export function impressumLines(facts: Facts): { label: string; value: string }[] {
  const p = facts.publisher;
  const lines: { label: string; value: string }[] = [];
  const add = (label: string, value?: string) => value?.trim() && lines.push({ label, value: value.trim() });
  add("", [p.name, p.legalForm].filter(Boolean).join(" "));
  add("", p.brand && p.brand !== p.name ? p.brand : "");
  add("", p.address.street);
  add("", p.address.city);
  add("", p.address.country);
  add("Vertreten durch", p.representative);
  add("E-Mail", p.email);
  add("Telefon", p.phone);
  add("Kontaktformular", p.contactURL);
  add("Registergericht", p.register?.court);
  add("Registernummer", p.register?.number);
  add("USt-IdNr./W-IdNr.", p.vatId);
  return lines;
}

export function factsFromScan(
  scan: ScanResult,
  publisher: Partial<Facts["publisher"]> & Pick<Facts["publisher"], "country" | "email">,
): Facts {
  const manifests = scan.privacyManifests;
  const collected: CollectedDataType[] = [];
  // The app's own manifests plus what known third-party SDKs declare in theirs (knowledge base).
  const sdks = scan.packages.map((p) => lookup(p.identity)).filter((e) => e !== undefined);
  for (const item of [...manifests.flatMap((m) => m.collectedDataTypes), ...sdks.flatMap(sdkCollects)]) {
    if (!collected.some((c) => JSON.stringify(c) === JSON.stringify(item))) collected.push(item);
  }
  const apis = new Map<string, Set<string>>();
  for (const api of manifests.flatMap((m) => m.accessedAPIs)) {
    const reasons = apis.get(api.category) ?? new Set<string>();
    api.reasons.forEach((r) => reasons.add(r));
    apis.set(api.category, reasons);
  }
  const shortestName = [...scan.displayNames].sort((a, b) => a.length - b.length)[0] ?? "";

  return {
    version: CURRENT_VERSION,
    app: { name: shortestName, bundleIdentifiers: scan.bundleIdentifiers },
    publisher: {
      brand: publisher.brand ?? publisher.name ?? "",
      voice: publisher.voice ?? "we",
      name: publisher.name ?? "",
      country: publisher.country.toUpperCase(),
      email: publisher.email,
      trader: publisher.trader ?? false,
      address: publisher.address ?? { street: "", city: "", country: "" },
    },
    data: {
      tracking: manifests.some((m) => m.tracking) || sdks.some(sdkTracks),
      collected,
      accessedAPIs: [...apis.keys()].sort().map((category) => ({ category, reasons: [...apis.get(category)!].sort() })),
      packages: scan.packages.map((p) => p.identity),
    },
    privacyNotes: [],
    support: { replyTime: "within a few days", askFor: "your device model and iOS version", faq: [] },
    pages: { baseURL: "", policyUpdated: new Date().toISOString().slice(0, 10) },
  };
}

export interface InitOptions {
  country: string;
  email: string;
  brand?: string;
  publisher?: string;
  trader?: boolean;
  phone?: string;
  voice?: "I" | "we";
  baseUrl?: string;
}

/** What `shelf init` writes: facts from the scan plus publisher details, with empty DE/AT trader fields to fill. */
export function initFacts(scan: ScanResult, o: InitOptions): { facts: Facts; notes: string[] } {
  if (o.trader && !o.publisher) throw new Error("Traders must give a legal name (publisher).");
  const facts = factsFromScan(scan, {
    country: o.country,
    email: o.email,
    ...(o.brand ? { brand: o.brand } : {}),
    ...(o.publisher ? { name: o.publisher } : {}),
    trader: !!o.trader,
    voice: o.voice ?? "we",
  });
  if (o.baseUrl) facts.pages.baseURL = o.baseUrl;
  const de = needsImpressum(facts);
  if (facts.publisher.trader && de) {
    Object.assign(facts.publisher, { phone: o.phone ?? "", contactURL: "", vatId: "", legalForm: "", representative: "", register: { court: "", number: "" } });
  }
  const notes: string[] = [];
  if (de) notes.push(`Country ${facts.publisher.country} needs an Impressum on the web and inside the app.`);
  if (facts.publisher.trader) notes.push("Traders: add a business address under publisher.address (never a home address).");
  if (facts.publisher.trader && de) notes.push("DE/AT traders: fill phone or contactURL, vatId, and for companies legalForm, representative and register. Then show LegalView in the app.");
  notes.push("Next: add privacyNotes and support.faq, then generate the pages.");
  return { facts, notes };
}

export const FACTS_HEADER = `# shelfready.yaml: facts behind your privacy policy, support page and Impressum.
# Generated by \`shelf init\`. Check every line; you are responsible for what it says.
`;

export function factsToYAML(facts: Facts): string {
  return FACTS_HEADER + "\n" + stringify(facts, { lineWidth: 100 });
}

export interface LoadedFacts {
  facts: Facts;
  /** Schema version in the file; lower than CURRENT_VERSION means it was migrated in memory only. */
  fileVersion: number;
  migrationNotes: string[];
}

/** Read shelfready.yaml, migrating older schema versions in memory. Throws for newer versions. */
export function readFacts(path: string): LoadedFacts {
  const { doc, from, notes } = migrateFile(path);
  const facts = doc.toJS() as Facts;
  facts.privacyNotes ??= [];
  facts.support ??= { replyTime: "within a few days", askFor: "your device model and iOS version", faq: [] };
  facts.support.faq ??= [];
  return { facts, fileVersion: from, migrationNotes: notes };
}

export function loadFacts(path: string): Facts {
  return readFacts(path).facts;
}
