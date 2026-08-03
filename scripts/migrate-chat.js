'use strict';

const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { neon } = require('@neondatabase/serverless');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const sql = neon(process.env.DATABASE_URL);
  const source = await readFile(path.join(__dirname, '..', 'migrations', '001_chat_history.sql'), 'utf8');
  const statements = source.split(';').map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) await sql.query(statement);
  console.log(`Applied ${statements.length} chat storage statements.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
