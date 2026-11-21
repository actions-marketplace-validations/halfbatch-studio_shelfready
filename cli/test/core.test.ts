import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "plist";
import { appPrivacy, check, factsFromScan, parseBuildSettings, renderPages, scan, legalView } from "../src/index.js";

function fixture(manifest: Record<string, unknown>, extra?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "shelf-"));
  mkdirSync(join(root, "App"));
  writeFileSync(join(root, "App/PrivacyInfo.xcprivacy"), build(manifest as never));
  extra?.(root);
  return root;
}

const crashManifest = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyCollectedDataTypes: [
    {
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeCrashData",
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
    },
  ],
  NSPrivacyAccessedAPITypes: [
    { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
  ],
};

test("build settings: generated Info.plist keys, ignoring variables", () => {
  const s = parseBuildSettings(`
        PRODUCT_BUNDLE_IDENTIFIER = com.example.app;
        INFOPLIST_KEY_CFBundleDisplayName = "My App";
        INFOPLIST_KEY_NSCameraUsageDescription = "Scan receipts";
        PRODUCT_BUNDLE_IDENTIFIER = "$(BASE_ID).widget";`);
  assert.deepEqual([...s.bundleIdentifiers], ["com.example.app"]);
  assert.deepEqual([...s.displayNames], ["My App"]);
  assert.equal(s.purposeStrings.NSCameraUsageDescription, "Scan receipts");
});

test("scan + facts + App Privacy answers", () => {
  const root = fixture(crashManifest, (r) =>
    writeFileSync(
      join(r, "Package.resolved"),
      JSON.stringify({ pins: [{ identity: "acme-kit", location: "https://github.com/acme/acme-kit", state: { version: "8.0.0" } }], version: 2 }),
    ),
  );
  try {
    const result = scan(root);
    assert.equal(result.privacyManifests.length, 1);
    assert.deepEqual(result.packages.map((p) => p.identity), ["acme-kit"]);

    const facts = factsFromScan(result, { country: "de", email: "hi@example.com", brand: "Studio" });
    assert.equal(facts.publisher.country, "DE");
    assert.deepEqual(facts.data.accessedAPIs, [{ category: "NSPrivacyAccessedAPICategoryUserDefaults", reasons: ["CA92.1"] }]);

    assert.deepEqual(appPrivacy(facts).entries, [
      { category: "CRASH_DATA", purposes: ["APP_FUNCTIONALITY"], data_protections: ["DATA_NOT_LINKED_TO_YOU"] },
    ]);
    const pages = renderPages(facts).map((p) => p.file);
    assert.deepEqual(pages, ["privacy.md", "support.md", "impressum.md"]);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("no data collected → DATA_NOT_COLLECTED, short policy", () => {
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    const facts = factsFromScan(scan(root), { country: "US", email: "a@b.c" });
    assert.deepEqual(appPrivacy(facts).entries, [{ data_protections: ["DATA_NOT_COLLECTED"] }]);
    const pages = renderPages(facts);
    assert.equal(pages.length, 2, "no Impressum outside DE/AT");
    assert.match(pages[0]!.markdown, /doesn't collect, store or share any of your data/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("check flags a new package and new collected data as drift", () => {
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    const facts = factsFromScan(scan(root), { country: "US", email: "a@b.c" });
    facts.pages.baseURL = "https://example.com/app/";
    assert.deepEqual(check(facts, scan(root)).map((f) => f.level), ["ok"]);

    writeFileSync(join(root, "App/PrivacyInfo.xcprivacy"), build(crashManifest as never));
    writeFileSync(join(root, "Package.resolved"), JSON.stringify({ pins: [{ identity: "firebase-ios-sdk", location: "x" }], version: 2 }));
    const rules = check(facts, scan(root)).filter((f) => f.level === "error").map((f) => f.rule);
    assert.deepEqual(rules.sort(), ["drift.collected", "drift.packages"]);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("trader Impressum needs name and address; LegalView escapes strings", () => {
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    const facts = factsFromScan(scan(root), { country: "DE", email: "a@b.c", trader: true });
    const rules = check(facts, scan(root)).map((f) => f.rule);
    assert.ok(rules.includes("trader.name"));
    assert.ok(rules.includes("trader.address"));
    facts.publisher.name = 'Jane "J" Doe';
    facts.pages.baseURL = "https://example.com/app";
    const swift = legalView(facts);
    assert.match(swift, /Text\("Jane \\"J\\" Doe"\)/);
    assert.match(swift, /https:\/\/example.com\/app\/privacy\//);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("shared Impressum URL: no per-app Impressum page, links point to it", () => {
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    const facts = factsFromScan(scan(root), { country: "DE", email: "a@b.c", brand: "Studio" });
    facts.pages.baseURL = "https://studio.example/app/";
    facts.pages.impressumURL = "https://studio.example/impressum/";
    const pages = renderPages(facts);
    assert.deepEqual(pages.map((p) => p.file), ["privacy.md", "support.md"]);
    assert.match(pages[0]!.markdown, /\(https:\/\/studio\.example\/impressum\/\)/);
    assert.match(legalView(facts), /"https:\/\/studio\.example\/impressum\/"/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("in-app Impressum: a link to impressumURL counts", () => {
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    const facts = factsFromScan(scan(root), { country: "DE", email: "a@b.c" });
    facts.pages.baseURL = "https://studio.example/app/";
    facts.pages.impressumURL = "https://studio.example/impressum/";
    assert.ok(check(facts, scan(root)).some((f) => f.rule === "impressum.inApp"));
    writeFileSync(join(root, "App/Settings.swift"), 'Link(destination: URL(string: "https://studio.example/impressum/")!) { Text("Impressum") }');
    assert.deepEqual(check(facts, scan(root)).map((f) => f.rule), ["all"]);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("DE/AT traders: second contact, register details for companies, LegalView required", () => {
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    const facts = factsFromScan(scan(root), { country: "DE", email: "hi@studio.example", brand: "Studio", trader: true, name: "Studio" });
    Object.assign(facts.publisher, { legalForm: "UG (haftungsbeschränkt)", address: { street: "Musterstr. 1", city: "10115 Berlin", country: "Deutschland" } });
    facts.pages.baseURL = "https://studio.example/app/";
    facts.pages.impressumURL = "https://studio.example/impressum/";
    writeFileSync(join(root, "App/Settings.swift"), 'Link(destination: URL(string: "https://studio.example/impressum/")!) { Text("Impressum") }');

    const errors = (f = facts) => check(f, scan(root)).filter((x) => x.level === "error").map((x) => x.rule).sort();
    assert.deepEqual(errors(), ["impressum.legalView", "trader.contact", "trader.register", "trader.representative"]);
    assert.ok(check(facts, scan(root)).some((x) => x.rule === "trader.vatId" && x.level === "warn"));

    Object.assign(facts.publisher, {
      phone: "+49 30 1234567",
      vatId: "DE123456789",
      representative: "Jane Doe",
      register: { court: "Amtsgericht Berlin-Charlottenburg", number: "HRB 123456 B" },
    });
    writeFileSync(join(root, "App/LegalView.swift"), legalView(facts));
    assert.deepEqual(errors(), []);

    const lv = legalView(facts);
    for (const s of ["Studio UG (haftungsbeschränkt)", "Vertreten durch: Jane Doe", "Telefon: +49 30 1234567", "Registernummer: HRB 123456 B", "USt-IdNr./W-IdNr.: DE123456789"]) {
      assert.ok(lv.includes(s), `LegalView missing ${s}`);
    }
    facts.pages.impressumURL = undefined;
    const page = renderPages(facts).find((p) => p.file === "impressum.md")!.markdown;
    assert.match(page, /Registergericht: Amtsgericht Berlin-Charlottenburg/);
    assert.match(page, /Verantwortlich für den Inhalt\n\nJane Doe/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("sole trader needs no register details", () => {
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    const facts = factsFromScan(scan(root), { country: "AT", email: "a@b.c", trader: true, name: "Max Muster" });
    Object.assign(facts.publisher, { phone: "+43 1 234", address: { street: "Gasse 1", city: "1010 Wien", country: "Österreich" } });
    facts.pages.baseURL = "https://x.example/app/";
    writeFileSync(join(root, "App/LegalView.swift"), legalView(facts));
    const errs = check(facts, scan(root)).filter((x) => x.level === "error");
    assert.deepEqual(errs, []);
    assert.match(renderPages(facts).find((p) => p.file === "impressum.md")!.markdown, /Angaben gemäß § 5 ECG/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("migrate v1 → v2 keeps comments and values, adds new fields", async () => {
  const { migrateText, CURRENT_VERSION, NewerSchemaError } = await import("../src/index.js");
  const v1 = `# my notes stay
version: 1
app:
  name: kipple
  bundleIdentifiers: [com.example.app]
publisher:
  brand: Half Batch # studio
  name: ""
  country: DE
  email: hi@example.com
  trader: true
  address: { street: "", city: "", country: "" }
data: { tracking: false, collected: [], accessedAPIs: [], packages: [] }
privacyNotes: []
support:
  replyTime: within a day
pages: { baseURL: "https://example.com/app/", policyUpdated: "2026-11-01" }
`;
  const r = migrateText(v1);
  assert.equal(r.from, 1);
  assert.equal(r.to, CURRENT_VERSION);
  const out = r.doc.toString();
  assert.match(out, /# my notes stay/);
  assert.match(out, /brand: Half Batch # studio/);
  assert.match(out, /replyTime: within a day/);
  const js = r.doc.toJS();
  assert.equal(js.version, 2);
  assert.equal(js.publisher.voice, "we");
  assert.deepEqual(js.support.faq, []);
  assert.equal(js.publisher.vatId, "", "DE trader gets explicit Impressum fields");
  assert.ok(r.notes.some((n) => n.includes("publisher.voice")));

  assert.equal(migrateText(out).notes.length, 0, "migrating twice is a no-op");
  const flat = migrateText("version: 1\napp:\n  name: x\n  bundleIdentifiers:\n  - a\n  - b\npublisher:\n  country: US\n").text;
  assert.match(flat, /bundleIdentifiers:\n  - a\n  - b/, "keeps unindented lists");
  assert.match(r.text, /bundleIdentifiers: \[ ?com\.example\.app ?\]/, "keeps flow lists");
  assert.throws(() => migrateText(v1.replace("version: 1", "version: 99")), NewerSchemaError);
});

test("voice I changes first-person wording; check flags old schema and unknown keys", async () => {
  const root = fixture(crashManifest);
  try {
    const facts = factsFromScan(scan(root), { country: "US", email: "a@b.c", voice: "I" });
    facts.support.askFor = "your iPhone model and iOS version";
    const [privacy, support] = renderPages(facts);
    assert.match(support!.markdown, /I usually reply/);
    assert.match(support!.markdown, /Please include your iPhone model and iOS version/);
    assert.match(privacy!.markdown, /## Data I collect/);
    assert.match(privacy!.markdown, /Contact me below/);
    assert.doesNotMatch(privacy!.markdown + support!.markdown, /\b(we|We|us|our)\b/);

    facts.pages.baseURL = "https://x.example/";
    const rules = (f: typeof facts, v?: number) => check(f, scan(root), v ? { fileVersion: v } : {}).map((x) => x.rule);
    assert.ok(rules(facts, 1).includes("config.outdated"));
    (facts as unknown as Record<string, unknown>).suport = {};
    assert.ok(rules(facts).includes("config.unknownKey"));
    delete (facts as unknown as Record<string, unknown>).suport;
    (facts.publisher as { voice: string }).voice = "us";
    assert.ok(rules(facts).includes("config.voice"));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("Podfile.lock and Cartfile.resolved count as packages; tagline, no-SDK line, website section", async () => {
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    let facts = factsFromScan(scan(root), { country: "US", email: "a@b.c", brand: "Studio" });
    facts.app.name = "Tasks";
    facts.app.tagline = "a plain-text task planner";
    facts.pages.sitePrivacyURL = "/privacy/";
    const md = renderPages(facts)[0]!.markdown;
    assert.match(md, /Tasks is a plain-text task planner, made by Studio\./);
    assert.match(md, /contains no third-party SDKs/);
    assert.match(md, /## This website\n\nFor the website itself, see the \[website privacy notice\]\(\/privacy\/\)/);

    writeFileSync(join(root, "Podfile.lock"), "PODS:\n  - Firebase/Analytics (10.0.0):\n    - FirebaseAnalytics\n  - FirebaseAnalytics (10.0.0)\n\nDEPENDENCIES:\n  - Firebase/Analytics\n");
    writeFileSync(join(root, "Cartfile.resolved"), 'github "Alamofire/Alamofire" "5.8.0"\n');
    const pkgs = scan(root).packages.map((p) => p.identity);
    assert.deepEqual(pkgs, ["alamofire", "firebase", "firebaseanalytics"]);
    facts = factsFromScan(scan(root), { country: "US", email: "a@b.c" });
    assert.doesNotMatch(renderPages(facts)[0]!.markdown, /no third-party SDKs/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("check --online: dead URL, stale page, up-to-date page", async () => {
  const { checkOnline } = await import("../src/index.js");
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    const facts = factsFromScan(scan(root), { country: "DE", email: "hi@studio.example", brand: "Studio" });
    facts.app.name = "kipple";
    facts.pages.baseURL = "https://studio.example/kipple/";
    facts.pages.impressumURL = "https://studio.example/impressum/";
    facts.pages.policyUpdated = "2026-11-17";
    facts.support.faq = [{ q: "What's kipple?", a: "x" }, { q: "Does `kipple` work on iPad?", a: "y" }];

    const site: Record<string, string> = {
      "https://studio.example/kipple/privacy/": "<h1>kipple privacy policy</h1><p><em>Last updated: 2026-11-17</em></p>",
      // Jekyll turns ' into ’ and `code` into <code>; only one FAQ deployed
      "https://studio.example/kipple/support/": "<p>email hi@studio.example</p><p><strong>What&rsquo;s kipple?</strong></p>",
    };
    const fake = async (url: string) => ({ ok: url in site, status: url in site ? 200 : 404, url, text: async () => site[url] ?? "" });

    const f = await checkOnline(facts, fake);
    const byRule = Object.fromEntries(f.map((x) => [x.rule, x.level]));
    assert.equal(byRule["online.privacy"], "ok");
    assert.equal(byRule["online.impressum"], "error", "404");
    assert.equal(byRule["online.support.stale"], "warn");
    assert.match(f.find((x) => x.rule === "online.support.stale")!.message, /work on iPad\?/);

    site["https://studio.example/kipple/support/"] += "<p><strong>Does <code>kipple</code> work on iPad?</strong></p>";
    site["https://studio.example/impressum/"] = "<p>Kontakt: hi@studio.example</p>";
    assert.deepEqual((await checkOnline(facts, fake)).map((x) => x.level), ["ok", "ok", "ok"]);

    const slow = () => new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 5));
    assert.match((await checkOnline(facts, slow, 1))[0]!.message, /unreachable/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("checklist: automatic items, manual ticks stored in the YAML, markdown", async () => {
  const { checklist, checklistMarkdown, setTicks, factsToYAML, readFacts } = await import("../src/index.js");
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] });
  try {
    mkdirSync(join(root, "App.xcodeproj"));
    writeFileSync(join(root, "App.xcodeproj/project.pbxproj"), "\t\tINFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;\n");
    const facts = factsFromScan(scan(root), { country: "US", email: "a@b.c" });
    facts.app.name = "Tasks";
    facts.pages.baseURL = "https://x.example/tasks/";
    const yamlPath = join(root, "shelfready.yaml");
    writeFileSync(yamlPath, "# keep me\n" + factsToYAML(facts));

    const rows = () => {
      const { facts: f } = readFacts(yamlPath);
      const s = scan(root);
      return checklist({ facts: f, scan: s, findings: check(f, s) });
    };
    const status = (id: string) => rows().find((r) => r.id === id)?.status;
    assert.equal(status("export-compliance"), "done");
    assert.equal(status("privacy-manifest"), "done");
    assert.equal(status("privacy-page"), "unchecked", "needs --online");
    assert.equal(status("trademark"), "todo");
    assert.equal(rows().find((r) => r.id === "impressum-page"), undefined, "US: no Impressum items");

    writeFileSync(yamlPath, setTicks(yamlPath, ["trademark", "submitted"], true, "2026-11-18"));
    assert.equal(status("trademark"), "done");
    assert.match(readFileSync(yamlPath, "utf8"), /# keep me/);
    assert.match(readFileSync(yamlPath, "utf8"), /trademark: 2026-11-18/);
    writeFileSync(yamlPath, setTicks(yamlPath, ["trademark"], false));
    assert.equal(status("trademark"), "todo");
    assert.throws(() => setTicks(yamlPath, ["no-drift"], true), /checked automatically/);
    assert.throws(() => setTicks(yamlPath, ["nope"], true), /Unknown checklist item/);

    const md = checklistMarkdown(rows(), "Tasks");
    assert.match(md, /- \[x\] \*\*Submitted for App Review\*\* \(ticked 2026-11-18\) `submitted`/);
    assert.match(md, /- \[ \] \*\*Trademark search for the app name\*\*: Search "Tasks"/);
    assert.match(md, /Privacy policy URL: https:\/\/x\.example\/tasks\/privacy\//);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("knowledge base: SDK data flows into facts, policy and check", async () => {
  const { knowledgeBase, lookup } = await import("../src/index.js");
  assert.ok(knowledgeBase().length >= 20, "bundled entries");
  assert.equal(lookup("sentry")?.identity, "sentry-cocoa", "CocoaPods alias");
  const root = fixture({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [], NSPrivacyAccessedAPITypes: [] }, (r) =>
    writeFileSync(
      join(r, "Package.resolved"),
      JSON.stringify({
        version: 2,
        pins: [
          { identity: "sentry-cocoa", location: "https://github.com/getsentry/sentry-cocoa", state: { version: "8.0.0" } },
          { identity: "mixpanel-swift", location: "https://github.com/mixpanel/mixpanel-swift", state: { version: "4.0.0" } },
          { identity: "alamofire", location: "https://github.com/Alamofire/Alamofire", state: { version: "5.9.0" } },
          { identity: "some-unknown-sdk", location: "https://example.com/x", state: { version: "1.0.0" } },
        ],
      }),
    ),
  );
  try {
    const facts = factsFromScan(scan(root), { country: "US", email: "a@b.c", brand: "Studio" });
    assert.ok(facts.data.collected.some((c) => c.type === "NSPrivacyCollectedDataTypeCrashData"), "Sentry's crash data is included");
    const policy = renderPages(facts)[0]!.markdown;
    assert.match(policy, /## Third-party services/);
    assert.match(policy, /\*\*Sentry\*\* \(Functional Software, Inc\. \(Sentry\)\): crash data/);
    assert.doesNotMatch(policy, /Alamofire/, "SDKs that collect nothing aren't listed");
    assert.doesNotMatch(policy, /no third-party SDKs/);
    facts.pages.baseURL = "https://x.example/";
    const rules = check(facts, scan(root)).map((f) => `${f.level}:${f.rule}`);
    assert.ok(rules.includes("warn:sdk.unknown"));
    assert.ok(rules.includes("warn:sdk.yourData"), "Mixpanel declares nothing: your events");
    assert.ok(!rules.some((r) => r.startsWith("error:")));
  } finally {
    rmSync(root, { recursive: true });
  }
});
