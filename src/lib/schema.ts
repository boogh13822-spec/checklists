/** Additive, administrator-approved upgrade of the EXISTING D1; no seed or destructive SQL. */
import { sign, verify } from 'hono/jwt';
import { SCHEMA_TABLES, SCHEMA_INDEXES } from './schema-manifest';
import { logAdminAction } from './db';

export const SCHEMA_VERSION = 'site-recovery-v4';
type Step = { key: string; sql: string; baseline?: boolean; blocked?: boolean };
export type SchemaStatus = { ready: boolean; pending: Step[]; blocked: string[] };
const readyCache = new WeakMap<D1Database, number>();
const controlRows = [
  { table: 'fallback_dispatch', key: 'state:fallback_dispatch', condition: 'id=1', sql: 'INSERT OR IGNORE INTO fallback_dispatch(id,until_ms) VALUES(1,0)' },
  { table: 'fallback_channel_limits', key: 'state:telegram', condition: "channel='telegram'", sql: "INSERT OR IGNORE INTO fallback_channel_limits(channel,until_ms) VALUES('telegram',0)" },
  { table: 'fallback_channel_limits', key: 'state:bale', condition: "channel='bale'", sql: "INSERT OR IGNORE INTO fallback_channel_limits(channel,until_ms) VALUES('bale',0)" },
];
export function invalidateSchemaCache(db: D1Database): void { readyCache.delete(db); }

/** One inventory read plus one control-row read; cached only when fully ready. */
export async function schemaStatus(db: D1Database, fresh = false): Promise<SchemaStatus> {
  if (!fresh && (readyCache.get(db) ?? 0) > Date.now()) return { ready: true, pending: [], blocked: [] };
  const names = SCHEMA_TABLES.map(t => t.name);
  const indexes = SCHEMA_INDEXES.map(i => i.name);
  const result = await db.prepare(`
    SELECT 'column' AS kind, m.name AS table_name, p.name AS name
    FROM sqlite_master m JOIN pragma_table_info(m.name) p
    WHERE m.type = 'table' AND m.name IN (${names.map(() => '?').join(',')})
    UNION ALL SELECT 'index' AS kind, tbl_name AS table_name, name
    FROM sqlite_master WHERE type = 'index' AND name IN (${indexes.map(() => '?').join(',')})
  `).bind(...names, ...indexes).all<{ kind: string; table_name: string; name: string }>();
  const columns = new Map<string, Set<string>>();
  const foundIndexes = new Set<string>();
  for (const row of result.results ?? []) {
    if (row.kind === 'index') { foundIndexes.add(row.name); continue; }
    const table = row.table_name.toLowerCase();
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table)!.add(row.name.toLowerCase());
  }
  const pending: Step[] = [];
  // A missing audit table is created FIRST so subsequent additions are traceable.
  const tables = [...SCHEMA_TABLES].sort((a, b) => Number(b.name === 'admin_logs') - Number(a.name === 'admin_logs'));
  for (const table of tables) {
    if (!columns.has(table.name)) {
      // Never silently create a replacement identity/config DB after a bad binding.
      pending.push({ key: 'table:' + table.name, sql: table.sql, blocked: table.name === 'users' || table.name === 'settings' });
      continue;
    }
    for (const col of table.columns) {
      if (columns.get(table.name)!.has(col.name)) continue;
      const definition = col.definition.replace(/\s+UNIQUE\b/i, '');
      // Historical timestamps/required identities cannot safely be fabricated by ALTER.
      const blocked = /PRIMARY KEY|DEFAULT\s*\(|REFERENCES/i.test(definition) || (/NOT NULL/i.test(definition) && !/DEFAULT\b/i.test(definition));
      pending.push({ key: 'column:' + table.name + '.' + col.name,
        sql: `ALTER TABLE ${table.name} ADD COLUMN ${col.name} ${definition}`,
        blocked, baseline: table.name === 'users' && col.name === 'lifetime_points' });
    }
  }
  // Operational lease/cooldown rows are NOT demo users or configuration defaults.
  // OR IGNORE preserves existing leases and rate limits; never resets an active dispatcher.
  const presentStates = controlRows.filter(row => columns.get(row.table)?.has(row.table === 'fallback_dispatch' ? 'id' : 'channel'));
  const foundStates = presentStates.length ? await db.prepare(presentStates.map(row =>
    `SELECT '${row.key}' AS key, EXISTS(SELECT 1 FROM ${row.table} WHERE ${row.condition}) AS present`
  ).join(' UNION ALL ')).all<{ key: string; present: number }>() : { results: [] };
  const activeStates = new Set((foundStates.results ?? []).filter(r => r.present).map(r => r.key));
  for (const row of controlRows) if (!activeStates.has(row.key)) pending.push({ key: row.key, sql: row.sql });
  for (const index of SCHEMA_INDEXES) if (!foundIndexes.has(index.name)) pending.push({ key: 'index:' + index.name, sql: index.sql });
  const status = { ready: pending.length === 0, pending, blocked: pending.filter(s => s.blocked).map(s => s.key) };
  if (status.ready) readyCache.set(db, Date.now() + 30_000);
  else readyCache.delete(db);
  return status;
}

/** Four steps/request; even an old DB stays below D1 Free's 50-query ceiling. */
export async function applySchemaSteps(db: D1Database, actor: { uid: number; name: string }): Promise<SchemaStatus> {
  invalidateSchemaCache(db);
  const status = await schemaStatus(db, true);
  if (status.blocked.length) throw new Error('SCHEMA_MANUAL_REVIEW_REQUIRED');
  for (const step of status.pending.slice(0, 4)) {
    try {
      if (step.baseline) {
        // ALTER+baseline either BOTH commit, or BOTH roll back. Never rewrite an existing column.
        await db.batch([
          db.prepare(step.sql),
          db.prepare('UPDATE users SET lifetime_points = MAX(0, COALESCE(points, 0))'),
        ]);
      } else await db.prepare(step.sql).run();
    } catch (error) {
      // A concurrent administrator may have added exactly this column. Other errors remain fatal.
      const name = step.key.startsWith('column:') ? step.key.split('.').pop()! : '';
      if (!name || !new RegExp('duplicate column name:\\s*' + name + '\\b', 'i').test(String(error))) throw error;
    }
    console.info('SCHEMA_ADDITIVE_UPGRADE', step.key);
    await logAdminAction(db, { adminId: actor.uid, adminName: actor.name, action: 'database_upgrade',
      targetType: 'schema', targetId: step.key, details: 'افزودن سازگار ساختار: ' + step.key });
  }
  invalidateSchemaCache(db);
  return schemaStatus(db, true);
}

/** Full bounded snapshot, NOT the redacted customer export. Secrets exist only in the private download. */
export async function upgradeBackup(db: D1Database): Promise<string> {
  const schema = await db.prepare(`SELECT type, name, sql FROM sqlite_master
    WHERE type IN ('table','index','trigger','view') AND substr(name,1,7) <> 'sqlite_'
    AND substr(name,1,4) <> '_cf_' AND sql IS NOT NULL ORDER BY type, name`).all<{ type: string; name: string; sql: string }>();
  const tables = (schema.results ?? []).filter(s => s.type === 'table');
  if (!tables.some(t => t.name === 'users') || !tables.some(t => t.name === 'settings')) throw new Error('BACKUP_CORE_TABLE_MISSING');
  if (tables.length > 24) throw new Error('BACKUP_TOO_LARGE');
  const data: Record<string, unknown[]> = {};
  let bytes = 0;
  for (const table of tables) {
    const identifier = '"' + table.name.replace(/"/g, '""') + '"';
    const rows = await db.prepare(`SELECT * FROM ${identifier} LIMIT 20001`).all<Record<string, unknown>>();
    if ((rows.results?.length ?? 0) > 20000) throw new Error('BACKUP_TOO_LARGE');
    data[table.name] = rows.results ?? [];
    bytes += new TextEncoder().encode(JSON.stringify(data[table.name])).byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
  }
  const sequences = tables.some(t => /AUTOINCREMENT/i.test(t.sql))
    ? (await db.prepare('SELECT name, seq FROM sqlite_sequence').all()).results ?? [] : [];
  return JSON.stringify({ app: 'cafe-club', format: 'private-upgrade-snapshot-v1', version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(), consistency: 'application writes blocked while schema is incomplete; use D1 Time Travel for a point-in-time backup',
    schema: schema.results ?? [], sequences, data });
}

/** Not an auth token: administrator session is ALSO mandatory; never put this receipt in a URL. */
export async function backupReceipt(secret: string, uid: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ aud: 'schema-backup', uid, version: SCHEMA_VERSION, iat: now, exp: now + 900 }, secret, 'HS256');
}
export async function verifyBackupReceipt(secret: string, uid: number, receipt: unknown): Promise<boolean> {
  if (typeof receipt !== 'string' || receipt.length > 2048) return false;
  try {
    const p = await verify(receipt, secret, { alg: 'HS256', aud: 'schema-backup' });
    return p.uid === uid && p.version === SCHEMA_VERSION;
  } catch { return false; }
}

export function isSchemaError(error: unknown): boolean {
  return /no such (?:table|column)|has no column named|database schema has changed/i.test(String(error));
}
