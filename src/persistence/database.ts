/**
 * PostgreSQL 连接池与数据库初始化。
 * 使用 DATABASE_URL 环境变量；migrate() 在启动时调用一次。
 */
import pg from 'pg';

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

export function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL 未设置');
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  item JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS conversation_state (
  conversation_id UUID PRIMARY KEY REFERENCES conversations(id),
  active_image_version_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS image_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  display_no INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'generated')),
  message_id BIGINT REFERENCES messages(id),
  parent_version_id UUID REFERENCES image_versions(id),
  object_key TEXT NOT NULL,
  prompt TEXT,
  image_context JSONB NOT NULL DEFAULT '{}',
  provider TEXT,
  model TEXT,
  provider_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, display_no)
);
`;

export async function migrate(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(SCHEMA_SQL);
  } finally {
    client.release();
  }
}
