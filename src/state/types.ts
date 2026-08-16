/**
 * Agent State 类型定义。
 *
 * State 与 History 解耦：History 记录对话内容，State 记录任务执行进度。
 * State 由模型通过 update_state 工具维护，注入 Context 后跨轮次、跨裁剪持续生效。
 */

/** 任务执行状态 */
export interface TaskState {
  /** 当前任务描述 */
  task: string | null;
  /** 当前正在执行的步骤 */
  step: string | null;
  /** 已完成事项 */
  completed: string[];
  /** 待完成事项 */
  pending: string[];
  /** 关键决策 */
  decisions: string[];
}

/**
 * update_state 工具的参数。
 * 完整替换语义：传了哪个字段就替换哪个（数组字段为整体替换，传空数组表示清空），
 * 未传的字段保持不变。
 */
export type TaskStateUpdate = Partial<TaskState>;

/** 创建一个空白状态 */
export function emptyTaskState(): TaskState {
  return {
    task: null,
    step: null,
    completed: [],
    pending: [],
    decisions: [],
  };
}

/** 判断状态是否全空（无可注入内容） */
export function isEmptyState(state: TaskState): boolean {
  return (
    (state.task === null || state.task === '') &&
    (state.step === null || state.step === '') &&
    state.completed.length === 0 &&
    state.pending.length === 0 &&
    state.decisions.length === 0
  );
}
