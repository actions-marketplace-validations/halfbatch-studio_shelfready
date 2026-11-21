import { CATEGORY, PURPOSE } from "./appPrivacy.js";
import { impressumLines, needsImpressum, pageURL, type Facts } from "./facts.js";
import { lookup, sdkCollects } from "./knowledge.js";

/**
 * Page templates. Draft wording, generalised from the Half Batch site (kipple).
 * Must be reviewed by a lawyer before ShelfReady is offered to others; output is not legal advice.
 */
export interface Page {
  file: string;
  title: string;
  /** Path relative to the app's base URL, e.g. "privacy/". */
  path: string;
  markdown: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  NAME: "Name", EMAIL_ADDRESS: "Email address", PHONE_NUMBER: "Phone number", PHYSICAL_ADDRESS: "Physical address",
  OTHER_CONTACT_INFO: "Other contact info", HEALTH: "Health", FITNESS: "Fitness", PAYMENT_INFORMATION: "Payment info",
  CREDIT_AND_FRAUD: "Credit info", OTHER_FINANCIAL_INFO: "Other financial info", PRECISE_LOCATION: "Precise location",
  COARSE_LOCATION: "Coarse location", SENSITIVE_INFO: "Sensitive info", CONTACTS: "Contacts",
  EMAILS_OR_TEXT_MESSAGES: "Emails or text messages", PHOTOS_OR_VIDEOS: "Photos or videos", AUDIO: "Audio data",
  GAMEPLAY_CONTENT: "Gameplay content", CUSTOMER_SUPPORT: "Customer support", OTHER_USER_CONTENT: "Other user content",
  BROWSING_HISTORY: "Browsing history", SEARCH_HISTORY: "Search history", USER_ID: "User ID", DEVICE_ID: "Device ID",
  PURCHASE_HISTORY: "Purchase history", PRODUCT_INTERACTION: "Product interaction", ADVERTISING_DATA: "Advertising data",
  OTHER_USAGE_DATA: "Other usage data", CRASH_DATA: "Crash data", PERFORMANCE_DATA: "Performance data",
  OTHER_DIAGNOSTIC_DATA: "Other diagnostic data", OTHER_DATA: "Other data",
};

const PURPOSE_LABEL: Record<string, string> = {
  THIRD_PARTY_ADVERTISING: "third-party advertising", DEVELOPERS_ADVERTISING: "the developer's own advertising",
  ANALYTICS: "analytics", PRODUCT_PERSONALIZATION: "personalisation", APP_FUNCTIONALITY: "making the app work",
  OTHER_PURPOSES: "other purposes",
};

/** First-person words for the publisher's voice. */
function voice(facts: Facts) {
  return facts.publisher.voice === "I"
    ? { We: "I", we: "I", us: "me", our: "my" }
    : { We: "We", we: "we", us: "us", our: "our" };
}

export function renderPages(facts: Facts): Page[] {
  const pages: Page[] = [privacyPolicy(facts), supportPage(facts)];
  // A shared Impressum (impressumURL) lives elsewhere, e.g. on the studio site.
  if (needsImpressum(facts) && !facts.pages.impressumURL) pages.push(impressum(facts));
  return pages;
}

function by(facts: Facts): string {
  return facts.publisher.brand || facts.publisher.name || "the developer";
}

function contactLine(facts: Facts): string {
  const p = facts.publisher;
  const who = p.trader && p.name ? `${p.name}${p.brand ? ` (${p.brand})` : ""}` : by(facts);
  const impressumLink = needsImpressum(facts) ? `, see the [Impressum](${pageURL(facts, "impressum")})` : "";
  return `${who}, [${p.email}](mailto:${p.email})${impressumLink}`;
}

export function privacyPolicy(facts: Facts): Page {
  const { app, data } = facts;
  const w = voice(facts);
  const none = data.collected.length === 0 && !data.tracking;
  const lines: string[] = [`# ${app.name} privacy policy`, "", `_Last updated: ${facts.pages.policyUpdated}_`, ""];
  lines.push(app.tagline ? `${app.name} is ${app.tagline}, made by ${by(facts)}.` : `${app.name} is an app by ${by(facts)}.`, "");

  lines.push("## The short version", "");
  if (none) {
    lines.push(`${app.name} doesn't collect, store or share any of your data. There are no accounts, no analytics, no ads and no tracking.`, "");
  } else {
    lines.push(
      `${app.name} collects the data listed below${data.tracking ? ", and some of it is used to track you across apps and websites owned by other companies" : ", and none of it is used to track you"}.`,
      "",
    );
  }

  for (const note of facts.privacyNotes) lines.push(`## ${note.heading}`, "", note.body.trim(), "");

  lines.push(`## Data ${w.we} collect`, "");
  if (data.collected.length === 0) {
    const noSDKs = data.packages.length === 0 ? ` ${app.name} contains no third-party SDKs, analytics or crash-reporting services.` : "";
    lines.push(`None.${noSDKs || ` ${app.name} doesn't collect personal data.`}`);
    lines.push("If you've agreed to share analytics with app developers in iOS Settings, Apple may give the developer anonymous crash reports.", "");
  } else {
    lines.push("| Data | Used for | Linked to you | Used to track you |", "|---|---|---|---|");
    for (const item of data.collected) {
      const category = CATEGORY[item.type];
      const label = (category && CATEGORY_LABEL[category]) ?? item.type;
      const purposes = item.purposes.map((p) => PURPOSE_LABEL[PURPOSE[p] ?? ""] ?? p).join(", ") || "—";
      lines.push(`| ${label} | ${purposes} | ${item.linked ? "Yes" : "No"} | ${item.tracking ? "Yes" : "No"} |`);
    }
    lines.push("");
  }

  const services = data.packages.map((p) => lookup(p)).filter((e) => e !== undefined && sdkCollects(e).length > 0);
  if (services.length) {
    lines.push("## Third-party services", "", `${app.name} includes these services, which collect data as described in their own privacy manifests:`, "");
    for (const s of services) {
      const labels = [...new Set(sdkCollects(s!).map((c) => CATEGORY_LABEL[CATEGORY[c.type] ?? ""] ?? c.type))];
      lines.push(`- **${s!.name}** (${s!.vendor}): ${labels.join(", ").toLowerCase()}`);
    }
    lines.push("");
  }

  if (facts.pages.sitePrivacyURL) {
    lines.push("## This website", "", `For the website itself, see the [website privacy notice](${facts.pages.sitePrivacyURL}).`, "");
  }

  lines.push(
    "## Your rights",
    "",
    none
      ? `Because ${app.name} doesn't collect personal data, there's nothing held about you to access, correct or delete. If you have questions about your rights under the GDPR, contact ${w.us} below.`
      : `Under the GDPR you can ask to access, correct or delete your personal data, restrict or object to its use, and complain to a data protection authority. Contact ${w.us} below to make a request.`,
    "",
    "## Children",
    "",
    none ? `${app.name} doesn't collect data from anyone, including children.` : `${app.name} isn't directed at children under 13, and ${w.we} don't knowingly collect their data.`,
    "",
    "## Changes",
    "",
    "If this policy changes, the new version will be posted at this address, with a new date above.",
    "",
    "## Contact",
    "",
    contactLine(facts),
    "",
  );
  return { file: "privacy.md", title: `${app.name} privacy policy`, path: "privacy/", markdown: lines.join("\n") };
}

export function supportPage(facts: Facts): Page {
  const { app, publisher, support } = facts;
  const w = voice(facts);
  const lines = [
    `# ${app.name} support`,
    "",
    `Questions, bugs or ideas: email **[${publisher.email}](mailto:${publisher.email})**. ${w.We} usually reply ${support.replyTime}.`,
    "",
    `Please include ${support.askFor || "your device model and iOS version"}, and what you expected to happen.`,
    "",
  ];
  if (support.faq.length > 0) {
    lines.push("## Frequently asked questions", "");
    for (const { q, a } of support.faq) lines.push(`**${q}**`, a.trim(), "");
  }
  lines.push("## Privacy", "", `See the [${app.name} privacy policy](${pageURL(facts, "privacy")}).`, "");
  return { file: "support.md", title: `${app.name} support`, path: "support/", markdown: lines.join("\n") };
}

/** German-language Impressum (§ 5 DDG for DE, § 5 ECG for AT), with an English notice. */
export function impressum(facts: Facts): Page {
  const p = facts.publisher;
  const law = p.country.toUpperCase() === "AT" ? "§ 5 ECG" : "§ 5 DDG";
  const lines: string[] = [];
  if (p.trader) {
    lines.push(
      "# Impressum",
      "",
      `## Angaben gemäß ${law}`,
      "",
      impressumLines(facts)
        .map(({ label, value }) => (label ? `${label}: ${value.includes("@") ? `[${value}](mailto:${value})` : value}` : value))
        .join("  \n"),
      "",
      "## Verantwortlich für den Inhalt",
      "",
      `${p.representative || p.name}, Anschrift wie oben.`,
      "",
      "---",
      "",
      "## Legal notice (English)",
      "",
      `${facts.app.name} is provided by ${[p.name, p.address.street, p.address.city, p.address.country].filter(Boolean).join(", ")}. Contact: ${p.email}.`,
      "",
    );
  } else {
    lines.push(
      "# Contact",
      "",
      `${by(facts)} is a private, non-commercial project. ${facts.app.name} is free, with no in-app purchases, ads or tracking.`,
      "",
      `Email: [${p.email}](mailto:${p.email})`,
      "",
      "## Impressum",
      "",
      `${by(facts)} ist ein privates, nicht-kommerzielles Projekt ohne Gewinnabsicht. ${facts.app.name} ist kostenlos, ohne In-App-Käufe, Werbung oder Tracking.`,
      "",
      `Kontakt: [${p.email}](mailto:${p.email})`,
      "",
    );
  }
  return { file: "impressum.md", title: "Impressum", path: "impressum/", markdown: lines.join("\n") };
}

export interface PageFile {
  file: string;
  title: string;
  content: string;
}

/** Pages as files to write: optional Jekyll front matter (with a permalink when baseURL is set) and a "generated" banner. */
export function pageFiles(facts: Facts, frontMatter: "none" | "jekyll" = "jekyll"): PageFile[] {
  return renderPages(facts).map((page) => {
    const permalink = facts.pages.baseURL ? new URL(page.path, facts.pages.baseURL.replace(/\/?$/, "/")).pathname : "";
    const front =
      frontMatter === "jekyll"
        ? `---\nlayout: default\ntitle: ${JSON.stringify(page.title)}\n${permalink ? `permalink: ${permalink}\n` : ""}---\n\n`
        : "";
    const banner = "<!-- Generated by ShelfReady (`shelf pages`) from shelfready.yaml. Edit that file, not this page. -->\n\n";
    return { file: page.file, title: page.title, content: front + banner + page.markdown };
  });
}
