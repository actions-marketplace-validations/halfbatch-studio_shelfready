// One page per SDK in the knowledge base: what it collects according to its own privacy manifest,
// and what that means for your App Privacy answers. Answers the questions developers (and their agents) search for.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sdkCollects, sdkTracks } from "../cli/dist/index.js";

// App Store Connect's labels for the privacy manifest's data types and purposes.
const TYPE_LABEL = {
  PhotosorVideos: "Photos or Videos", AudioData: "Audio Data", UserID: "User ID", DeviceID: "Device ID",
  OtherUserContactInfo: "Other User Contact Info", OtherDataTypes: "Other Data Types", EmailsOrTextMessages: "Emails or Text Messages",
  CreditInfo: "Credit Info", PaymentInfo: "Payment Info", SensitiveInfo: "Sensitive Info",
};
const PURPOSE_LABEL = {
  ThirdPartyAdvertising: "Third-Party Advertising", DeveloperAdvertising: "Developer's Advertising or Marketing",
  Analytics: "Analytics", ProductPersonalization: "Product Personalization", AppFunctionality: "App Functionality", Other: "Other Purposes",
};
const words = (s) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b(\w)(\w*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase()).replace(/\bId\b/g, "ID");
export const typeLabel = (t) => {
  const k = t.replace(/^NSPrivacyCollectedDataType/, "");
  return TYPE_LABEL[k] ?? (k === t ? t : words(k));
};
export const purposeLabel = (p) => {
  const k = p.replace(/^NSPrivacyCollectedDataTypePurpose/, "");
  return PURPOSE_LABEL[k] ?? words(k);
};

export function writeSdkPages({ dist, kb, css, esc, header, footer, siteURL }) {
  const pages = [];
  for (const e of kb) {
    const collects = sdkCollects(e);
    const tracks = sdkTracks(e);
    // Merge purposes per data type for the App Privacy summary.
    const byType = new Map();
    for (const c of collects) {
      const label = typeLabel(c.type);
      const cur = byType.get(label) ?? { linked: false, tracking: false, purposes: new Set() };
      cur.linked ||= c.linked;
      cur.tracking ||= c.tracking;
      for (const p of c.purposes ?? []) cur.purposes.add(purposeLabel(p));
      byType.set(label, cur);
    }
    const rows = [...byType.entries()].sort(([a], [b]) => a.localeCompare(b));
    const domains = [...new Set(e.products.flatMap((p) => p.trackingDomains))];
    const summary = rows.length
      ? `${e.name}'s privacy manifest declares ${rows.length} data type${rows.length === 1 ? "" : "s"}: ${rows.map(([l]) => l).join(", ")}.${tracks ? " It declares tracking." : " It doesn't declare tracking."}`
      : `${e.name}'s privacy manifest declares no collected data${tracks ? ", but declares tracking" : ""}.`;
    const title = `What ${e.name} collects on iOS: privacy manifest and App Privacy answers`;
    const description = `${summary} From ${e.vendor}'s own PrivacyInfo.xcprivacy, checked ${e.checked}.`;
    const table = rows.length
      ? `<table class="kb"><thead><tr><th scope="col">Data type</th><th scope="col">Purposes</th><th scope="col">Linked to the user</th><th scope="col">Used for tracking</th></tr></thead><tbody>
${rows.map(([l, v]) => `<tr><th scope="row">${esc(l)}</th><td>${esc([...v.purposes].join(", ") || "not stated")}</td><td>${v.linked ? "Yes" : "No"}</td><td>${v.tracking ? "Yes" : "No"}</td></tr>`).join("\n")}
</tbody></table>`
      : `<p class="kb-none">Nothing declared. That doesn't mean nothing leaves the device: see the note below.</p>`;
    const products = e.products
      .map((p) => `<li><strong>${esc(p.name)}</strong>: ${p.collects.length ? p.collects.map((c) => esc(typeLabel(c.type))).join(", ") : "no collected data"}${p.tracking ? ", tracking" : ""}. <a href="${esc(p.sources[0])}">Manifest</a></li>`)
      .join("\n");
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ShelfReady</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${siteURL}/sdks/${e.identity}/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${css}</style>
</head>
<body>
<div class="wrap">
${header}
<main class="sdk">
  <p class="crumb"><a href="/sdks/">SDKs</a></p>
  <h1 class="sdk-title">What ${esc(e.name)} collects</h1>
  <p class="lede">${esc(summary)}</p>
  <p class="basis">From ${esc(e.vendor)}'s own privacy manifest${e.products.length > 1 ? "s" : ""} in <a href="${esc(e.repository)}">${esc(e.repository.replace("https://github.com/", ""))}</a> at commit <code>${e.commit.slice(0, 7)}</code>, checked ${e.checked}.</p>

  <section class="block">
    <h2>Your App Privacy answers</h2>
    <p class="intro">If you use ${esc(e.name)}, App Store Connect's App Privacy section should include at least these. Add whatever your own code collects on top.</p>
    ${table}
    ${domains.length ? `<p class="intro">Tracking domains: ${domains.map((d) => `<code>${esc(d)}</code>`).join(", ")}. With tracking, you also need App Tracking Transparency consent.</p>` : ""}
    ${e.notes ? `<p class="note">${esc(e.notes)}</p>` : ""}
  </section>

  ${e.products.length > 1 ? `<section class="block"><h2>By module</h2><ul class="mods">${products}</ul></section>` : ""}

  <section class="block">
    <h2>Check your app</h2>
    <p class="intro">ShelfReady finds ${esc(e.name)} in Package.resolved, Podfile.lock or Cartfile.resolved, adds what it collects to your privacy policy and App Privacy answers, and fails CI when you add an SDK your policy doesn't cover.</p>
    <p class="get"><code>npx -y shelfready check</code> in your app's repo, or ask your coding agent to "get this app ready for the App Store". <a href="/#agents">Set up your agent</a>.</p>
  </section>
</main>
${footer}
</div>
</body>
</html>
`;
    mkdirSync(join(dist, "sdks", e.identity), { recursive: true });
    writeFileSync(join(dist, "sdks", e.identity, "index.html"), html);
    pages.push({ e, summary, rows: rows.length, tracks });
  }

  const list = pages
    .sort((a, b) => a.e.name.localeCompare(b.e.name))
    .map(({ e, rows, tracks }) => `<li><a href="/sdks/${e.identity}/">${esc(e.name)}</a><span>${esc(e.vendor)} · ${rows ? `${rows} data type${rows === 1 ? "" : "s"}` : "no data declared"}${tracks ? " · tracking" : ""}</span></li>`)
    .join("\n");
  writeFileSync(
    join(dist, "sdks", "index.html"),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What iOS SDKs collect: privacy manifests and App Privacy answers · ShelfReady</title>
<meta name="description" content="What ${pages.length} popular iOS SDKs collect according to their own privacy manifests, and what to declare in App Store Connect's App Privacy section.">
<link rel="canonical" href="${siteURL}/sdks/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${css}</style>
</head>
<body>
<div class="wrap">
${header}
<main class="sdk">
  <h1 class="sdk-title">What iOS SDKs collect</h1>
  <p class="lede">Each page shows what an SDK declares in its own privacy manifest, and what that means for your App Privacy answers in App Store Connect.</p>
  <ul class="sdk-list">${list}</ul>
  <p class="get">Missing one? Add it to <a href="https://github.com/halfbatch-studio/shelfready/blob/main/cli/knowledge/sources.yaml">sources.yaml</a> and open a pull request.</p>
</main>
${footer}
</div>
</body>
</html>
`,
  );
  return pages.map((p) => `/sdks/${p.e.identity}/`);
}
