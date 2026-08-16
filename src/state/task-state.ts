/**
 * TaskStateStore：State 的内存存储。
 * 与 History 完全解耦：History 保存对话条目，这里保存任务执行状态。
 * 由 update_state 工具调用 apply() 更新，每轮结束后通过 applyFromHistory() 应用模型更新。
 */
import type { AgentInputItem } from '@openai/agents';
import { emptyTaskState, isEmptyState, type TaskState, type TaskStateUpdate } from './types.js';

export class TaskStateStore {
  private state: TaskState = emptyTaskState();

  /** 当前状态（副本，避免外部直接修改内部数据） */
  get(): TaskState {
    return { ...this.state, completed: [...this.state.completed], pending: [...this.state.pending], decisions: [...this.state.decisions] };
  }

  /** 应用一次更新：传了哪个字段就替换哪个（数组整体替换），未传的保持不变 */
  apply(update: TaskStateUpdate): void {
    if (update.task !== undefined) this.state.task = update.task || null;
    if (update.step !== undefined) this.state.step = update.step || null;
    if (update.completed !== undefined) this.state.completed = [...update.completed];
    if (update.pending !== undefined) this.state.pending = [...update.pending];
    if (update.decisions !== undefined) this.state.decisions = [...update.decisions];
  }

  /** 从一轮 run 的 history 中提取 update_state 工具调用并应用（arguments 为 JSON 字符串） */
  applyFromHistory(history: AgentInputItem[]): number {
    let applied = 0;
    for (const item of history) {
      if (item.type !== 'function_call' || item.name !== 'update_state') continue;
      try {
        const args = JSON.parse(item.arguments ?? '{}') as TaskStateUpdate;
        this.apply(args);
        applied++;
      } catch {
        // 解析失败则跳过该次调用，不中断会话
      }
    }
    return applied;
  }

  /** 清空状态（/clear 命令时调用） */
  reset(): void {
    this.state = emptyTaskState();
  }

  /**
   * 序列化为注入 Context 的文本。
   * 状态全空时返回 null（此时无需注入，节省 token）。
   */
  toText(): string | null {
    const s = this.state;
    if (isEmptyState(s)) return null;
    const lines: string[] = ['【当前任务状态】'];
    if (s.task) lines.push(`任务：${s.task}`);
    if (s.step) lines.push(`当前步骤：${s.step}`);
    if (s.completed.length > 0) {
      lines.push('已完成：');
      for (const item of s.completed) lines.push(`- ${item}`);
    }
    if (s.pending.length > 0) {
      lines.push('待完成：');
      for (const item of s.pending) lines.push(`- ${item}`);
    }
    if (s.decisions.length > 0) {
      lines.push('关键决策：');
      for (const item of s.decisions) lines.push(`- ${item}`);
    }
    return lines.join('\n');
  }
}
