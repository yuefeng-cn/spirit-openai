# P1：会话持久化

本阶段只解决“退出 CLI 后同一会话还能继续”，并建立会话图片的持久化索引。不要实现长期用户记忆。

## P1-01：接入 PostgreSQL 与最小 Schema

### 目标

使用 Docker 启动开发 PostgreSQL，并建立最少四张表：`conversations`（可含摘要）、`messages`、`conversation_state`、`image_versions`。

`image_versions` 表示会话中可引用的不可变图片，不限于模型输出。至少包含：ID、`conversation_id`、会话内不可复用的 `display_no`、`source_type`（`upload` / `generated`）、`message_id`、可空 `parent_version_id`、`object_key`、可空 `prompt`、`image_context` JSON、可空 `provider` / `model` / `provider_state`、创建时间。

### 约束

- 不建 Asset、Operation、分支关系、缩略图或 Provider 文件表；
- 数据库不保存图片二进制、Base64 或签名 URL；
- 所有外键和查询以 `conversation_id` 隔离；
- `display_no` 只在当前会话唯一；
- 选择一个简单的 Node PostgreSQL 访问方式，不引入大型 ORM。

### 验收

```bash
docker compose config
npm run build
```

## P1-02：持久化现有文本会话

### 目标

让现有 `ConversationHistory` 按 `conversationId` 从 PostgreSQL 追加和读取消息；CLI 可创建新会话或恢复一个会话。

### 约束

- 保持现有 History、ContextManager 的使用方式尽量不变；
- 不把图片二进制或 Base64 塞入 Message；图片与消息只通过 `image_versions.message_id` 关联；
- 只读取当前会话最近消息和已有摘要。

### 验收

- 重建 History 实例后，同一会话消息仍存在；
- 两个会话互不读取对方消息；
- 既有文本测试不退化。

```bash
npm test
npm run build
```

## P1-03：会话恢复集成测试

### 目标

覆盖“写入消息 → 重建进程依赖 → 恢复同一 `conversationId` → 继续聊天”。

### 验收

```bash
npm test
```
