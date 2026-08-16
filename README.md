# spirit-openai

## 多轮 AI Agent 任务清单
```
History
  ↓
Context Management
  ↓
State
  ↓
Memory
  ↓
Context / Memory 优化
```

### 第一阶段：History + Context ✅ 已完成
 - ✅ 建立 Conversation History
 - ✅ 保存用户消息
 - ✅ 保存 Agent 消息
 - ✅ 保存 Tool Call / Tool Result
 - ✅ 实现 Context Manager
 - ✅ Token 计算
 - ✅ Context Window 限制
 - ✅ 保留 System Prompt
 - ✅ 保留最近相关消息
 - ✅ 超限时裁剪历史
 - ✅ 实现历史摘要
 - ✅ 将被裁剪的历史压缩成 Summary
 - ✅ Summary 注入 Context
 - ✅ 测试长对话下的 Context 裁剪
### 第二阶段：State ✅ 已完成
 - ✅ 定义 Agent State
 - ✅ 当前 Task
 - ✅ 当前 Step
 - ✅ 已完成事项
 - ✅ 待完成事项
 - ✅ 关键决策
 - ✅ State 与 History 解耦
 - ✅ Agent 执行时读取 State
 - ✅ Agent 执行过程中更新 State
 - ✅ 将必要 State 注入 Context
 - ✅ 测试 Context 裁剪后 Agent 能否继续任务
### 第三阶段：Memory
 - 定义长期记忆类型
 - 用户偏好
 - 用户长期事实
 - 项目关键事实
 - 长期有效决策
 - 实现 Memory Write
 - 从对话中提取候选 Memory
 - 判断是否值得保存
 - 保存 Memory
 - 实现 Memory Storage
 - 实现 Memory Retrieval
 - 根据当前任务检索相关 Memory
 - 将相关 Memory 注入 Context
 - 实现 Memory 更新 / 去重 / 删除
 - 测试 Memory 是否能跨 Context 裁剪继续生效
### 第四阶段：优化
 - 明确 History / Context / State / Memory 的边界
 - 建立 Context 优先级
 - System Prompt
 - 当前任务
 - State
 - 相关 Memory
 - 最近对话
 - 历史 Summary
 - 优化 Context 裁剪策略
 - 优化 Summary 策略
 - 优化 Memory Retrieval
 - 防止无关 Memory 污染 Context
 - 防止重要信息在压缩过程中丢失

