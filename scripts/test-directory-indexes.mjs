import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
try {
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('../migrations/0007_character_server_cursor_index.sql', import.meta.url), 'utf8'))
  db.exec(`WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 120000)
    INSERT INTO game_characters (id, character_name, character_id, server_id, legion_name, first_seen_at, last_seen_at, updated_at)
    SELECT id, 'Role ' || id, 'character-' || id, 'server-' || (id % 40),
      CASE WHEN id % 7 = 0 THEN NULL WHEN id % 11 = 0 THEN '' ELSE 'Legion ' || (id % 800) END, 1, 1, 1 FROM n`)
  db.exec(readFileSync(new URL('../migrations/0010_message_directory_performance.sql', import.meta.url), 'utf8'))
  db.exec('ANALYZE')
  const cases = [
    ["SELECT * FROM game_characters WHERE character_id = 'character-119999' AND id > 0 ORDER BY id LIMIT 2", 'idx_characters_character_id'],
    ["SELECT * FROM game_characters WHERE character_name = 'Role 119999' AND id > 0 ORDER BY id LIMIT 2", 'idx_characters_character_name'],
    ["SELECT * FROM game_characters WHERE legion_name = 'Legion 799' AND id > 50000 ORDER BY id LIMIT 51", 'idx_characters_legion_cursor'],
    ["SELECT * FROM game_characters WHERE COALESCE(legion_name, '') = '' AND id > 50000 ORDER BY id LIMIT 51", 'idx_characters_unaffiliated_cursor'],
    ["SELECT * FROM game_characters WHERE server_id = 'server-1' AND COALESCE(legion_name, '') = '' AND id > 50000 ORDER BY id LIMIT 51", 'idx_characters_server_unaffiliated_cursor'],
    ['SELECT * FROM chat_messages WHERE conversation_id = 1 AND id < 50000 ORDER BY id DESC LIMIT 51', 'idx_messages_conversation_cursor'],
  ]
  for (const [sql, index] of cases) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail).join('\n')
    assert.ok(plan.includes(index), `${index}: ${plan}`)
    assert.ok(!plan.includes('TEMP B-TREE'), `Unexpected temporary sorting: ${plan}`)
    db.prepare(sql).all()
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_characters').get().n, 120000)
  console.log('PASS: 120,000 SQLite characters; exact lookups, legion filters, unaffiliated filters and message history use indexes without temporary sorting')
} finally { db.close() }
