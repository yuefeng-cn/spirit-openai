/**
 * 终端 UI：配色与帮助文本
 */

// 终端配色
export const color = {
  user: (s: string) => `\x1b[36m${s}\x1b[0m`, // 青色：用户
  assistant: (s: string) => `\x1b[32m${s}\x1b[0m`, // 绿色：助手
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`, // 暗色：提示
  error: (s: string) => `\x1b[31m${s}\x1b[0m`, // 红色：错误
};

// 帮助信息
export const helpText = `
${color.dim('可用命令：')}
  /help            显示本帮助
  /history         查看当前内存中保存的历史条目统计
  /context         查看 Context 占用与裁剪状态
  /summary         查看当前历史摘要内容
  /state           查看当前任务状态（任务/步骤/已完成/待完成/决策）
  /clear           清空当前会话上下文，开启新一轮对话
  /exit, /quit     退出程序（也可按 Ctrl+C 或 Ctrl+D）
${color.dim('直接输入内容即可与助手对话；需要最新信息时助手会自动联网搜索。')}
`;
