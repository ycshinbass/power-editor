import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
// Shared briefing and private push state use distinct application-enforced keys.
export const editorSnapshots = sqliteTable('editor_snapshots', {
  key: text('key').primaryKey().notNull(),
  version: text('version').notNull(),
  value: text('value').notNull(),
});
