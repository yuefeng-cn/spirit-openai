/**
 * MemoryStore：会话级长期记忆仓库（内存版）。
 * - 存储：Map<id, Memory>（key 即记忆 id）
 * - 索引：Map<topic, Set<id>>（主题索引，供检索快速定位）
 * - 去重/更新：写入时按主题或内容相似度合并，同一记忆再次出现则更新时间与内容
 */
import { randomUUID } from 'node:crypto';
import type { Memory, MemoryAddResult, MemoryCategory, MemoryInput } from './types.js';

/** 内容相似度阈值：高于此值视为同一记忆，合并更新而非新增 */
const MERGE_SIMILARITY = 0.45;

function toBigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** 计算两段文本的字符 bigram Jaccard 相似度（中文友好） */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = toBigrams(a);
  const sb = toBigrams(b);
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 查询对文本的覆盖率 = 查询 bigrams 落在文本中的比例（短查询友好） */
function coverage(query: string, text: string): number {
  if (!query || !text) return 0;
  const sq = toBigrams(query);
  const st = toBigrams(text);
  let hit = 0;
  for (const g of sq) if (st.has(g)) hit++;
  return hit / sq.size;
}

export class MemoryStore {
  private memories = new Map<string, Memory>();
  private topicIndex = new Map<string, Set<string>>();

  /** 添加或合并一条记忆（自动去重：同主题/高度相似 → 合并更新） */
  add(input: MemoryInput): MemoryAddResult {
    const now = Date.now();
    const existing = this.findMergeTarget(input);
    if (existing) {
      existing.content = input.content;
      existing.category = input.category;
      existing.updatedAt = now;
      this.reindex(existing);
      return { added: false, memory: existing };
    }
    const memory: Memory = {
      id: randomUUID(),
      category: input.category,
      topic: input.topic,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    };
    this.memories.set(memory.id, memory);
    this.indexMemory(memory);
    return { added: true, memory };
  }

  /** 查找合并目标：主题相同（含包含关系）或内容相似度超过阈值 */
  private findMergeTarget(input: MemoryInput): Memory | null {
    for (const memory of this.memories.values()) {
      const topicMatch =
        memory.topic === input.topic ||
        (memory.topic.length > 1 &&
          input.topic.length > 1 &&
          (memory.topic.includes(input.topic) || input.topic.includes(memory.topic)));
      if (topicMatch) return memory;
      if (similarity(memory.content, input.content) >= MERGE_SIMILARITY) return memory;
    }
    return null;
  }

  /** 按 id 删除，返回是否删除成功 */
  remove(id: string): boolean {
    const memory = this.memories.get(id);
    if (!memory) return false;
    this.memories.delete(id);
    this.topicIndex.get(memory.topic)?.delete(id);
    return true;
  }

  /** 按 id 获取 */
  get(id: string): Memory | undefined {
    return this.memories.get(id);
  }

  /** 全部记忆（按更新时间倒序） */
  list(): Memory[] {
    return [...this.memories.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 清空仓库（/clear 命令时调用） */
  clear(): void {
    this.memories.clear();
    this.topicIndex.clear();
  }

  /** 仓库条数 */
  get size(): number {
    return this.memories.size;
  }

  /**
   * 检索：按查询匹配主题索引 + 内容相似度，返回最相关的 Top-N。
   * 主题索引命中的记忆优先，其余按内容相似度补充。
   */
  search(query: string, limit = 3): Memory[] {
    const q = query.trim();
    if (!q) return [];
    const scored: { memory: Memory; score: number }[] = [];
    const seen = new Set<string>();

    // 1) 主题索引命中（索引优先）
    for (const [topic, ids] of this.topicIndex) {
      const topicHit = topic.includes(q) || q.includes(topic) || similarity(topic, q) > 0.3;
      if (!topicHit) continue;
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const memory = this.memories.get(id);
        if (memory) scored.push({ memory, score: 1 + similarity(memory.topic, q) });
      }
    }

    // 2) 内容相似度补充
    for (const memory of this.memories.values()) {
      if (seen.has(memory.id)) continue;
      const s = Math.max(
        similarity(memory.topic, q),
        similarity(memory.content, q),
        coverage(q, memory.content),
      );
      if (s >= MERGE_SIMILARITY) scored.push({ memory, score: s });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.memory);
  }

  /** 统计各类别条数 */
  stats(): Record<MemoryCategory, number> {
    const result: Record<MemoryCategory, number> = { decision: 0, fact: 0 };
    for (const memory of this.memories.values()) result[memory.category]++;
    return result;
  }

  private indexMemory(memory: Memory): void {
    const ids = this.topicIndex.get(memory.topic) ?? new Set<string>();
    ids.add(memory.id);
    this.topicIndex.set(memory.topic, ids);
  }

  /** 更新主题索引（记忆 topic/content 变化后重建其索引项） */
  private reindex(memory: Memory): void {
    this.topicIndex.forEach((ids) => ids.delete(memory.id));
    this.indexMemory(memory);
  }
}
