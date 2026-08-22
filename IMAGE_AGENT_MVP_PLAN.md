# 多轮对话生图 CLI MVP 计划

## 1. 目标

在一个可恢复的 CLI 会话中支持普通聊天、生成图片和连续改图。

核心是：**同一会话中出现过的每一张用户上传图和模型生成图，都有稳定标识；用户要求改图时，系统能把自然语言指代解析为唯一图片，并将该图片实际交给 Provider。**

用户退出 CLI 后，可通过同一 `conversationId` 恢复对话和图片。系统不构建跨会话偏好或自动视觉记忆。

## 2. 范围

### 要做

- PostgreSQL 保存当前会话的文本历史、活动图片和全部会话图片元数据；
- OSS 保存每个用户上传图和模型生成图的图片文件；
- 新图、上传图和每次改图均登记为不可变的会话图片；
- 支持解析本轮上传图、`@img-3`、`第 3 张`、`上一张`、`刚才这张`；
- 指代不唯一时必须反问，不能让 Provider 猜测目标图片；
- 同一会话恢复后仍可选择任意旧图继续编辑；
- 优先利用官方 Provider 的连续会话能力；连续状态不可用时，必须可从 OSS 取回目标图重新编辑；
- 默认保持同一图片谱系的图像 Provider / 模型，允许用户显式切换；
- 先用 Mock Provider 跑通，再接一个真实 Provider。

### 不做

- 跨会话自动带入人物、风格、用户偏好；
- 多张图片融合、遮罩、局部选区、缩略图、版本树可视化；
- 操作队列、重试、幂等、后台清理、自动 Provider 路由；
- Web、用户系统、长期 Memory 功能改造。

> 这里的“参考图”指可被选为**单一编辑目标**的图片。本 MVP 不承诺“用 A 图人物合成到 B 图背景”这种同时依赖多张输入图的工作流；收到这类请求时应明确提示当前限制，而不是静默选择其中一张。

## 3. 图片引用与上下文

### 3.1 会话图片池

所有在当前会话中出现的图片，无论是用户本轮上传、用户此前上传还是模型生成，均立即：

1. 保存原始文件到 OSS；
2. 写入一条 `ImageVersion`；
3. 分配当前会话内稳定、可显示的编号，例如 `@img-3`；
4. 关联产生它的消息。

`ImageVersion` 是“会话中可被引用的一张不可变图片”，不仅是模型输出版本。用户上传图是根图片；模型生成图也是根图片；编辑结果以 `parentVersionId` 指向被编辑图片。

### 3.2 引用解析规则

每次图片请求在调用 Provider **之前**完成解析，优先级如下：

1. 显式 `@img-N` 或版本 ID；
2. 本轮唯一上传图（“这张图”“这张参考图”）；
3. 明确序号（“第 N 张”）；
4. 当前活动图片（“刚才这张”“当前图”）；
5. “上一张”等时间指代；
6. 仍有多个候选或无候选时反问，并列出候选编号和来源。

自然语言模型只负责识别用户是否要生成/编辑及提取指代意图；`ImageService` 必须把意图落为唯一 `targetImageVersionId`。Provider 请求中不得留下“这张”“上一张”等未解析代词。

每次成功生成、上传或编辑后，CLI 都输出图片编号、来源和父图，例如：`@img-5（基于 @img-2）`，并提供 `/image list`、`/image use @img-5`。这是比纯自然语言猜测更稳定的兜底交互。

### 3.3 一次编辑实际携带的内容

```text
当前会话中与本轮有关的最近文本 / 摘要
+ 已解析的唯一目标图片 ID
+ 从 OSS 读取的目标图片文件
+ 目标图片的 imageContext
+ 本轮用户要求
```

目标图片的像素是视觉事实的首要来源；`imageContext` 只保存简短的视觉说明和用户明确要求保留的内容，用于补充文字上下文，不能替代目标图片。

新建图片不会自动携带其他图片的文件、人物或构图；只有用户明确选择图片作为编辑目标时才传图。

## 4. Provider 连续状态与系统状态

部分官方图像 API 支持通过前一响应、图像 ID 或对话历史进行多轮图片编辑。它们能提升连续编辑的理解和一致性，但这种状态只对同一官方 API、同一兼容模型链路有效，不能跨 Provider 迁移。

因此采用“双层状态”：

- **系统状态（权威）**：当前会话消息、图片编号、父子关系、OSS 原图、活动图片和 `imageContext`。它负责精确选图、会话恢复、Provider 切换和第三方代理回退。
- **Provider 状态（辅助）**：保存在输出图片对应的 `providerState`，例如前一响应 ID、文件 ID 或厂商要求回传的状态。仅当目标图片、Provider 和模型链路兼容时尝试使用。

优先级：可用的 Provider 连续状态可作为高保真快速路径；状态缺失、过期、换模型或第三方代理不保证兼容时，读取 OSS 中的目标图并显式发起编辑。系统不把厂商状态当作唯一记忆。

## 5. 模型切换策略

不建议让系统在一个连续改图链路中自动切换图像模型，也不建议把“不同模型擅长不同能力”变成每轮自动路由：这会中断官方连续状态，并可能引入人物、风格和细节漂移。

建议：

- 普通文本对话模型可独立切换；
- 每条图片谱系默认沿用其父图的 Provider / 模型；
- 用户可显式指定切换，例如“用 Nano Banana 基于 `@img-5` 改”；
- 切换后把目标图从 OSS 作为新 Provider 输入，创建子版本；CLI 提示这是“跨模型重编辑”，而非无损延续；
- 不自动为用户选择模型。首个 MVP 只接一个真实图像 Provider，模型切换在该闭环稳定后再开放。

## 6. 最小数据模型

只保留四类记录：

```text
Conversation
  └─ Message

ConversationState
  └─ activeImageVersionId

ImageVersion（会话图片：上传图或生成图）
  ├─ displayNo（会话内稳定编号，对应 @img-N）
  ├─ sourceType（upload | generated）
  ├─ messageId（图片出现在哪条消息中）
  ├─ parentVersionId（编辑目标；根图片为空）
  ├─ objectKey（OSS 图片文件）
  ├─ prompt（本次生成/编辑指令；上传图可为空）
  ├─ imageContext { summary, preserve[] }
  ├─ provider / model
  └─ providerState（可选）
```

说明：

- 不建立独立 Asset、Operation、分支头、父子关系表或派生图模型；一条 `ImageVersion` 对应一个可引用图片文件；
- 从旧图再次编辑自然形成分支，单个 `parentVersionId` 足够表达；
- `imageContext` 使用简单 JSON，不引入完整视觉规格体系；
- `providerState` 可能过期，不能影响恢复会话；过期时从 OSS 取目标图重新编辑；
- `displayNo` 在一个会话内不可复用，查询和外键始终由 `conversationId` 限制。

## 7. 模块

```text
src/persistence/
  database.ts                 PostgreSQL 连接和 migration
  conversation-repository.ts  会话、消息、活动图片、图片版本读写

src/image/
  types.ts                    ImageVersion、ImageContext 和引用解析类型
  image-service.ts            上传登记、引用解析、生成/编辑、版本写入、上下文拼装
  image-storage.ts            OSS / 本地图片读写
  image-provider.ts           Provider 接口
  providers/mock.ts           离线测试用 Provider
  providers/<provider>.ts     首个真实 Provider

src/agent.ts                  注册图片工具
src/index.ts                  CLI 会话恢复、命令和输出
```

约束：不额外拆分 Repository、ContextBuilder、Materializer、OperationService、CapabilityMatrix 等模块。引用解析也先保留在 `image-service.ts`；出现真实复杂度再拆。

## 8. 关键流程

### 8.1 启动或恢复会话

1. CLI 创建新会话，或读取指定/最近 `conversationId`；
2. 从 PostgreSQL 读取该会话消息、活动图片和会话图片池；
3. `ContextManager` 只使用当前会话消息；
4. 不依赖 Provider 仍能列图、选图和构造重传编辑请求。

### 8.2 用户携带图片

1. CLI 接收本轮图片文件；
2. 上传 OSS，创建 `sourceType=upload` 的根 `ImageVersion` 并关联用户消息；
3. 输出 `@img-N`；
4. 若本轮是编辑请求，引用解析优先将这张唯一上传图作为目标；否则只登记，不自动成为其他新图的隐式参考。

### 8.3 生成图片

1. 读取当前会话相关文本；
2. Provider 生成图片；
3. 上传 OSS；
4. 创建 `sourceType=generated` 的根 `ImageVersion`，更新活动图片并输出编号。

### 8.4 编辑图片

1. 解析用户指代；歧义则反问；
2. 读取目标版本、目标文件和 `imageContext`；
3. 若 Provider 连续状态兼容则尝试续接；否则显式传递从 OSS 读取的目标图片；
4. 用“相关文本 + 已解析目标 + 图片上下文 + 本轮要求”调用 Provider；
5. 上传结果；
6. 创建子 `ImageVersion`，更新活动图片并输出编号。

Provider 调用失败时不写版本；数据库写入失败时可能留下孤立 OSS 文件，MVP 仅记录错误，不做自动清理。

## 9. PostgreSQL 与 OSS 边界

| 数据 | 保存位置 |
|---|---|
| 会话、文本消息、摘要、活动图片 ID | PostgreSQL |
| 图片编号、来源消息、版本元数据、父版本、视觉说明、Provider 状态 | PostgreSQL |
| 图片二进制 | OSS |
| Base64、签名 URL、完整 Provider 响应、密钥 | 不持久化，不写 History/日志 |

OSS 签名 URL 是否能省请求体取决于 Provider；业务层不关心 URL、上传还是 Base64，由 Provider Adapter 自行处理。

## 10. CLI 图片呈现

CLI 的默认呈现不是持久 URL，而是稳定图片编号加本机可打开的文件路径。

```text
@img-5（基于 @img-2）
本地文件：/绝对路径/IMAGE_OUTPUT_DIR/<conversationId>/img-5.png
```

规则：

- OSS 中的 `objectKey` 是图片的权威来源；本机输出文件只是方便当前 CLI 用户查看的可重新生成副本；
- 每次生成或编辑成功后，CLI 将结果物化到可配置的 `IMAGE_OUTPUT_DIR/<conversationId>/img-<displayNo>.<ext>`，并输出绝对路径；
- 默认 `IMAGE_OUTPUT_DIR` 为项目内被 Git 忽略的本地目录；目录和文件均不得提交；
- 不在 PostgreSQL 保存本机绝对路径或签名 URL：路径由 `IMAGE_OUTPUT_DIR`、`conversationId`、`displayNo` 和 `objectKey` 后缀推导；
- 签名 URL 仅供 Provider Adapter 临时请求使用，不能作为用户后续引用图片的标识，也不在 CLI 默认输出；
- 本机物化失败时，图片版本仍以 OSS 保存成功为准；CLI 必须明确提示本机查看文件未生成，不能伪装为成功展示。

当前 MVP 不实现自动打开图片、终端内渲染或 `/image show` 命令。用户通过 CLI 输出的本机路径打开文件；对话内继续编辑使用 `@img-N`。

## 11. 实施顺序

```text
P0 基线
→ P1 会话持久化
→ P2 图片引用与核心
→ P3 图片运行闭环
→ P4 Agent / CLI 集成
→ P5 一个真实 Provider
```

任务细节见 [`docs/tasks/README.md`](docs/tasks/README.md)。每次只执行一个任务 ID。

## 12. 验收

1. CLI 可创建和恢复同一会话；
2. 恢复后文本聊天仍有前文；
3. 本轮上传图、此前上传图和模型生成图均可被 `@img-N` 精确选择；
4. “刚才这张”能指向活动图；歧义时必须反问；
5. 编辑请求实际读取并传递目标图，不能只把图片 ID / 代词写进 prompt；
6. 可从旧图分支编辑、重启后再编辑；
7. 首个真实 Provider 的连续状态可用时使用，不可用时可 OSS 重传回退；
8. 默认不自动跨模型编辑；显式切换后仍能完成一次基于目标图的编辑；
9. 每次生成或编辑均输出 `@img-N` 和可打开的本机绝对路径；
10. Mock 测试离线通过。

## 13. 实施限制

- 图片状态只按 `conversationId` 查询，禁止注入其他会话的数据；
- 图片二进制不得写入 PostgreSQL、History、Memory 或 Git；
- 未完成 Mock 闭环前不得接真实 Provider；
- 真实 Provider 逻辑只能放在 `src/image/providers/`；
- 不得在本 MVP 里为未来假设增加模块或表；
- 不允许把自然语言中的图片代词原样传给 Provider 作为目标选择依据。
