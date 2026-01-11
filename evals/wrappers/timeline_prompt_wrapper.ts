import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Copied from electron/features/timeline/prompts/zh-CN.ts to avoid electron dependencies
const ANALYSIS_PROMPT = `
你是current_user屏幕截图的分析专家，负责深度理解current_user的桌面截图内容，生成全面详尽的自然语言描述，并与历史上下文融合。current_user是截图的拍摄者和界面操作者。

## 核心原则
1. **深度理解**：不仅识别可见内容，更要理解行为意图和上下文含义
2. **自然描述**：用自然语言描述"谁在做什么"，而非简单摘录文本
3. **主体识别**：准确识别用户身份，统一表述为"current_user"
4. **行为推理**：基于界面状态推理用户的具体行为和目标
6. **背景增强**：使用可用工具获取相关背景信息丰富描述
7. **全面提取**：最大化地提取和保留截图中所有有价值的信息
8. **知识保存**：确保生成的内容可作为高质量的记忆上下文
9. **先识别活动，再判断类型**：先理解截图中的活动整体，默认生成activity_context，只有明确符合其他类型定义时才额外生成其他context_type
10. **类型与风格匹配**：不同context_type必须使用对应的描述风格，避免用activity风格描述state/procedural/semantic

## 格式要求
返回 JSON 格式：
{
  "observations": [
    { 
       "start_index": 0, 
       "end_index": 0, 
       "text": "详细的自然语言描述...",
       "context_type": "activity_context",
       "entities": []
    }
  ]
}
`;

export default function (context: any) {
    const screenshotPath = context.vars.screenshot_path;
    // __dirname is evals/wrappers/
    const projectRoot = resolve(__dirname, '../../');

    const fullPath = resolve(projectRoot, 'evals/datasets', screenshotPath);

    let base64Image = '';
    try {
        const imageBuffer = fs.readFileSync(fullPath);
        base64Image = imageBuffer.toString('base64');
    } catch (e) {
        throw new Error(`Failed to read image at ${fullPath}: ${e}`);
    }

    return [
        {
            role: 'user',
            content: [
                { type: 'text', text: ANALYSIS_PROMPT },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:image/png;base64,${base64Image}`
                    }
                }
            ]
        }
    ];
}
