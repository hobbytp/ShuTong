


## 演进
我用Gemini Canvas和Gemini讨论了一个综合ChatGPT Pulse，Dayflow，MineContext的方案。
目前LLM不需要考虑支持tool calling和mcp，可见和MineContext的思路不一样。
MineContext的复杂分析功能没有。
Pulse的主动功能没有。

* MineContext (深度)：解决 **“你不够了解我”的问题**。核心是全量数据的语义索引。
* Dayflow (广度/执行)：解决 **“你只能聊天不能干活”的问题**。核心是跨应用的自动化流。
* ChatGPT Pulse (主动性)：解决 **“我不知道该问什么”的问题**。核心是离线推理与主动推送。


## 功能设计

### TBD



### 1. 大模型使用

#### 模型功能选择

* 屏幕截取需要Vision，外部工具调用需要Tool Calling和MCP（比如tool_calls.mcp），大量信息总结归纳需要长上下文（比如日报），特殊场景需要推理模型（Thinking）。
* 成本考虑，需要支持多个模型，比如考虑一些flash模型。利用模型厂商的 Context Caching 功能，让这些静态 Context 只计算一次，后续请求成本降低 90%。
* 隐私数据处理，或一些预处理场景（意图识别），本地需要一个3B-8B 的小模型来处理隐私敏感数据的预处理。
* 支持OpenAI接口的usages功能来计算费用。
* 使用bulk API（批量的API）能减少这个大模型的使用费用的API能减少这个大模型的使用费用

支持多功能模型。
支持纯文本模型，比如xxx。
支持纯文本 + tool calling 模型，比如DeepSeek-v3.2.
支持纯vision模型，OCR
支持vision + tool calling （GLM-4.6v（flash），doubao-1.6-flash）
是否支持thinking模式

文本，

要考虑将来大模型的API可能分道扬镳，目前看到的是OpenAI API, Anthropic API, Gemini API。

re-ranker模型，对从向量数据库选择出来的数据进行reranker。

#### 智能模型路由

**短期**
只需要支持OpenAI API来支持1）vision大模型来读取屏幕内容，2）长上下文的大模型来做总结。3） Embedding 模型来做向量存储。

**中长期**
更多细节参考[smart_llm_router.md](./designs/smart_llm_router.md)

* 智能路由与编排层 (The Orchestration Layer)

    从多种模型（Vision, Flash, Long-context, Thinking models）中选择，核心挑战在于如何动态选择，而不是硬编码。

* 意图识别网关 (Intent Gateway / Router)：需要一个极低延迟的小模型（如 gemini-2.0-flash-lite 或微调过的 Llama-3-8B）作为入口。

    任务：分析用户Query的复杂度和类型。
    例子：用户问“帮我总结这篇论文”，路由到长文本模型；用户问“我有几封未读邮件”，路由到MCP工具调用模型；用户问“帮我规划这周的复杂行程”，路由到 Thinking (CoT) 模型。

* 降级策略 (Fallback Mechanism)：

    当首选模型（如 MCP 调用失败或 API 超时）不可用时，是否有备选方案？

    设计：如果 Deep Research Agent 卡住，是否能自动降级为简单的 Google Search 并返回部分结果？


#### 费用计算
不知道token的使用情况，如何能省token，是不是要分几个段位，是不是要能自动计算费用，加入费率信息存储（比如豆包flash是token费率，硅基流动某个模型费率是多少）

使用openai API的usage接口，比如GLM的usage接口描述：https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8#response-usage

## 2. 高级记忆架构：超越向量 (Beyond Vector Search)

—— 仅仅“存下来”是不够的，关键是“找回关系”。

你提到了向量数据库和SQL。但在处理个人数据（MineContext 场景）时，单纯的相似度检索（Vector Search）往往不够精准。

### 混合检索 (Hybrid Search)

必须考虑：BM25（关键词匹配）+ Embedding（语义匹配）+ Metadata Filtering（时间/来源过滤）。

场景：用户搜“上周发的发票”，"发票"是语义，"上周"是强元数据过滤。

### 分层索引 (Hierarchical Indexing)

针对长文档（如书籍、长会议记录），不要只存切片。要存“文档摘要索引” -> “章节摘要索引” -> “正文切片索引”。检索时先通过摘要定位，再深入切片，提高准确率。

### GraphRAG (知识图谱增强检索)

痛点：向量检索擅长找“相似”，但不擅长找“关系”。例如“我和David在哪个项目上合作过？”，向量可能只找到包含David的文档，而图谱能找到 Me --[worked_on]--> Project X <--[worked_on]-- David 的路径。

方案：需要引入图数据库（如 Neo4j），将非结构化文本转化为实体关系图。

**核心推荐：KùzuDB**
这是目前 AI 工程界非常受关注的“图版 SQLite”。

特点：
* 深度集成：专门为 GraphRAG 和 GNN（图神经网络）设计，支持向量索引。
* 零运维：它是嵌入式的，C++编写，Python 绑定极佳，数据作为一个文件夹存在本地。
* 标准支持：支持 Cypher 查询语言（Neo4j 的查询语言），迁移成本低。
* 性能：列式存储，分析性能极强，非常适合做大规模实体的多跳查询。
* 适用场景：Python 全栈环境，需要快速验证 GraphRAG 逻辑，不想折腾 Docker 和 Java 环境。
* 生态位：LangChain 和 LlamaIndex 都已经对其提供了原生支持。

**GraphRAG MVP 架构如下：**

* ETL 层：使用 LangChain 或 LlamaIndex 的 KnowledgeGraphIndex。
    * LLM：本地 Ollama (Llama 3 / Mistral) 或 API。
    * 抽取逻辑：非结构化文本 -> (Subject, Predicate, Object) 三元组。
* 存储层：首选 KùzuDB。
    * 理由：代码即架构，不需要额外部署服务，Git Clone 下来就能跑，非常适合 MVP 分享和演示。
* 检索层：混合检索（Hybrid Search）。
    * Vector：找相似语义（Top-K）。
    * Graph：找多跳关系（Cypher 查询，例如 2-hop neighbors）。
    * Rerank：将两者结果合并重排序。



## 3. 工具延伸
MCP (Model Context Protocol) 的深层集成

—— 让工具不仅仅是“API调用”，而是“有状态的操作”。

鉴权透传 (Auth Pass-through)：

难点：当 Agent 替用户登录收费网站或读取私有 GitHub 仓库时，如何安全管理 OAuth Token？

设计：Token 加密存储，仅在 MCP Server 运行时动态注入，确保 Agent 即使被注入攻击也无法明文获取 Token。

人机协同中断 (Human-in-the-Loop Interrupts)：

场景：Deep Research 过程中，Agent 发现需要付费或是需要验证码。

机制：MCP 协议需要支持“挂起”状态，推送通知给用户，用户在前端操作后，Agent 能从断点继续运行（Resumable State）。

沙箱环境 (Sandboxing)：

如果你允许运行 Python 代码进行数据分析，必须确保代码在隔离的 Docker 容器或 WebAssembly (WASM) 环境中运行，防止恶意代码读取服务器文件。


## 4. 界面设计

界面不够美观。（settings不紧凑，）
如何能只记录特定屏幕或特定程序窗口？比如MineContext
黑屏的时候不录屏。
idle的时候不录屏。

### 场景模型
快速选择场景，相应全局设置自动进入相应配置（比如模型选择，上下文长度，抓屏间隔等等。），可以手动选择，AI也能通过识别后自动选择，不过会要用户确认，自动功能可关闭。
场景有：
* 阅读场景: 广泛阅读，在多个网页中跳转，阅读新闻，博客，得到，论文，知乎，x.com,抖音，小红书等。
* 工作场景: 在工作软件中工作，比如excel，ppt，word，邮件，日历，任务列表等。
* 写代码场景: 在代码编辑器中写代码，比如vscode，pycharm，idea等。
* 会议场景: 在会议软件中开会，比如zoom，腾讯会议，钉钉等。
* 静默时间（不允许弹出提醒）
* 无痕模式（不做记录，只做纯粹的通用AI chatbot?）

用户定义子场景：
当用户在多个固定界面跳转的情况下，大模型可能会误判用户分心了，但是其实用户在为同一个事情在收集材料信息。那么用户可以定义一个子场景，比如“收集材料信息”，然后AI就会知道用户在做什么事情。

### 知识库
知识库来源：
* 随手心得，网页，pdf，txt，ppt，excel，word，图片，视频，音频，代码，邮件，日志，聊天记录，任务列表，

### 日报
根据前一天的信息，自动生成日报。
信息来源：
* 昨天的抓屏总结
* 昨天的新增知识库信息
* 昨天的任务列表 

### AI助手

记住用户的个人特征（用户录入， AI自己总结，用户可以修改）
帮助用户做日常的事情（比如读新闻，去指定网站看博客， 看视频， 看论文， 看知乎， 看x.com， 看抖音， 看小红书等）
搜集用户可能感兴趣的信息（网络搜索）：用户输入关键字，AI助手后台搜索，搜完生成报告并通知用户。

### 图像识别

**能不能只记录当前处于鼠标激活的window？**

**能不能只抓拍关键帧？**

比如用一个本地的小模型来识别抓取的屏幕之间的变化，从而抓取关键帧，比如前面5个屏幕基本不变，暗示用户在某个界面上持续做一件事，那么第6个屏幕如果变化了，那么第5个屏幕就是关键帧，因为在切换为别的屏幕之前，这个屏幕上能获得所有用户阶段性地做完的事情的信息。（和大模型讨论一下）





### 更多输入的来源

* 对语音输入做一个长期背景式的长期监测，并阶段性做总结。
* 可以增加打开摄像头对摄像头的输入进行一个记录来记录当前用户的一段时间的状态，工作状态增加打开摄像头对摄像头的输入进行一个记录来记录当前一段时间的工作状态。


## 5. 评估体系 (Evals & Observability)
—— 你怎么知道 AI 总结得对不对？

### LLM-as-a-Judge (AI 裁判)：

建立一套“黄金数据集”。每次模型升级或 Prompt 修改后，用更强的模型（如 GPT-4o 或 Claude 3.5 Sonnet）来给小模型的输出打分。

### 全链路追踪 (Full-stack Tracing)：

使用工具（如 LangSmith, LangFuse）追踪一个复杂任务的完整调用链。

监控指标：不仅是 Latency 和 Token Usage，更要监控“MCP 工具调用成功率”和“RAG 检索相关性分数”。


### 用户反馈
加入一个功能，就是用户在用了一段时间以后要求当前大模型前面这段时间的在做什么事情进行总结，然后用户对这个进行评估，比如说之前AI认为他前面10分钟在写代码，但其实他用户是在浏览网页，那这时候用户就会对这个AI作者总结进行进行负面评价，但如果用户确实是在做代码工作，那么用户就会对这个AI的输出进行点赞。通过收集用户对AI的结果的评价，我们就可以对这个这个的这个功能进行一个整体的评价（信息包括模型名，实际场景信息，AI的输出，用户评价（点赞或点踩））


### 后台工作队列。
用户需要AI助手可以在后台帮做的事情： 
1. 解答问题（1、快速解答，2、fast research，3. Deep Research，4. llm 专家组高质量回答）
2. 拆解论文，生成ppt（paper2slide），生成闪卡，生成信息图 （类似NotebookLM），可以对接不同开源项目在沙盒中运行（sandbox，docker或VM）
3. 点子收集 -> 点子发芽 （开源项目，Deep Research，知识库扩展， Knowledge RAG）
4. 日常固定事件：喝水，休息，按摩眼睛，起身活动等。

## 6. 隐私与合规 (Privacy & Compliance)

—— 信任是此类产品的基石。

* PII 自动脱敏 (PII Redaction)：
    * 在数据发送给云端 LLM 之前，在本地或网关层运行一个轻量级 NER 模型，将手机号、邮箱、身份证号替换为 [PHONE_NUMBER] 等占位符。

* 遗忘权 (The Right to be Forgotten)：
    * 从技术上设计“数据删除”接口。当用户说“忘了这件事”时，系统能精准定位到对应的 Vector Chunk 和 Graph Node 并物理删除，而不仅仅是标记隐藏。


## 7. 数据存储相关

### 7.1 数据迁移

我设计思路：

```markdown
我在想Default User Data和Bootstrap file的缺省值的合理性，在用户第一次打开程序时，可以通过Wizard界面强制要求用户输入存储路径，而不是使用default值.
后期用户如何想要修改存储路径，我们程序必须提示用户相应的风险，但是这里做数据migration有两种方式：
1. 用户确认后立即停止任何后台行为（包括但不限于录制行为等等），并开始做data migration pre-check（包括测试新目录是否可以访问，是否已有数据，是否空间足够等等），pre-check成功后，开始做data migration，显示精度条，过程中提示用户不要退出程序，并禁止用户使用退出功能，但是过程中用户可以
1） 取消data migration，新目录里的数据会被清除，成功后，程序继续使用原目录运行。Settings上存储的目录信息保持不变。
2） 如果用户强行退出（比如用taskmgr），重新开启程序会自动继续使用原来的存储位置，不受影响，但是部分已经migration到新路基的数据需要用户手动清理。

2. 用户确认data migration会强行退出当前程序后，程序会做标记。这样程序在重启后根据标记开始进行data migration（包括提示用户是否可以开始data migration，用户同意后开始，然后先做pre-check，再开始data migration，显示精度条，过程中提示用户不要退出程序）。但是过程中用户也可以
1）在程序询问时，直接取消。程序继续使用原目录运行。Settings上存储的目录信息保持修改前的信息。
1）在data migration 过程中取消data migration，新目录里的数据会被清除，成功后，程序继续使用原目录运行。Settings上存储的目录信息保持修改前的信息。
2)  强行退出（比如用taskmgr），重新开启程序会自动继续使用原来的存储位置，不受影响，但是部分已经migration到新路基的数据需要用户手动清理，用户可以进入Settings里面重新设置新目录。

看起来第二种方案更简单，因为不需要停止任何后台行为，只在程序重启后，所有后台程序启动前开始即可，而且用户取消也影响很小，程序可以继续进入正常运行状态。
```


### 7.2 数据备份


### 7.3 数据清除 （retention policy）


### 7.4 数据导入导出

### 7.5 高级功能
数据加密
数据压缩
数据同步    
数据备份
数据访问控制
据权限控制
数据版本控制
数据审计

数据恢复







## 待改进项 (非紧急)
Storage Overview 统计数据是占位符 → 数值 24.5 MB, 1.2 GB, 15,420 是硬编码的。未来可实现真实的 IPC 查询。

Reset Database 按钮只是模拟 → 目前点击后只有 2 秒假等待，没有实际清理数据库的 IPC 调用。

支持i8n，中英文切换。