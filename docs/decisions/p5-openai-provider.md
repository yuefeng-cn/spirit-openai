# P5 Provider 选型：gpt-image-2（Azure）

## 基本信息

| 项目 | 值 |
|------|-----|
| Provider | OpenAI gpt-image-2，经 Azure AI Services 部署 |
| 模型 | `gpt-image-2`（环境变量 `OPENAI_IMAGE_MODEL`） |
| 生成 endpoint | `OPENAI_IMAGE_ENDPOINT`（指向 `/images/generations?api-version=2024-02-01`） |
| 编辑 endpoint | 同上，将 `generations` 替换为 `edits`，api-version 替换为 `2025-04-01-preview` |
| Auth | `Authorization: <OPENAI_IMAGE_API_KEY>`（值已含 `Bearer ` 前缀） |

## API 调用方式

**生成**：POST JSON

```json
{ "prompt": "...", "n": 1, "model": "gpt-image-2", "quality": "medium", "output_format": "png" }
```

**编辑**：POST `multipart/form-data`

| 字段 | 内容 |
|------|------|
| `image` | 目标图片字节（Blob，MIME = image/png 或 image/jpeg） |
| `prompt` | 编辑指令 |
| `n` | `1` |
| `model` | `gpt-image-2` |
| `quality` | `medium` |

**响应**（两者相同）：`{ "data": [{ "b64_json": "..." }] }`

## 连续状态（providerState）

gpt-image-2 **无连续状态**。每次编辑均以目标图片字节重新提交，`providerState` 始终为 `undefined`。

## 图片输入来源

编辑时从 `LocalImageStorage.read(objectKey)` 获取字节，转为 `Blob` 通过 FormData 上传，不经过数据库、History 或 Memory。

## 错误分类

| 情形 | 处理 |
|------|------|
| 内容安全拒绝 | 抛出"内容被安全系统拒绝"提示 |
| HTTP 非 200 | 抛出含错误 code/message 的可读错误 |
| data 为空数组 | 抛出"未生成图片，请修改提示词" |
