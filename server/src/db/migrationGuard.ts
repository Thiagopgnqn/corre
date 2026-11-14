import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface JournalEntry {
  idx: number;
  version?: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

export interface LocalMigrationEntry extends JournalEntry {
  hash: string;
}

export interface AppliedMigrationRow {
  id?: number;
  hash: string | null;
  created_at: number | string | bigint;
}

export interface MissingMigration {
  idx: number;
  tag: string;
  when: number;
}

export interface MigrationHashMismatch {
  idx: number;
  tag: string;
  when: number;
  expectedHash: string;
  actualHash: string;
}

/**
 * Validates statically that journal entries have finite, strictly increasing `when` timestamps
 * in array order so `drizzle-orm`'s `created_at < folderMillis` check never skips new migrations.
 */
export function assertJournalStrictlyIncreasing(entries: readonly JournalEntry[]): void {
  let prev: JournalEntry | null = null;

  for (const entry of entries) {
    if (typeof entry.when !== 'number' || !Number.isFinite(entry.when)) {
      throw new Error(
        `Entrada inválida en _journal.json: idx=${entry.idx} tag=${entry.tag} tiene "when" inválido (${String(entry.when)}).`
      );
    }

    if (prev !== null && entry.when <= prev.when) {
      throw new Error(
        `El journal de migraciones no es estrictamente creciente en "when": ` +
          `idx=${entry.idx} tag=${entry.tag} when=${entry.when} <= anterior idx=${prev.idx} tag=${prev.tag} when=${prev.when}.`
      );
    }

    prev = entry;
  }
}

/**
 * Computes which journal entries are not yet recorded in `drizzle.__drizzle_migrations`
 * by matching each expected `when` against `Number(row.created_at)`.
 * Extra DB rows are ignored without failing.
 */
export function findMissingMigrations(
  entries: readonly JournalEntry[],
  dbRows: readonly AppliedMigrationRow[]
): MissingMigration[] {
  const registeredTimestamps = new Set<number>();

  for (const row of dbRows) {
    const ts = Number(row.created_at);
    if (Number.isFinite(ts)) {
      registeredTimestamps.add(ts);
    }
  }

  return entries
    .filter((entry) => !registeredTimestamps.has(entry.when))
    .map(({ idx, tag, when }) => ({ idx, tag, when }));
}

/**
 * Finds already-applied migrations (matched by `when` / `created_at`) whose stored hash
 * differs from the local SQL file hash. Used for non-fatal warnings only.
 */
export function findMigrationHashMismatches(
  entries: readonly LocalMigrationEntry[],
  dbRows: readonly AppliedMigrationRow[]
): MigrationHashMismatch[] {
  const hashByCreatedAt = new Map<number, string>();

  for (const row of dbRows) {
    const ts = Number(row.created_at);
    if (Number.isFinite(ts) && typeof row.hash === 'string') {
      hashByCreatedAt.set(ts, row.hash);
    }
  }

  const mismatches: MigrationHashMismatch[] = [];
  for (const entry of entries) {
    const actualHash = hashByCreatedAt.get(entry.when);
    if (actualHash !== undefined && actualHash !== entry.hash) {
      mismatches.push({
        idx: entry.idx,
        tag: entry.tag,
        when: entry.when,
        expectedHash: entry.hash,
        actualHash,
      });
    }
  }

  return mismatches;
}

/**
 * Formats missing migrations with explicit idx, tag, and when fields.
 */
export function formatMissingMigrationsMessage(missing: readonly MissingMigration[]): string {
  const details = missing
    .map((m) => `[idx=${m.idx} tag=${m.tag} when=${m.when}]`)
    .join(', ');
  return `Faltan ${missing.length} migración(es) registrada(s) en drizzle.__drizzle_migrations: ${details}`;
}

/**
 * Verifies DB migration rows against local journal entries:
 * - Hash mismatches emit warnings via `warn` and never abort.
 * - Extra rows in DB do not fail.
 * - Any missing journal entry throws an Error listing idx, tag, and when.
 */
export function verifyMigrationState(
  entries: readonly LocalMigrationEntry[],
  dbRows: readonly AppliedMigrationRow[],
  warn: (message: string) => void = console.warn
): void {
  const hashMismatches = findMigrationHashMismatches(entries, dbRows);
  for (const mismatch of hashMismatches) {
    warn(
      `⚠️ Diferencia de hash para migración ya aplicada [idx=${mismatch.idx} tag=${mismatch.tag} when=${mismatch.when}]: DB=${mismatch.actualHash} local=${mismatch.expectedHash}`
    );
  }

  const missing = findMissingMigrations(entries, dbRows);
  if (missing.length > 0) {
    throw new Error(formatMissingMigrationsMessage(missing));
  }
}

/**
 * Reads `_journal.json` and computes the SHA-256 hash of each SQL file
 * using the exact byte/string formula of `drizzle-orm/migrator`.
 */
export function readLocalMigrationEntries(migrationsFolder: string): LocalMigrationEntry[] {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const rawJournal = fs.readFileSync(journalPath, 'utf-8');
  const parsed = JSON.parse(rawJournal) as { entries?: JournalEntry[] };
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

  return entries.map((entry) => {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const query = fs.readFileSync(sqlPath).toString();
    const hash = crypto.createHash('sha256').update(query).digest('hex');
    return {
      ...entry,
      hash,
    };
  });
}
