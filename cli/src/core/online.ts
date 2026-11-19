import type { Finding, Level } from "./check.js";
import { needsImpressum, pageURL, type Facts } from "./facts.js";

type FetchLike = (url: string, init?: { signal?: AbortSignal; redirect?: "follow"; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
}>;

/** Visible text of an HTML page, normalised so typographic quotes and entities compare equal. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&rsquo;|&lsquo;|[‘’]/g, "'")
    .replace(/&ldquo;|&rdquo;|[“”]/g, '"')
    .replace(/&#8250;|&rsaquo;/g, "›")
    .replace(/&hellip;|&#8230;/g, "…")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Markdown inline formatting removed, for matching against rendered text. */
const plain = (md: string) => pageText(md.replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));

/**
 * `shelf check --online`: are the pages live, and do they show what shelfready.yaml says?
 * Catches dead URLs (App Review rejects them) and stale deployments.
 */
export async function checkOnline(facts: Facts, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = 10_000): Promise<Finding[]> {
  const findings: Finding[] = [];
  const add = (level: Level, rule: string, message: string) => findings.push({ level, rule, message });

  if (!facts.pages.baseURL) {
    add("error", "online.baseURL", "pages.baseURL is empty, so there is nothing to check online.");
    return findings;
  }

  const pages: { name: "privacy" | "support" | "impressum"; expect: { text: string; what: string }[] }[] = [
    {
      name: "privacy",
      expect: [
        { text: facts.app.name, what: "the app name" },
        { text: facts.pages.policyUpdated, what: `the policy date ${facts.pages.policyUpdated}` },
      ],
    },
    {
      name: "support",
      expect: [
        { text: facts.publisher.email, what: "the contact email" },
        ...facts.support.faq.map((f) => ({ text: f.q, what: `FAQ "${f.q}"` })),
      ],
    },
  ];
  if (needsImpressum(facts)) pages.push({ name: "impressum", expect: [{ text: facts.publisher.email, what: "the contact email" }] });

  await Promise.all(
    pages.map(async ({ name, expect }) => {
      const url = pageURL(facts, name);
      if (!/^https:\/\//.test(url)) return add("error", `online.${name}`, `${name} URL must be absolute https, got "${url}".`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "shelfready-check" } });
        if (!res.ok) return add("error", `online.${name}`, `${url} returned HTTP ${res.status}.`);
        const text = pageText(await res.text());
        const missing = expect.filter((e) => !text.includes(plain(e.text))).map((e) => e.what);
        if (missing.length) add("warn", `online.${name}.stale`, `${url} is live but doesn't show ${missing.join(", ")}. Redeploy the generated page?`);
        else add("ok", `online.${name}`, `${url} is live and up to date.`);
      } catch (e) {
        const reason = (e as Error).name === "AbortError" ? `no response within ${timeoutMs / 1000}s` : (e as Error).message;
        add("error", `online.${name}`, `${url} unreachable: ${reason}.`);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return findings.sort((a, b) => a.rule.localeCompare(b.rule));
}
