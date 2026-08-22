# 图片 MVP 任务清单

## Agent 执行约定

执行任何任务前，先阅读 [Agent 执行约定](AGENT_EXECUTION.md)。

## 使用规则

- 目标是“可恢复的单会话多轮生图”，核心是会话图片的可靠指代，不是长期记忆；
- 一次只执行一个任务 ID；
- 任务完成后运行对应验证命令；
- 不为未来多 Provider、异步任务或 Web 提前建模；
- 所有图片查询必须限定当前 `conversationId`；
- 调用 Provider 前必须将用户指代解析为唯一图片；不能把“这张”“上一张”原样当成图片目标传入。

## 任务顺序

| 阶段 | 任务 | 说明文件 |
|---|---|---|
| P0 | P0-01、P0-02 | [P0 基线](P0-foundation.md) |
| P1 | P1-01、P1-02、P1-03 | [P1 会话持久化](P1-session-persistence.md) |
| P2 | P2-01、P2-02、P2-03 | [P2 图片核心](P2-image-core.md) |
| P3 | P3-01、P3-02、P3-03 | [P3 图片运行闭环](P3-image-runtime.md) |
| P4 | P4-01、P4-02 | [P4 Agent 与 CLI](P4-agent-cli.md) |
| P5 | P5-01、P5-02、P5-03 | [P5 真实 Provider](P5-real-provider.md) |

严格顺序：`P0 → P1 → P2 → P3 → P4 → P5`。

## 全局完成定义

- `npm run build`、`npm test` 通过；
- PostgreSQL 能恢复指定会话的文本和全部会话图片状态；
- 当前上传图、历史上传图和生成图都可精确选择并编辑；
- 生成、编辑、选图和会话恢复均可用；
- 图片编辑实际携带当前会话与目标图片的必要上下文；
- Mock 路径不依赖网络；
- 不提交图片、密钥、Base64 或签名 URL。
