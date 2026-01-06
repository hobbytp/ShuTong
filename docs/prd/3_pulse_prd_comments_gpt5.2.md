我的问题：

```text
对比当前ShuTong里面的Pulse功能的实现和pulse prd v2的描述，分析一下，还有哪些gap，特别关注根据收集到的信息从各个角度反馈给用户，为用户提供意外之喜的功能。
```

下面是“当前 ShuTong 的 Pulse 实现”对照 pulse_prd_v2_opencontext.md 的 gap 分析（重点放在“基于收集信息从多角度反馈 + 意外之喜/Serendipity”）。

## 1) 当前实现到底做到了什么（以代码为准）

L1 卡片流：页面在 PulseFeed.tsx
4 个按钮手动生成：briefing/action/sprouting/challenge
历史列表从 SQLite 读 pulse_cards（最多 50 条）
右下角 “Ask Pulse” 是一个简单聊天框，调用 main 进程的 ask-pulse
IPC：在 main.ts:130-250
get-pulse-cards / generate-pulse-card / ask-pulse
存储：在 storage.ts:40-190
pulse_cards 表只有：id/type/title/content/suggested_actions/created_at
Agent：在 pulse-agent.ts
LangGraph 只有 2 个节点：context_retrieval（向量搜索）→ agent_reasoning（LLM 生成 JSON 卡片或回答）
上下文只来自 vectorStorage.search(query, 10)
Card 类型的差异基本只体现在 prompt 文案上
调度：在 scheduler.ts:30-120
启动后（且 vector storage init 成功）会尝试每天生成一次 briefing，并发系统通知

## 2) 对照 PRD 的核心 gap（按影响优先级）

### A. “意外之喜/多角度反馈”相关的核心缺口（最大 gap）
PRD 设想的 Serendipity 来源是“多源上下文 + 多策略检索 + 结构化过滤/排序”。当前实现只有“一条 query → top10 活动向量 → LLM 生成”，因此：

没有“多源上下文”：PRD 提到的 Journal / Todos / Daily Reports / Entities / SmartTip 等工具链，在代码侧没有对应接入（至少在 Pulse 链路里没有出现）。当前 Pulse 只消费向量库搜索结果，且没有区分 contextType。
没有“多角度分析面”：Action/Challenge/Sprouting 只是不同 prompt，不是不同的数据与策略。比如：
Sprouting（旧笔记联想）：PRD 期待“找旧笔记/历史语义相似”，但当前只是对“activities”做搜索，无法保证“旧笔记”来源，更谈不上“3 天前会议笔记关联”。
Challenge（反直觉/拖延/低效）：PRD 期待 SmartTip 或行为模式，当前只让 LLM 在 10 条活动摘要里“猜”效率问题，缺少统计证据（重复切换、长时间 distraction、反复推迟等）。
Action（待办拆解）：PRD 期待 SmartTodoManager 或从明确 todo 数据源抽取，当前只是从活动摘要中推断 action items，稳定性较差。
没有“新颖度/反常检测”：PRD 的“意外之喜”本质需要 novelty scoring / anomaly detection / diversification。当前没有任何打分、去重、分桶、对比昨日/上周基线的逻辑，所以卡片更像“摘要”，而不是“惊喜情报”。

### B. L1 卡片流机制与 PRD 不一致
PRD 要求：

每日 5-10 张高价值卡片、有限流、24 小时生命周期、状态机（UNREAD/READ/SAVED/DISMISSED）、Meta 卡做反馈入口。
当前实现：
历史无限累积（仅按 limit 截断），没有“按天”的概念，也没有 expiresAt、status、feedback、Meta 卡。
UI 没有“赞/踩/保存/不感兴趣”，因此 PRD 说的数据飞轮（显式反馈调优）无从发生。

### C. 触发策略与“错时异步”差距
PRD 强调夜间编排/晨间唤醒。当前实现：

只有启动时的 checkAndGenerateBriefing()（每天一次），并没有“按 morning_brief_time 定时生成 5-10 条”，也没有 nightly workflow（collect/process/reason/filter）。
Briefing 当前是“总结今日活动”，PRD 的 Phase 里还写到“Briefing 需外部新闻 API”，这点目前没做（不一定要做，但算 spec gap）。

### D. L2 沉浸式对话（工具并行/充分性评估）差距
PRD 的 L2 是“Intent → Context 工具并行 → 充分性评估循环 → Executor 流式生成”。当前 PulseAgent：

不做 intent 识别（没有 Intent Node）
不做工具并行与循环，只做一次向量检索
没有“相关 context_ids / tools_to_preload / initial_questions”的结构化 payload

### E. IPC/数据结构与 PRD 不对齐
PRD 设计了 pulse:fetch-cards / pulse:update-status / pulse:submit-feedback / pulse:trigger-generation / pulse:start-chat / pulse:chat-message。当前实现是 get-pulse-cards / generate-pulse-card / ask-pulse，且没有 status/feedback 的通道与表结构。

### F. 信任与安全/可解释性缺失
PRD 要求每张卡标注来源（例如 “基于 ActivityContextTool 检索”），并有分层授权。当前卡片没有 source attribution 字段，也没有权限控制逻辑（至少 Pulse 链路未体现）。

## 3) 专门聚焦“意外之喜”的 gap 拆解（更落地）
如果只看“让用户感到惊喜”的能力，当前缺失主要在三块：

时间维度的对比：没有“与昨日/上周相比的变化点”（例如：专注时长下降、会议激增、上下文切换次数异常）。
跨数据源的桥接：没有把 Timeline Cards/Journal/Reports/Todos/Entities 做成可组合的证据链（“你今天做了 X，而你 3 天前写的 Y 正好能帮上”）。
多样性与反直觉筛选：没有“去重 + 多样性约束 + 新颖度”来保证 5-10 张卡每张都有不同角度，避免 4 张卡都在讲同一件事。
如果你愿意，我可以在下一步把这些 gap 转成一个“最小可实现”的实现清单（不会扩 UI 规模，只在现有 PulseFeed 的卡片上加最小交互/字段），并按“最快提升 serendipity”的顺序排优先级。