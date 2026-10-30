import { integer, sqliteTable, text, primaryKey, index } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  revision: integer("revision").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
}, (table) => [index("projects_owner_idx").on(table.ownerId, table.updatedAt)]);

export const projectVersions = sqliteTable("project_versions", {
  projectId: text("project_id").notNull().references(() => projects.id),
  revision: integer("revision").notNull(),
  name: text("name").notNull(),
  documentKey: text("document_key").notNull(),
  createdAt: text("created_at").notNull(),
  message: text("message").notNull(),
}, (table) => [primaryKey({ columns: [table.projectId, table.revision] })]);
