import { readFileSync } from "node:fs";
import { parseDocument, type Document } from "yaml";

/**
 * Schema versions of shelfready.yaml.
 *
 * When the shelf library changes the file format, add a migration here and bump CURRENT_VERSION.
 * Migrations edit the YAML document in place, so the developer's comments, order and wording survive.
 * `shelf migrate` writes the result; every other command migrates in memory and warns.
 */
export const CURRENT_VERSION = 2;

interface Migration {
  to: number;
  summary: string;
  /** Edits the document and returns one note per change, for the developer to review. */
  apply(doc: Document): string[];
}

const setIfMissing = (doc: Document, path: string[], value: unknown, note: string, notes: string[]) => {
  if (!doc.hasIn(path)) {
    doc.setIn(path, doc.createNode(value));
    notes.push(note);
  }
};

const MIGRATIONS: Migration[] = [
  {
    to: 2,
    summary: "Voice (I/we), support.askFor, explicit DE/AT trader fields",
    apply(doc) {
      const notes: string[] = [];
      setIfMissing(doc, ["publisher", "voice"], "we", 'publisher.voice: "we". Set it to "I" if you work alone.', notes);
      setIfMissing(doc, ["support", "faq"], [], "support.faq: []. Add the questions from your current support page.", notes);
      setIfMissing(
        doc,
        ["support", "askFor"],
        "your device model and iOS version",
        'support.askFor: what bug reports should include, e.g. "your iPhone model and iOS version".',
        notes,
      );
      const country = String(doc.getIn(["publisher", "country"]) ?? "").toUpperCase();
      if (doc.getIn(["publisher", "trader"]) === true && (country === "DE" || country === "AT")) {
        for (const field of ["phone", "contactURL", "vatId", "legalForm", "representative"]) {
          setIfMissing(doc, ["publisher", field], "", `publisher.${field}: "" (Impressum detail for DE/AT traders).`, notes);
        }
        setIfMissing(doc, ["publisher", "register"], { court: "", number: "" }, "publisher.register: court and number for companies.", notes);
      }
      return notes;
    },
  },
];

export interface MigrationResult {
  doc: Document;
  from: number;
  to: number;
  notes: string[];
  /** The migrated file, in the original's list style so the diff shows only real changes. */
  text: string;
}

/** True if block lists are indented under their key (`key:\n  - x`), false for `key:\n- x`. */
export function usesIndentedLists(text: string): boolean {
  const m = /^( *)[^\s#-][^:\n]*:\s*\n( *)- /m.exec(text);
  return m ? m[2]!.length > m[1]!.length : true;
}

export class NewerSchemaError extends Error {}

/** Parse shelfready.yaml text and bring it up to CURRENT_VERSION without touching the file. */
export function migrateText(text: string, source = "shelfready.yaml"): MigrationResult {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`${source}: ${doc.errors[0]!.message}`);
  const from = Number(doc.get("version"));
  if (!Number.isInteger(from) || from < 1) throw new Error(`${source}: missing or invalid version`);
  if (from > CURRENT_VERSION) {
    throw new NewerSchemaError(`${source} uses schema version ${from}, but this shelf only knows up to ${CURRENT_VERSION}. Update shelf.`);
  }
  const notes: string[] = [];
  for (const m of MIGRATIONS.filter((m) => m.to > from).sort((a, b) => a.to - b.to)) {
    const changes = m.apply(doc);
    doc.set("version", m.to);
    notes.push(`v${m.to}: ${m.summary}`, ...changes.map((c) => `  - ${c}`));
  }
  const text2 = from === CURRENT_VERSION ? text : doc.toString({ lineWidth: 100, indentSeq: usesIndentedLists(text) });
  return { doc, from, to: CURRENT_VERSION, notes, text: text2 };
}

export function migrateFile(path: string): MigrationResult {
  return migrateText(readFileSync(path, "utf8"), path);
}
