import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { CollectedDataType } from "./scan.js";

/**
 * What a third-party SDK collects, taken from the SDK's own privacy manifest.
 * One entry per Swift package identity (also matched by CocoaPods/Carthage aliases).
 */
export interface KnowledgeEntry {
  identity: string;
  aliases?: string[];
  name: string;
  vendor: string;
  repository: string;
  commit: string;
  checked: string;
  basis: string;
  products: {
    name: string;
    sources: string[];
    tracking: boolean;
    trackingDomains: string[];
    collects: CollectedDataType[];
  }[];
  notes?: string;
}

let cache: KnowledgeEntry[] | undefined;

/** The bundled knowledge base (knowledge/sdks/*.yaml next to the package). */
export function knowledgeBase(dir = join(dirname(fileURLToPath(import.meta.url)), "../../knowledge/sdks")): KnowledgeEntry[] {
  if (cache && arguments.length === 0) return cache;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return [];
  }
  const entries = files.map((f) => parse(readFileSync(join(dir, f), "utf8")) as KnowledgeEntry);
  if (arguments.length === 0) cache = entries;
  return entries;
}

export function lookup(identity: string, kb = knowledgeBase()): KnowledgeEntry | undefined {
  const id = identity.toLowerCase();
  return kb.find((e) => e.identity === id || e.aliases?.includes(id));
}

/** Everything an SDK may collect across its products, deduplicated. */
export function sdkCollects(entry: KnowledgeEntry): CollectedDataType[] {
  const out: CollectedDataType[] = [];
  for (const c of entry.products.flatMap((p) => p.collects)) {
    if (!out.some((o) => JSON.stringify(o) === JSON.stringify(c))) out.push(c);
  }
  return out;
}

export const sdkTracks = (entry: KnowledgeEntry) => entry.products.some((p) => p.tracking);
