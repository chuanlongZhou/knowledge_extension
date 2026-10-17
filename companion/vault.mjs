import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, readdir, unlink, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  normalizeRecord,
  normalizeAttachment,
  canonical,
  metadata,
  searchText,
  toMarkdown,
  validId,
  MAX_ASSET_BYTES,
} from '../extension/lib/model.js';
import { atomicWrite, readJson, sha256, isHash, inside, assertNoSymlink } from './util.mjs';

export class Vault {
  constructor(root) {
    this.root = path.resolve(root);
  }
  async open() {
    if (this.db) return this;
    await mkdir(this.root, { recursive: true });
    await assertNoSymlink(this.root, this.root);
    for (const name of ['records', 'assets', 'readable', '.nexus/revisions', '.nexus/journal']) {
      const dir = inside(this.root, name);
      await assertNoSymlink(this.root, dir);
      await mkdir(dir, { recursive: true });
    }
    this.info = await readJson(inside(this.root, '.nexus/vault.json'), null);
    if (!this.info) {
      this.info = { format: 'pkm-nexus-vault', version: 1, id: randomUUID() };
      await atomicWrite(inside(this.root, '.nexus/vault.json'), JSON.stringify(this.info, null, 2));
    }
    if (this.info.format !== 'pkm-nexus-vault' || this.info.version !== 1)
      throw new Error('Unsupported knowledge vault format.');
    this.db = new DatabaseSync(inside(this.root, '.nexus/index.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
   CREATE TABLE IF NOT EXISTS revisions(revision TEXT PRIMARY KEY,record_id TEXT NOT NULL,body_hash TEXT NOT NULL,envelope TEXT NOT NULL,uploaded INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS revisions_record ON revisions(record_id);
   CREATE INDEX IF NOT EXISTS revisions_pending ON revisions(uploaded,record_id);
   CREATE TABLE IF NOT EXISTS edges(record_id TEXT NOT NULL,parent TEXT NOT NULL,child TEXT NOT NULL,PRIMARY KEY(parent,child));
   CREATE INDEX IF NOT EXISTS edges_record ON edges(record_id,parent);
   CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY,revision TEXT NOT NULL,title TEXT NOT NULL,type TEXT NOT NULL,updated_at TEXT NOT NULL,deleted INTEGER NOT NULL,conflict INTEGER NOT NULL,meta TEXT NOT NULL,search_text TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS catalog_updated ON catalog(updated_at DESC,id);
   CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,descriptor TEXT NOT NULL,remote_id TEXT);
  `);
    const journals = await readdir(inside(this.root, '.nexus/journal'));
    for (const file of journals.filter((f) => /^[a-f0-9]{64}\.json$/.test(f))) {
      const item = await readJson(inside(this.root, '.nexus/journal', file));
      await this.apply(item.envelope, { uploaded: item.uploaded });
    }
    if (!this.db.prepare("SELECT 1 FROM state WHERE key='initialized'").get()) await this.reindex();
    return this;
  }
  close() {
    this.db?.close();
    this.db = null;
  }
  getState(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM state WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  setState(key, value) {
    this.db
      .prepare(
        'INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  validateEnvelope(input) {
    if (
      input?.format !== 'pkm-nexus-revision' ||
      input.version !== 1 ||
      !Array.isArray(input.parents) ||
      input.parents.length > 64 ||
      input.parents.some((p) => !isHash(p))
    )
      throw new Error('Invalid record revision.');
    const record = normalizeRecord(input.record),
      parents = [...new Set(input.parents)].sort();
    const revision = sha256(canonical({ record, parents }));
    if (input.revision !== revision) throw new Error('Record revision checksum mismatch.');
    return { format: 'pkm-nexus-revision', version: 1, revision, parents, record };
  }
  heads(id) {
    return this.db
      .prepare(
        'SELECT revision FROM revisions WHERE record_id=? AND revision NOT IN(SELECT parent FROM edges WHERE record_id=?) ORDER BY revision',
      )
      .all(id, id)
      .map((r) => r.revision);
  }
  envelope(revision) {
    if (!isHash(revision)) throw new Error('Invalid revision.');
    const row = this.db.prepare('SELECT envelope FROM revisions WHERE revision=?').get(revision);
    if (!row) throw new Error('Record revision is not available.');
    return JSON.parse(row.envelope);
  }
  get(id) {
    if (!validId(id)) throw new Error('Invalid record ID.');
    const row = this.db.prepare('SELECT revision FROM catalog WHERE id=?').get(id);
    if (!row) return null;
    const head = this.envelope(row.revision);
    return {
      record: head.record,
      revision: head.revision,
      hash: sha256(canonical(head.record)),
      heads: this.heads(id),
    };
  }
  list({ query = '', view = 'all', limit = 60, offset = 0 } = {}) {
    if (typeof query !== 'string' || query.length > 2000) throw new Error('Invalid search query.');
    limit = Math.min(100, Math.max(1, Number(limit) || 60));
    offset = Math.max(0, Number(offset) || 0);
    const where = [],
      args = [];
    if (view === 'trash') where.push('deleted=1');
    else if (view === 'conflicts') where.push('conflict=1');
    else where.push('deleted=0');
    for (const term of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
      where.push("search_text LIKE ? ESCAPE '\\'");
      args.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
    }
    const condition = where.join(' AND '),
      count = this.db
        .prepare(`SELECT count(*) AS count FROM catalog WHERE ${condition}`)
        .get(...args).count;
    const rows = this.db
      .prepare(
        `SELECT meta,revision,conflict FROM catalog WHERE ${condition} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset);
    return {
      items: rows.map((r) => ({
        ...JSON.parse(r.meta),
        revision: r.revision,
        conflict: !!r.conflict,
      })),
      total: count,
      hasMore: offset + rows.length < count,
    };
  }
  changes(cursor = 0, limit = 50) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid vault cursor.');
    const rows = this.db
      .prepare('SELECT seq,record_id FROM changes WHERE seq>? ORDER BY seq LIMIT ?')
      .all(cursor, Math.min(100, limit));
    return {
      items: [...new Set(rows.map((r) => r.record_id))].map((id) => this.get(id)),
      cursor: rows.at(-1)?.seq ?? cursor,
      hasMore: rows.length === Math.min(100, limit),
    };
  }
  async put(record, { parentRevision = null, resolveParents = null } = {}) {
    record = normalizeRecord(record);
    if (
      parentRevision !== null &&
      (!isHash(parentRevision) ||
        !this.db
          .prepare('SELECT 1 FROM revisions WHERE revision=? AND record_id=?')
          .get(parentRevision, record.id))
    )
      throw new Error('The base revision is missing. Reconnect the same vault before editing.');
    const parents = resolveParents || (parentRevision ? [parentRevision] : []);
    if (resolveParents) {
      const current = this.heads(record.id);
      if (canonical([...resolveParents].sort()) !== canonical(current))
        throw new Error('The conflict changed; reload it before resolving.');
    }
    const envelope = {
      format: 'pkm-nexus-revision',
      version: 1,
      parents,
      record,
      revision: sha256(canonical({ record, parents: [...new Set(parents)].sort() })),
    };
    await this.apply(envelope);
    return { ...this.get(record.id), acceptedRevision: envelope.revision };
  }
  async apply(input, { uploaded = false } = {}) {
    const envelope = this.validateEnvelope(input),
      id = envelope.record.id;
    if (this.db.prepare('SELECT 1 FROM revisions WHERE revision=?').get(envelope.revision)) {
      if (uploaded)
        this.db.prepare('UPDATE revisions SET uploaded=1 WHERE revision=?').run(envelope.revision);
      await this.materialize(id);
      await unlink(inside(this.root, '.nexus/journal', `${envelope.revision}.json`)).catch(
        () => {},
      );
      return false;
    }
    const journal = inside(this.root, '.nexus/journal', `${envelope.revision}.json`),
      file = inside(this.root, '.nexus/revisions', id, `${envelope.revision}.json`);
    await assertNoSymlink(this.root, file);
    await assertNoSymlink(this.root, journal);
    await atomicWrite(journal, JSON.stringify({ envelope, uploaded }));
    await atomicWrite(file, JSON.stringify(envelope, null, 2));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?,?,?)')
        .run(
          envelope.revision,
          id,
          sha256(canonical(envelope.record)),
          JSON.stringify(envelope),
          uploaded ? 1 : 0,
        );
      for (const parent of envelope.parents)
        this.db
          .prepare('INSERT OR IGNORE INTO edges VALUES(?,?,?)')
          .run(id, parent, envelope.revision);
      this.refreshCatalog(id);
      this.db.prepare('INSERT INTO changes(record_id) VALUES(?)').run(id);
      for (const descriptor of envelope.record.attachments || [])
        this.db
          .prepare('INSERT INTO assets VALUES(?,?,NULL) ON CONFLICT(id) DO NOTHING')
          .run(descriptor.id, JSON.stringify(descriptor));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    await this.materialize(id);
    await unlink(journal).catch(() => {});
    return true;
  }
  refreshCatalog(id) {
    const heads = this.heads(id),
      previous = this.db.prepare('SELECT revision FROM catalog WHERE id=?').get(id);
    const revision = heads.includes(previous?.revision) ? previous.revision : heads[0];
    if (!revision) throw new Error('Revision graph has no head.');
    const record = this.envelope(revision).record,
      m = metadata(record);
    this.db
      .prepare(
        'INSERT INTO catalog VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,title=excluded.title,type=excluded.type,updated_at=excluded.updated_at,deleted=excluded.deleted,conflict=excluded.conflict,meta=excluded.meta,search_text=excluded.search_text',
      )
      .run(
        id,
        revision,
        record.title || '',
        record.type || 'tombstone',
        record.updated_at || record.deleted_at,
        record.deleted_at ? 1 : 0,
        heads.length > 1 ? 1 : 0,
        JSON.stringify(m),
        searchText(record),
      );
  }
  async materialize(id) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const item = this.get(id),
        jsonFile = inside(this.root, 'records', id.slice(0, 2), `${id}.json`),
        mdFile = inside(this.root, 'readable', `${id}.md`);
      for (const file of [jsonFile, mdFile]) await assertNoSymlink(this.root, file);
      try {
        const info = await stat(jsonFile);
        let existingHash = null;
        if (info.size <= 8 * 1024 * 1024) {
          try {
            existingHash = sha256(
              canonical(normalizeRecord(JSON.parse(await readFile(jsonFile, 'utf8')))),
            );
          } catch {
            /* Preserve unimported or malformed external edits before replacing the view. */
          }
        }
        const baseline = this.getState(`materialized:${id}`),
          known =
            existingHash &&
            this.db
              .prepare('SELECT 1 FROM revisions WHERE record_id=? AND body_hash=?')
              .get(id, existingHash);
        if (
          existingHash !== item.hash &&
          ((baseline && existingHash !== baseline) || (!baseline && !known))
        ) {
          const recovery = inside(
            this.root,
            '.nexus/recovery/external',
            `${id}-${randomUUID()}.json`,
          );
          await assertNoSymlink(this.root, recovery);
          await mkdir(path.dirname(recovery), { recursive: true });
          await copyFile(jsonFile, recovery);
          const recent = this.getState('external:recovery', []);
          this.setState(
            'external:recovery',
            [
              ...recent,
              { id, file: path.relative(this.root, recovery), at: new Date().toISOString() },
            ].slice(-100),
          );
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await atomicWrite(jsonFile, JSON.stringify(item.record, null, 2) + '\n');
      await atomicWrite(
        mdFile,
        toMarkdown(item.record).replaceAll('](assets/', '](../assets/') + '\n',
      );
      this.setState(`materialized:${id}`, item.hash);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async reindex() {
    const base = inside(this.root, '.nexus/revisions');
    for (const id of await readdir(base)) {
      if (!validId(id)) continue;
      const dir = inside(base, id);
      await assertNoSymlink(this.root, dir);
      if (!(await stat(dir)).isDirectory()) continue;
      for (const file of await readdir(dir)) {
        if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
        const envelope = this.validateEnvelope(await readJson(inside(dir, file)));
        await this.apply(envelope);
      }
    }
    for (const { id } of this.db.prepare('SELECT id FROM catalog').all())
      await this.materialize(id);
    this.setState('initialized', true);
  }
  pending(limit = 50) {
    return this.db
      .prepare('SELECT envelope FROM revisions WHERE uploaded=0 ORDER BY rowid LIMIT ?')
      .all(limit)
      .map((r) => JSON.parse(r.envelope));
  }
  acknowledge(revisions) {
    const stmt = this.db.prepare('UPDATE revisions SET uploaded=1 WHERE revision=?');
    for (const revision of revisions) stmt.run(revision);
  }
  assetInfo(descriptor) {
    descriptor = normalizeAttachment(descriptor);
    const row = this.db.prepare('SELECT remote_id FROM assets WHERE id=?').get(descriptor.id);
    return { ...descriptor, remoteId: row?.remote_id || null };
  }
  setRemoteAsset(descriptor, remoteId) {
    descriptor = normalizeAttachment(descriptor);
    if (typeof remoteId !== 'string' || !/^[\w-]{1,200}$/.test(remoteId))
      throw new Error('Invalid Drive file ID.');
    this.db
      .prepare(
        'INSERT INTO assets VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET remote_id=excluded.remote_id',
      )
      .run(descriptor.id, JSON.stringify(descriptor), remoteId);
  }
  async storeAsset(descriptor, bytes) {
    descriptor = normalizeAttachment(descriptor);
    if (
      bytes.length > MAX_ASSET_BYTES ||
      bytes.length !== descriptor.size_bytes ||
      sha256(bytes) !== descriptor.id
    )
      throw new Error('Attachment checksum or size mismatch.');
    const file = inside(this.root, descriptor.path);
    await assertNoSymlink(this.root, file);
    await atomicWrite(file, bytes);
    this.db
      .prepare('INSERT INTO assets VALUES(?,?,NULL) ON CONFLICT(id) DO NOTHING')
      .run(descriptor.id, JSON.stringify(descriptor));
  }
  async assetBytes(descriptor) {
    descriptor = normalizeAttachment(descriptor);
    const file = inside(this.root, descriptor.path);
    await assertNoSymlink(this.root, file);
    try {
      if ((await stat(file)).size !== descriptor.size_bytes)
        throw new Error('Local attachment has an invalid size.');
      const bytes = await readFile(file);
      if (bytes.length !== descriptor.size_bytes || sha256(bytes) !== descriptor.id)
        throw new Error('Local attachment is corrupt.');
      return bytes;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async externalEdits() {
    let imported = 0,
      lastId = '';
    for (;;) {
      const rows = this.db
        .prepare('SELECT id,revision FROM catalog WHERE id>? ORDER BY id LIMIT 100')
        .all(lastId);
      if (!rows.length) break;
      for (const row of rows) {
        const file = inside(this.root, 'records', row.id.slice(0, 2), `${row.id}.json`);
        await assertNoSymlink(this.root, file);
        if ((await stat(file)).size > 8 * 1024 * 1024)
          throw new Error('External record exceeds the supported size. The file was preserved.');
        const record = normalizeRecord(await readJson(file));
        if (record.id !== row.id) throw new Error('External edit changed a record ID.');
        if (sha256(canonical(record)) === this.get(row.id).hash) continue;
        if (this.heads(row.id).length > 1)
          throw new Error(`Resolve the conflict for ${row.id} before importing external edits.`);
        await this.put(record, { parentRevision: row.revision });
        imported++;
      }
      lastId = rows.at(-1).id;
    }
    return imported;
  }
}
