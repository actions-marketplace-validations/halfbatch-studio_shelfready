import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parsePlist, parseBinary } from "plist";

/** What `shelf scan` finds in an app repository. Everything comes from files on disk. */
export interface ScanResult {
  root: string;
  xcodeProjects: string[];
  bundleIdentifiers: string[];
  displayNames: string[];
  /** Purpose strings (e.g. NSCameraUsageDescription) from Info.plist files and build settings. */
  purposeStrings: Record<string, string>;
  privacyManifests: PrivacyManifest[];
  packages: ResolvedPackage[];
  /** ITSAppUsesNonExemptEncryption from Info.plist or build settings; undefined if not declared. */
  usesNonExemptEncryption?: boolean;
}

export interface PrivacyManifest {
  path: string;
  tracking: boolean;
  trackingDomains: string[];
  collectedDataTypes: CollectedDataType[];
  accessedAPIs: AccessedAPI[];
}

export interface CollectedDataType {
  type: string;
  linked: boolean;
  tracking: boolean;
  purposes: string[];
}

export interface AccessedAPI {
  category: string;
  reasons: string[];
}

export interface ResolvedPackage {
  identity: string;
  location: string;
  version?: string;
}

/** Folders that never hold source of truth. */
const SKIPPED = new Set([".git", ".build", "build", "DerivedData", "Pods", "Carthage", "node_modules", ".swiftpm"]);

type Dict = Record<string, unknown>;

export function scan(rootPath: string): ScanResult {
  const root = resolve(rootPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Not a directory: ${rootPath}`);

  const result: ScanResult = {
    root,
    xcodeProjects: [],
    bundleIdentifiers: [],
    displayNames: [],
    purposeStrings: {},
    privacyManifests: [],
    packages: [],
  };
  const bundleIDs = new Set<string>();
  const names = new Set<string>();
  const seenPackages = new Set<string>();

  for (const file of walk(root)) {
    const name = file.split("/").pop() ?? "";
    const rel = relative(root, file);

    if (name.endsWith(".xcodeproj")) {
      result.xcodeProjects.push(rel);
      const pbx = join(file, "project.pbxproj");
      if (existsSync(pbx)) {
        const settings = parseBuildSettings(readFileSync(pbx, "utf8"));
        settings.bundleIdentifiers.forEach((id) => bundleIDs.add(id));
        settings.displayNames.forEach((n) => names.add(n));
        for (const [k, v] of Object.entries(settings.purposeStrings)) result.purposeStrings[k] ??= v;
        if (settings.usesNonExemptEncryption !== undefined) result.usesNonExemptEncryption ||= settings.usesNonExemptEncryption;
      }
    } else if (name === "Info.plist") {
      const dict = readPlist(file);
      if (!dict) continue;
      for (const [key, value] of Object.entries(dict)) {
        if (key.endsWith("UsageDescription") && typeof value === "string") result.purposeStrings[key] = value;
      }
      const id = dict.CFBundleIdentifier;
      if (typeof id === "string" && !id.includes("$(")) bundleIDs.add(id);
      if (typeof dict.ITSAppUsesNonExemptEncryption === "boolean") result.usesNonExemptEncryption ||= dict.ITSAppUsesNonExemptEncryption;
      const display = dict.CFBundleDisplayName;
      if (typeof display === "string" && !display.includes("$(")) names.add(display);
    } else if (name === "PrivacyInfo.xcprivacy") {
      const dict = readPlist(file);
      if (dict) result.privacyManifests.push(privacyManifest(dict, rel));
    } else if (name === "Package.resolved" || name === "Podfile.lock" || name === "Cartfile.resolved") {
      const found = name === "Package.resolved" ? readResolvedPackages(file) : name === "Podfile.lock" ? readPodfileLock(file) : readCartfileResolved(file);
      for (const pkg of found) {
        if (!seenPackages.has(pkg.identity)) {
          seenPackages.add(pkg.identity);
          result.packages.push(pkg);
        }
      }
    }
  }

  result.xcodeProjects.sort();
  result.bundleIdentifiers = [...bundleIDs].sort();
  result.displayNames = [...names].sort();
  result.privacyManifests.sort((a, b) => a.path.localeCompare(b.path));
  result.packages.sort((a, b) => a.identity.localeCompare(b.identity));
  return result;
}

/** Yields files and `.xcodeproj` bundles; doesn't descend into skipped folders or bundles. */
function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".xcodeproj")) {
        yield path;
        // Package.resolved for Xcode projects lives inside the bundle.
        const resolved = join(path, "project.xcworkspace/xcshareddata/swiftpm/Package.resolved");
        if (existsSync(resolved)) yield resolved;
      } else if (!SKIPPED.has(entry.name) && !entry.name.endsWith(".xcworkspace")) {
        yield* walk(path);
      }
    } else {
      yield path;
    }
  }
}

function readPlist(file: string): Dict | undefined {
  const isDict = (v: unknown): v is Dict => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
  const bytes = readFileSync(file);
  try {
    const parsed: unknown = bytes.subarray(0, 6).toString("latin1") === "bplist" ? parseBinary(bytes) : parsePlist(bytes.toString("utf8"));
    return isDict(parsed) ? parsed : undefined;
  } catch {
    return undefined; // malformed plist
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const dicts = (v: unknown): Dict[] => (Array.isArray(v) ? v.filter((x): x is Dict => !!x && typeof x === "object") : []);

export function privacyManifest(dict: Dict, path: string): PrivacyManifest {
  return {
    path,
    tracking: dict.NSPrivacyTracking === true,
    trackingDomains: strings(dict.NSPrivacyTrackingDomains),
    collectedDataTypes: dicts(dict.NSPrivacyCollectedDataTypes).map((d) => ({
      type: typeof d.NSPrivacyCollectedDataType === "string" ? d.NSPrivacyCollectedDataType : "unknown",
      linked: d.NSPrivacyCollectedDataTypeLinked === true,
      tracking: d.NSPrivacyCollectedDataTypeTracking === true,
      purposes: strings(d.NSPrivacyCollectedDataTypePurposes),
    })),
    accessedAPIs: dicts(dict.NSPrivacyAccessedAPITypes).map((d) => ({
      category: typeof d.NSPrivacyAccessedAPIType === "string" ? d.NSPrivacyAccessedAPIType : "unknown",
      reasons: strings(d.NSPrivacyAccessedAPITypeReasons),
    })),
  };
}

/** Supports Package.resolved v1 (`object.pins`) and v2/v3 (`pins`). */
export function readResolvedPackages(file: string): ResolvedPackage[] {
  let json: Dict;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const pins = dicts(json.pins ?? (json.object as Dict | undefined)?.pins);
  return pins.flatMap((pin) => {
    const identity = typeof pin.identity === "string" ? pin.identity : typeof pin.package === "string" ? pin.package.toLowerCase() : undefined;
    if (!identity) return [];
    const location = typeof pin.location === "string" ? pin.location : typeof pin.repositoryURL === "string" ? pin.repositoryURL : "";
    const version = (pin.state as Dict | undefined)?.version;
    return [{ identity, location, ...(typeof version === "string" ? { version } : {}) }];
  });
}

/** CocoaPods: top-level entries under PODS, e.g. "  - FirebaseAnalytics (10.0.0):". */
export function readPodfileLock(file: string): ResolvedPackage[] {
  const pods: ResolvedPackage[] = [];
  let inPods = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^\S/.test(line)) inPods = line.startsWith("PODS:");
    else if (inPods) {
      const m = /^  - "?([^\s"(]+)"?(?: \(([^)]+)\))?/.exec(line);
      if (m) {
        const identity = m[1]!.split("/")[0]!.toLowerCase();
        if (!pods.some((p) => p.identity === identity)) pods.push({ identity, location: "cocoapods", ...(m[2] ? { version: m[2] } : {}) });
      }
    }
  }
  return pods;
}

/** Carthage: lines like `github "Alamofire/Alamofire" "5.8.0"`. */
export function readCartfileResolved(file: string): ResolvedPackage[] {
  return readFileSync(file, "utf8").split("\n").flatMap((line) => {
    const m = /^(github|git|binary) "([^"]+)" "([^"]+)"/.exec(line.trim());
    if (!m) return [];
    const identity = m[2]!.replace(/\.git$/, "").split("/").pop()!.toLowerCase();
    return [{ identity, location: m[2]!, version: m[3]! }];
  });
}

/**
 * Minimal reader for the build settings that matter in `project.pbxproj`.
 * Projects with GENERATE_INFOPLIST_FILE keep purpose strings here as INFOPLIST_KEY_*.
 */
export function parseBuildSettings(text: string) {
  const bundleIdentifiers = new Set<string>();
  const displayNames = new Set<string>();
  const purposeStrings: Record<string, string> = {};
  let usesNonExemptEncryption: boolean | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const eq = line.indexOf("=");
    if (eq < 0 || !line.endsWith(";")) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1, -1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!value || value.includes("$(")) continue;
    if (key === "PRODUCT_BUNDLE_IDENTIFIER") bundleIdentifiers.add(value);
    else if (key === "INFOPLIST_KEY_CFBundleDisplayName") displayNames.add(value);
    else if (key === "INFOPLIST_KEY_ITSAppUsesNonExemptEncryption") usesNonExemptEncryption = (usesNonExemptEncryption ?? false) || /^(yes|true|1)$/i.test(value);
    else if (key.startsWith("INFOPLIST_KEY_") && key.endsWith("UsageDescription")) {
      purposeStrings[key.slice("INFOPLIST_KEY_".length)] = value;
    }
  }
  return { bundleIdentifiers, displayNames, purposeStrings, usesNonExemptEncryption };
}
