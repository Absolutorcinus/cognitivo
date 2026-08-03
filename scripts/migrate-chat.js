'use strict';

const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { neon } = require('@neondatabase/serverless');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const sql = neon(process.env.DATABASE_URL);
  const migrationsDirectory = path.join(__dirname, '..', 'migrations');
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();
  let statementCount = 0;

  for (const migrationFile of migrationFiles) {
    const source = await readFile(path.join(migrationsDirectory, migrationFile), 'utf8');
    const statements = source.split(';').map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await sql.query(statement);
    statementCount += statements.length;
  }

  console.log(`Applied ${statementCount} statements from ${migrationFiles.length} chat migrations.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
