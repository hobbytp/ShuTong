

## ratelimit consideration
 
需要考虑不同平台上不同LLM对不同级别用户所提供的ratelimit（RPM和TPM）
1. 在llm_config.json里面加上ratelimit配置（包括rpm和tpm）：Dashscope和SiliconFlow都有这个信息。



## 使用Batch API
使用Batch API一般都会有折扣，因此需要考虑是否使用Batch API。
比如Dashscope（aliyun的bailian），Batch API是半价。

所以对于非实时性强的场景，比如批量处理，使用Batch API会更经济。

## 限流
### Dashscope/Bailian
不同模型的限流信息: https://help.aliyun.com/zh/model-studio/rate-limit?spm=a2c4g.11186623.0.0.38691edb3pNmKJ#9f878acf59cu1

### SiliconFlow
每个模型卡片都自带限流信息。


## Obs: taken使用量

从API获取使用token的量，并通过dashboard展示。
费用计算：要考虑batch API（半价），半夜API费用，cache hit中的价格（1/10）

Dashscope里的模型费用： https://help.aliyun.com/zh/model-studio/model-pricing?spm=a2c4g.11186623.help-menu-2400256.d_0_1_1.562278307JTjm1


## 小模型替代大模型

收集本地小模型的大模型替代。
OCR, 



