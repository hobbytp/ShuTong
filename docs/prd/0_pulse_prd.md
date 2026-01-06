# **产品需求文档 (PRD) - Project Insight (Pulse)**

**版本:** 0.1.0
**状态:** 待开发 (Ready for Dev)
**日期:** 2025-12-21

**目标受众:** AI 辅助开发工具 (Google Antigravity), 全栈开发团队, 产品团队

## **1. 产品概述 (Executive Summary)**

### **1.1 核心愿景：从“被动工具”到“主动伙伴”**

当前 AI 产品的核心痛点在于“能力强但用户不会用”以及用户的“定势效应（Einstellung Effect）”——用户往往满足于浅层答案而停止探索。  

Project Insight (Pulse) 旨在通过主动服务打破这一僵局, 它目标在于在当前ShuTong项目中加入ChatGPT Pulse类似的功能，而不破坏ShuTong已经存在的功能。它不仅仅是一个聊天机器人，而是一个 **“错时异步的主动式情报与行动助理”**。  

利用用户夜间休息时间，AI 在后台基于长期记忆、短期对话, ShuTong系统前一天的数据，及外部数据源进行深度研究与行为规划，在清晨以结构化信息流 (Feed) 的形式，主动呈上一份高度个性化的“今日情报”，将用户从被动的“信息消费者”转变为主动的“知识探索者”与“高效行动者”。


### **1.2 核心价值主张**

1. **对抗认知偏见:** 通过主动推送意外发现（Serendipity），引导用户发现那些“不知道自己不知道”的盲区。  
2. **降低交互门槛:** 将高成本的“Prompt 构思”转化为低成本的“点击/反馈”操作。  
3. **结构化与时效性:** L1（卡片）负责广度，L2（对话）负责深度；“阅后即焚”机制制造仪式感，拒绝信息囤积。  
4. **数据飞轮:** 通过显式反馈（赞/踩/策划）不断微调 Agent 的关注模型，越用越懂用户。

## **2. 战略目标 (OKRs)**

### **2.1 目标 1: 提升交互深度**

* **KR1:** 将用户交互模式从单次问答转变为多轮探索，单次卡片触发的平均对话轮次> 5。  
* **KR2:** L1 到 L2 的转化率（卡片展开/追问率）> 30%。

### **2.2 目标 2: 建立用户习惯**

* **KR1:** 60% 的 DAU 在上午 6:00 （时间可配） 前完成“今日 Pulse”的查阅。  
* **KR2:** 建立“反馈循环”，每日活跃用户的主动反馈率（赞/踩/引导） > 50%。

## **3. 用户角色与核心路径**

### **3.1 目标用户画像**

* **早期的探索者:** 高频使用 AI，渴望提升效率但受限于 Prompt 技巧。  
* **知识工作者:** 需要处理大量碎片化信息（会议、邮件、行业动态、大量本地资料），需要 AI 充当“第二大脑”。

### **3.2 核心用户循环 (The Core Loop)**

1. **夜间编排 (The Nightly Workflow):**  系统触发 Agent：Collect (收集记忆/日历) -> Process (去重/时效分析) -> Reason (生成洞察) -> Filter (安全检查)。  
2. **晨间唤醒 (The Morning Brief):**  用户打开 App，收到个性化问候：“早安，基于昨天的会议，为您准备了 5 条洞察。”  
3. **L1 浏览与反馈:**  用户快速扫读卡片。对不感兴趣的点“踩”，对有价值的点“赞”或“保存”。  
4. **L2 深度探索:**  用户点击“笔记发芽”卡片，系统自动加载相关上下文，用户无需输入 Prompt 即可开始深度对话。
5. **晚间策划:**  用户在睡前可对 Agent 下达指令：“明天帮我重点关注一下 OpenAI/Gemini 的最新发布。”

## **4. 功能需求说明 (Functional Requirements)**

### **4.1 首页：Pulse 智能卡片流**

* **交互逻辑:**  **有限流:** 每日仅推送 5-10 张高价值卡片，不支持无限下拉。  
  * **24小时生命周期:** 未保存的卡片在次日更新时自动归档/销毁。  
  * **状态管理:** 卡片具备 Unread, Read, Saved 状态。

### **4.2 卡片类型矩阵 (Card Typology)**

系统需支持以下模板，以满足不同场景需求：

| 卡片类型 | 描述 | 触发源 | 示例 |
| :---- | :---- | :---- | :---- |
| **Briefing (简报卡)** | 关键新闻摘要 + 封面图 | 订阅偏好 + 实时搜索 | “AI 在医疗领域的最新 3 个落地案例” |
| **Action (行动卡)** | 任务拆解 + 一键执行 | Google Calendar / Gmail | “您下午有战略会，这是为您准备的会议大纲草稿” |
| **Sprouting (发芽卡)** |  $$核心创新$$ 基于旧笔记的深度联想 | 历史记忆 / 收藏内容 | “您上周收藏了加缪的金句，这是对加缪存在主义的深度解读” |
| **Challenge (反直觉卡)** |  $$核心创新$$ 提醒用户逃避的事项 | 拖延行为识别 | “您推迟了 3 次‘健身计划’，为您生成了一份 15 分钟的最小行动清单” |
| **Meta (策划卡)** | 反馈与控制入口 | 系统默认 | “对今天的推荐满意吗？点击告诉我想看什么” |

### **4.3 L2 沉浸式对话 (Contextual Chat)**

* **无缝跳转:** 点击卡片进入 Chat 界面时，**必须**自动注入 System Prompt。  
* **Prompt 模板:** Based on the card "${cardTitle}" with content summary "${cardSummary}", the user is interested to learn more. Start the conversation by offering 3 specific angles to explore...

### **4.4 信任与安全**

* **分层授权:** \* Level 1: 读取日历忙闲状态。  
  * Level 2: 读取日历标题与详情。  
  * Level 3: 读取邮件正文。  
* **可解释性:** 每张卡片需标注来源（例：“基于您昨晚关于‘Rust语言’的提问生成”）。

## **5. 技术架构与数据规范 (Technical Architecture)**

此部分专为 **Google Antigravity** 生成代码设计，定义了严格的数据结构与组件关系。

### **5.1 数据模型 (Schema Definition)**

**仅供参考**
```typescript
// 用户配置与权限  

interface UserProfile {  
  id: string;  
  permissions: {  
    calendar_access: 'NONE' | 'FREE_BUSY' | 'FULL_DETAILS';  
    gmail_access: boolean;  
  };  
  preferences: {  
    topics: string[]; // ["AI", "Investment", "History"]  
    anti_procrastination_mode: boolean; // 开启"反直觉Pulse"  
  };  
}

// 核心 Pulse 卡片对象  
interface PulseCard {  
  id: string;  
  userId: string;  
  date: string; // YYYY-MM-DD  
  type: 'BRIEFING' | 'ACTION' | 'SPROUTING' | 'CHALLENGE' | 'META';  
    
  // L1 展示层数据  
  display: {  
    title: string;  
    summary_bullets: string[];  
    image_url?: string;  
    source_attribution: string; // "Based on your note from 3 days ago"  
  };

  // L2 逻辑层数据  
  context_payload: {  
    system_prompt: string; // 进入对话时的预设 Prompt  
    initial_questions: string[]; // 引导用户追问的问题  
    related_memory_ids?: string[]; // 关联的原始笔记/对话ID  
  };

  // 交互状态  
  status: 'UNREAD' | 'READ' | 'SAVED' | 'DISMISSED';  
  feedback?: {  
    action: 'THUMBS_UP' | 'THUMBS_DOWN';  
    user_comment?: string;  
  };  
    
  expiresAt: number; // Unix Timestamp  
}
```

### **5.2 前端组件架构 (React + Tailwind)**

**仅供参考**
```
/* Component Hierarchy */

<App\>  
  <AuthProvider\>  
    <PulseLayout\>  
      {/* 头部：日期与问候 */ }  
      <MorningHeader \>   
        
      {/* 核心 Feed 流 */}  
      <FeedContainer\>  
        <CardStack\>  
          {/* 根据 type 渲染不同组件 */}  
          <SproutingCard data={cardData} onExpand={handleDeepDive} \>  
          <ActionCard data={cardData} onExecute={handleAction} \>  
          <ChallengeCard data={cardData} \>  
        </CardStack\>  
      </FeedContainer\>

      {/* 底部策划栏 */}  
      <CuratorInput placeholder="明早你想看点什么？" \>

      {/* L2 详情模态框/侧边栏 */}  
      <DeepDiveInterface isVisible={showChat}>  
         <ChatWindow context={activeCardContext} >  
      </DeepDiveInterface>  
        
    </PulseLayout>  
  </AuthProvider>  
</App>
```

### **5.3 后端 Agent 编排 (LangChain Logic)**

* **Trigger:** Cron Job @ 4:00 AM Local Time.  
* **Step 1 (Source Aggregation):**  
  * Fetch UserMemories (Last 7 days).  
  * Fetch CalendarEvents (Today).  
  * Identify "Stale Notes" (Older than 30 days but high relevance) -> *Trigger for Sprouting.*  
* **Step 2 (LLM Reasoning):**  
  * Use Chain-of-Thought: "Analyze user's recent anxiety based on tone -> Identify postponed tasks -> Generate 'Challenge Card'."  
* **Step 3 (Structure & Save):**  
  * Format output to strict JSON matching PulseCard interface.  
  * Save to Database.

## **6. 上线与发布策略 (Launch Strategy)**

* **Phase 1 (Internal Alpha):** 仅团队内部使用，校准推荐算法的“幻觉率”和“相关性”。  
* **Phase 2 (Preview):** 符合“晨间扫读”场景。  
* **Phase 3 (Loop Validation):** 监控关键指标（L2 转化率、反馈率）。只有当“数据飞轮”转动（即反馈能显著提升次日推荐质量）时，才进入下一阶段。

## **7. 非功能性需求**

* **隐私计算:** 敏感数据（邮件/日历）的处理应尽可能在生成时进行，处理后仅保留生成的摘要，**绝不**持久化存储原始邮件内容。  
* **加载性能:** 晨间 Feed 必须实现“秒开”（<1s），利用 CDN 缓存预生成的 JSON 数据。  
* **容错:** 若 LLM 生成失败，需降级显示通用新闻卡片，避免白屏。