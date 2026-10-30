import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ProjectStore } from "../../src/server/projects.ts";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(new URL("../../drizzle", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), "utf8"));
  }
  const db = {
    prepare(sql) {
      return {
        values: [], sql,
        bind(...values) { this.values = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.values) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => ({ meta: { changes: Number(sqlite.prepare(statement.sql).run(...statement.values).changes) } }));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const objects = new Map();
  const bucket = {
    async put(key, value) { objects.set(key, value); },
    async get(key) { return objects.has(key) ? { async text() { return objects.get(key); } } : null; },
    async delete(key) { objects.delete(key); },
  };
  return { store: new ProjectStore(db, bucket), objects, sqlite, db, bucket };
}

test("owner isolation covers list, get, save, history, restore, delete", async () => {
  const { store, sqlite } = setup();
  const project = await store.create("alice", "Estimate", { opaque: { untouched: true } });
  assert.equal((await store.list("alice")).length, 1);
  assert.deepEqual(await store.list("bob"), []);
  for (const operation of [
    () => store.get("bob", project.id),
    () => store.save("bob", project.id, 1, "Stolen", {}),
    () => store.versions("bob", project.id),
    () => store.version("bob", project.id, 1),
    () => store.restore("bob", project.id, 1, 1),
    () => store.delete("bob", project.id, 1),
  ]) await assert.rejects(operation, { status: 404 });
  assert.equal((await store.get("alice", project.id)).revision, 1);
  sqlite.close();
});

test("saving snapshots preserves unknown document data and rejects stale writers", async () => {
  const { store, objects, sqlite } = setup();
  const original = { opaque: { futureField: [1, "keep"] } };
  const first = await store.create("alice", "First", original);
  const second = await store.save("alice", first.id, 1, "Second", { ...original, quantity: 9 });
  assert.equal(second.revision, 2);
  await assert.rejects(() => store.save("alice", first.id, 1, "Stale", {}), { status: 409 });
  assert.deepEqual((await store.version("alice", first.id, 1)).document, original);
  assert.equal((await store.versions("alice", first.id)).length, 2);
  assert.equal(objects.size, 2);
  const result = await store.restore("alice", first.id, 2, 1);
  assert.equal(result.revision, 3);
  assert.deepEqual(result.document, original);
  assert.equal((await store.version("alice", first.id, 3)).message, "Restored version 1");
  assert.equal((await store.version("alice", first.id, 2)).document.quantity, 9);
  sqlite.close();
});

test("two concurrent saves produce exactly one new immutable revision", async () => {
  const { store, objects, sqlite } = setup();
  const project = await store.create("alice", "Estimate", { base: true });
  const results = await Promise.allSettled([
    store.save("alice", project.id, 1, "Writer A", { writer: "A" }),
    store.save("alice", project.id, 1, "Writer B", { writer: "B" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
  assert.equal((await store.get("alice", project.id)).revision, 2);
  assert.equal((await store.versions("alice", project.id)).length, 2);
  assert.equal(objects.size, 2);
  sqlite.close();
});

test("soft deletion requires current revision and makes all revisions inaccessible", async () => {
  const { store, sqlite } = setup();
  const project = await store.create("alice", "Estimate", {});
  await assert.rejects(() => store.delete("alice", project.id, 2), { status: 409 });
  await store.delete("alice", project.id, 1);
  assert.deepEqual(await store.list("alice"), []);
  await assert.rejects(() => store.get("alice", project.id), { status: 404 });
  await assert.rejects(() => store.version("alice", project.id, 1), { status: 404 });
  await assert.rejects(() => store.restore("alice", project.id, 1, 1), { status: 404 });
  sqlite.close();
});

test("missing R2 objects fail without inventing an empty document", async () => {
  const { store, objects, sqlite } = setup();
  const project = await store.create("alice", "Estimate", { important: true });
  objects.clear();
  await assert.rejects(() => store.get("alice", project.id), { status: 503 });
  sqlite.close();
});

test("failed metadata transaction does not expose a partial project", async () => {
  const { store, sqlite, db, bucket, objects } = setup();
  const broken = new ProjectStore({ ...db, async batch() { throw new Error("transport failed"); } }, bucket);
  await assert.rejects(() => broken.create("alice", "Estimate", {}), /transport failed/);
  assert.deepEqual(await store.list("alice"), []);
  assert.equal(objects.size, 1);
  sqlite.close();
});
