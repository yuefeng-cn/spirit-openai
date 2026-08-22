# spirit-openai

多轮对话 CLI，支持文字聊天与图片生成/编辑，会话持久化到 PostgreSQL。

## 设计目标

- **多轮会话可恢复**：历史消息存入 PostgreSQL，重启后可通过 `--conversation <id>` 无缝接续。
- **Context 自动管理**：超出 token 预算时裁剪旧轮次并生成滚动摘要注入 System Prompt，避免模型遗忘。
- **图片版本可追溯**：每张图（上传/生成/编辑）均记录到数据库，分配 `@img-N` 编号，支持跨会话引用与分支编辑。
- **图片二进制不落库**：二进制字节只在 Storage 与 Provider 之间流动，不进数据库、History 或日志。
- **Provider 可替换**：`ImageProvider` 接口将生图逻辑与业务解耦，切换 Provider 不影响 `ImageService`。
- **测试不依赖网络**：单元与集成测试全部用 `MockImageProvider` + 内存 Repo，无需真实 API。

---

## 模块结构

```
src/
├── index.ts                  # REPL 入口：主循环、命令处理、图片文件解析
├── agent.ts                  # Agent 定义与工具组装（@openai/agents）
├── ui.ts                     # 终端颜色与提示文本
│
├── history/                  # 会话历史
│   └── conversation-history.ts   # 内存历史；loadItems 恢复、getNewItemsSince 增量持久化
│
├── context/                  # Context 管理
│   ├── tokenizer.ts          # tiktoken token 估算
│   ├── summarizer.ts         # 旧轮次摘要生成
│   └── context-manager.ts   # 裁剪 + 摘要注入，维护 lastStats
│
├── state/                    # 任务状态
│   ├── task-state.ts         # TaskStateStore：轻量键值状态，update_state 工具写入
│   └── update-state-tool.ts  # Agent 工具：update_state
│
├── memory/                   # 会话级记忆
│   ├── memory-store.ts       # 内存仓库：主题索引 + bigram 相似度去重
│   └── memory-tools.ts       # Agent 工具：remember / retrieve_memory
│
├── persistence/              # PostgreSQL 持久化（原生 pg，无 ORM）
│   ├── database.ts           # 连接池 + migrate()（幂等 DDL）
│   └── conversation-repository.ts  # conversations / messages / image_versions / conversation_state CRUD
│
└── image/                    # 图片子系统
    ├── types.ts              # ImageVersion、ImageRepo 接口、ResolveResult
    ├── image-provider.ts     # ImageProvider 接口（generate / edit）
    ├── image-storage.ts      # ImageStorage 接口 + LocalImageStorage（本地文件系统）
    ├── image-service.ts      # 业务核心：版本注册、引用解析（7 种模式）、生成/编辑编排
    ├── image-tools.ts        # Agent 工具：generate_image / edit_image（execute 函数可独立测试）
    └── providers/
        ├── mock.ts           # MockImageProvider：离线、确定性，用于测试
        └── openai.ts         # OpenAIImageProvider：gpt-image-2（Azure 部署）
```

---

## 数据库表

| 表 | 用途 |
|----|------|
| `conversations` | 会话元数据 |
| `messages` | 会话历史条目（JSON） |
| `image_versions` | 图片版本：displayNo、sourceType、objectKey、parentVersionId、imageContext |
| `conversation_state` | 活动图片 ID 等会话状态 |

---

## 快速开始

**依赖：** Node.js 22+、Docker（PostgreSQL）

```bash
# 启动数据库
docker compose up -d

# 配置环境变量（复制后填入 key）
cp .env.example .env

# 启动（自动编译）
npm start

# 恢复历史会话
npm start -- --conversation <conversation-id>

# 仅运行单元测试（不需要数据库）
npm test

# 运行集成测试（需要数据库）
npm run test:integration
```

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 对话模型 API Key |
| `OPENAI_BASE_URL` | 对话模型 endpoint（兼容 OpenAI Chat Completions） |
| `OPENAI_MODEL_ID` | 对话模型名称 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `OPENAI_IMAGE_ENDPOINT` | gpt-image-2 生成 endpoint（`/images/generations`） |
| `OPENAI_IMAGE_API_KEY` | gpt-image-2 API Key（含 `Bearer ` 前缀） |
| `OPENAI_IMAGE_MODEL` | 图片模型名，默认 `gpt-image-2` |
| `IMAGE_STORE_DIR` | 图片原始文件存储目录，默认 `./image-store` |
| `IMAGE_OUTPUT_DIR` | 图片输出目录（物化后的本机可读路径），默认 `./image-output` |

---

## CLI 命令

| 命令 | 说明 |
|------|------|
| `/image list` | 列出当前会话所有图片版本 |
| `/image use @img-N` | 将指定图片设为活动图 |
| `/image clear` | 清空活动图 |
| `/state` | 查看当前任务状态 |
| `/memory` | 查看记忆仓库；`/memory del <id>` 删除条目 |
| `/history` | 查看内存历史条目统计 |
| `/context` | 查看 Context 裁剪与摘要统计 |
| `/summary` | 查看当前滚动摘要内容 |
| `/clear` | 清空当前会话（历史、状态、记忆） |
| `/exit` | 退出 |

**图片上传**：在输入行首填写本地图片路径，自动上传并注册版本。

```
/path/to/photo.png 把这张图改成水彩风格
```
