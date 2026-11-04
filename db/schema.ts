import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const results = sqliteTable('results', {id:text('id').primaryKey(),created:text('created').notNull(),payload:text('payload').notNull()});
export const molecules = sqliteTable('molecules', {
  id: text('id').primaryKey(),
  nameKey: text('name_key').notNull().unique(),
  structureKey: text('structure_key').unique(),
  pubchemCid: text('pubchem_cid').unique(),
  created: text('created').notNull(),
  updated: text('updated').notNull(),
  payload: text('payload').notNull(),
});
export const moleculeSources = sqliteTable('molecule_sources', {
  sourceKey: text('source_key').primaryKey(),
  database: text('database_name').notNull(),
  identifier: text('identifier').notNull(),
  moleculeId: text('molecule_id').notNull(),
});
