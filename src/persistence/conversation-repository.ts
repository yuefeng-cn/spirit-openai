/**
 * 会话、消息与图片版本的数据库读写。
 * 所有查询均以 conversationId 隔离。
 */
import type { AgentInputItem } from '@openai/agents';
import type { PoolClient } from 'pg';
import { getPool } from './database.js';
import type {
  ImageVersion,
  CreateImageVersionInput,
  ImageRepo,
} from '../image/types.js';
import { EMPTY_IMAGE_CONTEXT } from '../image/types.js';

export interface ConversationRow {
  id: string;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

// ── 会话管理 ──────────────────────────────────────────────

/** 创建新会话，返回 id */
export async function createConversation(id?: string): Promise<string> {
  const pool = getPool();
  const result = id
    ? await pool.query<{ id: string }>(
        'INSERT INTO conversations (id) VALUES ($1) RETURNING id',
        [id],
      )
    : await pool.query<{ id: string }>(
        'INSERT INTO conversations DEFAULT VALUES RETURNING id',
      );
  return result.rows[0].id;
}

/** 获取会话；不存在则创建 */
export async function getOrCreateConversation(id: string): Promise<ConversationRow> {
  const pool = getPool();
  const existing = await pool.query<ConversationRow>(
    'SELECT * FROM conversations WHERE id = $1',
    [id],
  );
  if (existing.rows.length > 0) return existing.rows[0];
  await createConversation(id);
  return (await pool.query<ConversationRow>('SELECT * FROM conversations WHERE id = $1', [id]))
    .rows[0];
}

/** 列出所有会话（最新在前） */
export async function listConversations(): Promise<ConversationRow[]> {
  const pool = getPool();
  const result = await pool.query<ConversationRow>(
    'SELECT * FROM conversations ORDER BY updated_at DESC',
  );
  return result.rows;
}

export interface ConversationSummary extends ConversationRow {
  message_count: number;
}

/** 列出所有会话及其消息数（最新在前） */
export async function listConversationSummaries(): Promise<ConversationSummary[]> {
  const pool = getPool();
  const result = await pool.query<ConversationSummary>(
    `SELECT c.id, c.summary, c.created_at, c.updated_at,
            COUNT(m.id)::int AS message_count
     FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
  );
  return result.rows;
}

// ── 消息 ──────────────────────────────────────────────────

/** 批量追加消息条目（只追加，不修改旧记录） */
export async function appendMessages(
  conversationId: string,
  items: AgentInputItem[],
): Promise<void> {
  if (items.length === 0) return;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(
        'INSERT INTO messages (conversation_id, item) VALUES ($1, $2)',
        [conversationId, JSON.stringify(item)],
      );
    }
    await client.query(
      'UPDATE conversations SET updated_at = now() WHERE id = $1',
      [conversationId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 按序加载会话全部消息条目 */
export async function loadMessages(conversationId: string): Promise<AgentInputItem[]> {
  const pool = getPool();
  const result = await pool.query<{ item: AgentInputItem }>(
    'SELECT item FROM messages WHERE conversation_id = $1 ORDER BY id ASC',
    [conversationId],
  );
  return result.rows.map((r) => r.item);
}

// ── 摘要 ──────────────────────────────────────────────────

/** 更新会话摘要 */
export async function updateSummary(conversationId: string, summary: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    'UPDATE conversations SET summary = $2, updated_at = now() WHERE id = $1',
    [conversationId, summary],
  );
}

/** 读取会话摘要 */
export async function getSummary(conversationId: string): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ summary: string | null }>(
    'SELECT summary FROM conversations WHERE id = $1',
    [conversationId],
  );
  return result.rows[0]?.summary ?? null;
}

// ── 图片版本 ───────────────────────────────────────────────

interface ImageVersionRow {
  id: string;
  conversation_id: string;
  display_no: number;
  source_type: 'upload' | 'generated';
  message_id: string | null;
  parent_version_id: string | null;
  object_key: string;
  prompt: string | null;
  image_context: { summary: string; preserve: string[] };
  provider: string | null;
  model: string | null;
  provider_state: unknown | null;
  created_at: Date;
}

function rowToVersion(row: ImageVersionRow): ImageVersion {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    displayNo: Number(row.display_no),
    sourceType: row.source_type,
    messageId: row.message_id,
    parentVersionId: row.parent_version_id,
    objectKey: row.object_key,
    prompt: row.prompt,
    imageContext: row.image_context ?? EMPTY_IMAGE_CONTEXT,
    provider: row.provider,
    model: row.model,
    providerState: row.provider_state,
    createdAt: row.created_at,
  };
}

/** 在事务内分配当前会话的下一个 displayNo */
async function nextDisplayNo(client: PoolClient, conversationId: string): Promise<number> {
  const r = await client.query<{ next: string }>(
    `SELECT COALESCE(MAX(display_no), 0) + 1 AS next
     FROM image_versions WHERE conversation_id = $1`,
    [conversationId],
  );
  return Number(r.rows[0].next);
}

/** 创建图片版本；在事务内分配 displayNo，保证会话内唯一 */
export async function createImageVersion(
  input: CreateImageVersionInput,
): Promise<ImageVersion> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const displayNo = await nextDisplayNo(client, input.conversationId);
    const r = await client.query<ImageVersionRow>(
      `INSERT INTO image_versions
         (conversation_id, display_no, source_type, message_id, parent_version_id,
          object_key, prompt, image_context, provider, model, provider_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        input.conversationId,
        displayNo,
        input.sourceType,
        input.messageId ?? null,
        input.parentVersionId ?? null,
        input.objectKey,
        input.prompt ?? null,
        JSON.stringify(input.imageContext ?? EMPTY_IMAGE_CONTEXT),
        input.provider ?? null,
        input.model ?? null,
        input.providerState != null ? JSON.stringify(input.providerState) : null,
      ],
    );
    await client.query('COMMIT');
    return rowToVersion(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 按 id 读取图片版本；conversationId 不匹配则返回 null（跨会话隔离） */
export async function getImageVersion(
  id: string,
  conversationId: string,
): Promise<ImageVersion | null> {
  const pool = getPool();
  const r = await pool.query<ImageVersionRow>(
    'SELECT * FROM image_versions WHERE id = $1 AND conversation_id = $2',
    [id, conversationId],
  );
  return r.rows[0] ? rowToVersion(r.rows[0]) : null;
}

/** 按 displayNo 读取图片版本（@img-N） */
export async function getImageVersionByDisplayNo(
  conversationId: string,
  displayNo: number,
): Promise<ImageVersion | null> {
  const pool = getPool();
  const r = await pool.query<ImageVersionRow>(
    'SELECT * FROM image_versions WHERE conversation_id = $1 AND display_no = $2',
    [conversationId, displayNo],
  );
  return r.rows[0] ? rowToVersion(r.rows[0]) : null;
}

/** 列出会话全部图片版本（按 displayNo 升序） */
export async function listImageVersions(conversationId: string): Promise<ImageVersion[]> {
  const pool = getPool();
  const r = await pool.query<ImageVersionRow>(
    'SELECT * FROM image_versions WHERE conversation_id = $1 ORDER BY display_no ASC',
    [conversationId],
  );
  return r.rows.map(rowToVersion);
}

/** 读取当前活动图片版本 id */
export async function getActiveImageVersionId(
  conversationId: string,
): Promise<string | null> {
  const pool = getPool();
  const r = await pool.query<{ active_image_version_id: string | null }>(
    'SELECT active_image_version_id FROM conversation_state WHERE conversation_id = $1',
    [conversationId],
  );
  return r.rows[0]?.active_image_version_id ?? null;
}

/** 设置（或清空）当前活动图片版本 */
export async function setActiveImageVersionId(
  conversationId: string,
  imageVersionId: string | null,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO conversation_state (conversation_id, active_image_version_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (conversation_id) DO UPDATE
       SET active_image_version_id = EXCLUDED.active_image_version_id,
           updated_at = now()`,
    [conversationId, imageVersionId],
  );
}

/**
 * 实现 ImageRepo 接口的数据库版本，直接传给 ImageService。
 * 使用时：`new DbImageRepo(conversationId)` 传入 ImageService 构造函数。
 */
export class DbImageRepo implements ImageRepo {
  constructor(private conversationId: string) {}

  createImageVersion(input: CreateImageVersionInput): Promise<ImageVersion> {
    return createImageVersion(input);
  }
  getImageVersion(id: string): Promise<ImageVersion | null> {
    return getImageVersion(id, this.conversationId);
  }
  getImageVersionByDisplayNo(
    conversationId: string,
    displayNo: number,
  ): Promise<ImageVersion | null> {
    return getImageVersionByDisplayNo(conversationId, displayNo);
  }
  listImageVersions(conversationId: string): Promise<ImageVersion[]> {
    return listImageVersions(conversationId);
  }
  getActiveImageVersionId(conversationId: string): Promise<string | null> {
    return getActiveImageVersionId(conversationId);
  }
  setActiveImageVersionId(
    conversationId: string,
    imageVersionId: string | null,
  ): Promise<void> {
    return setActiveImageVersionId(conversationId, imageVersionId);
  }
}
