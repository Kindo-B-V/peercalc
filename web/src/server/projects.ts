export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export type ProjectSummary = {
  id: string; name: string; revision: number; createdAt: string; updatedAt: string;
};
export type StoredProject = ProjectSummary & { document: unknown };
export type StoredVersion = {
  revision: number; name: string; createdAt: string; message: string; document: unknown;
};

type Statement = {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
};
export type ProjectDatabase = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
};
export type DocumentBucket = {
  put(key: string, value: string, options?: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<unknown>;
};

const summaryColumns = "p.id, p.name, p.revision, p.created_at AS createdAt, p.updated_at AS updatedAt";

export class ProjectStore {
  constructor(private db: ProjectDatabase, private bucket: DocumentBucket) {}

  private async readDocument(key: string): Promise<unknown> {
    const object = await this.bucket.get(key);
    if (!object) throw new ApiError(503, "Project document is temporarily unavailable");
    return JSON.parse(await object.text());
  }

  private async writeDocument(document: unknown): Promise<string> {
    const key = `documents/${crypto.randomUUID()}.json`;
    await this.bucket.put(key, JSON.stringify(document), { httpMetadata: { contentType: "application/json" } });
    return key;
  }

  async list(owner: string): Promise<ProjectSummary[]> {
    const { results } = await this.db.prepare(`SELECT ${summaryColumns} FROM projects p WHERE p.owner_id = ? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC, p.id`).bind(owner).all<ProjectSummary>();
    return results;
  }

  private async summary(owner: string, id: string): Promise<ProjectSummary> {
    const row = await this.db.prepare(`SELECT ${summaryColumns} FROM projects p WHERE p.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL`).bind(id, owner).first<ProjectSummary>();
    if (!row) throw new ApiError(404, "Project not found");
    return row;
  }

  async get(owner: string, id: string): Promise<StoredProject> {
    const row = await this.db.prepare(`SELECT ${summaryColumns}, v.document_key AS documentKey FROM projects p JOIN project_versions v ON v.project_id = p.id AND v.revision = p.revision WHERE p.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL`).bind(id, owner).first<ProjectSummary & { documentKey: string }>();
    if (!row) throw new ApiError(404, "Project not found");
    const { documentKey, ...summary } = row;
    return { ...summary, document: await this.readDocument(documentKey) };
  }

  async create(owner: string, name: string, document: unknown): Promise<StoredProject> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const documentKey = await this.writeDocument(document);
    // shortcut: ambiguous DB failures may leave orphan objects; reconcile unreferenced R2 keys before storage becomes significant.
    await this.db.batch([
      this.db.prepare("INSERT INTO projects (id, owner_id, name, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").bind(id, owner, name, now, now),
      this.db.prepare("INSERT INTO project_versions (project_id, revision, name, document_key, created_at, message) VALUES (?, 1, ?, ?, ?, ?)").bind(id, name, documentKey, now, "Created"),
    ]);
    return { id, name, revision: 1, createdAt: now, updatedAt: now, document };
  }

  async save(owner: string, id: string, expectedRevision: number, name: string, document: unknown, message = "Saved"): Promise<StoredProject> {
    const previous = await this.summary(owner, id);
    if (previous.revision !== expectedRevision) throw new ApiError(409, "This project has changed. Reload before saving.");
    const now = new Date().toISOString();
    const documentKey = await this.writeDocument(document);
    // D1 batches are atomic: the conditional snapshot and head update either both win or both do nothing.
    const result = await this.db.batch([
      this.db.prepare("INSERT INTO project_versions (project_id, revision, name, document_key, created_at, message) SELECT id, revision + 1, ?, ?, ?, ? FROM projects WHERE id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL").bind(name, documentKey, now, message, id, owner, expectedRevision),
      this.db.prepare("UPDATE projects SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL").bind(name, now, id, owner, expectedRevision),
    ]);
    if (result[1].meta.changes !== 1) {
      await this.bucket.delete(documentKey);
      throw new ApiError(409, "This project has changed. Reload before saving.");
    }
    return { id, name, revision: expectedRevision + 1, createdAt: previous.createdAt, updatedAt: now, document };
  }

  async versions(owner: string, id: string): Promise<Omit<StoredVersion, "document">[]> {
    await this.summary(owner, id);
    const { results } = await this.db.prepare("SELECT v.revision, v.name, v.created_at AS createdAt, v.message FROM project_versions v JOIN projects p ON p.id = v.project_id WHERE p.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL ORDER BY v.revision DESC").bind(id, owner).all<Omit<StoredVersion, "document">>();
    return results;
  }

  async version(owner: string, id: string, revision: number): Promise<StoredVersion> {
    const row = await this.db.prepare("SELECT v.revision, v.name, v.created_at AS createdAt, v.message, v.document_key AS documentKey FROM project_versions v JOIN projects p ON p.id = v.project_id WHERE p.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL AND v.revision = ?").bind(id, owner, revision).first<Omit<StoredVersion, "document"> & { documentKey: string }>();
    if (!row) throw new ApiError(404, "Version not found");
    const { documentKey, ...metadata } = row;
    return { ...metadata, document: await this.readDocument(documentKey) };
  }

  async restore(owner: string, id: string, expectedRevision: number, revision: number): Promise<StoredProject> {
    const version = await this.version(owner, id, revision);
    return this.save(owner, id, expectedRevision, version.name, version.document, `Restored version ${revision}`);
  }

  async delete(owner: string, id: string, expectedRevision: number): Promise<void> {
    const project = await this.summary(owner, id);
    if (project.revision !== expectedRevision) throw new ApiError(409, "This project has changed. Reload before deleting.");
    const now = new Date().toISOString();
    const result = await this.db.batch([
      this.db.prepare("UPDATE projects SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL").bind(now, now, id, owner, expectedRevision),
    ]);
    if (result[0].meta.changes !== 1) throw new ApiError(409, "This project has changed. Reload before deleting.");
  }
}
