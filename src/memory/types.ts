/**
 * Memory（会话级长期记忆）类型定义。
 *
 * 参考 Claude Code 记忆方案的内存版：记忆仓库 + 主题索引 + 按需加载。
 * - 写入：模型通过 remember 工具自主保存（零额外 API 调用）
 * - 读取：模型在需要时通过 retrieve_memory 工具按需取用（不每轮注入）
 * - 存储：纯内存，不落盘（现阶段约束）
 */

/** 记忆类别：长期有效决策 / 项目关键事实 */
export type MemoryCategory = 'decision' | 'fact';

/** 一条长期记忆 */
export interface Memory {
  /** 唯一 key */
  id: string;
  /** 类别 */
  category: MemoryCategory;
  /** 主题/关键词（索引 key，检索用） */
  topic: string;
  /** 记忆内容 */
  content: string;
  /** 创建时间（毫秒时间戳） */
  createdAt: number;
  /** 最后更新时间（毫秒时间戳） */
  updatedAt: number;
}

/** 写入记忆的输入（id 与时间戳由仓库生成） */
export type MemoryInput = Pick<Memory, 'category' | 'topic' | 'content'>;

/** 添加/合并记忆的结果 */
export interface MemoryAddResult {
  /** 是否新增（false 表示合并到了已有记忆） */
  added: boolean;
  /** 生效的记忆 */
  memory: Memory;
}
