import OpenAI from 'openai';

export class AIService {
  private client: OpenAI | null = null;

  configure(apiKey: string, baseURL: string) {
    this.client = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL,
      dangerouslyAllowBrowser: true // Electron renderer is a browser environment
    });
  }

  async generateSummary(_imagePath: string): Promise<string> {
    if (!this.client) throw new Error('AI Service not configured');

    try {
      // TODO: Implement vision request with image
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o', // Default, should be configurable
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Test connection.' }
        ],
      });
      return response.choices[0].message.content || 'No response';
    } catch (error) {
      console.error('AI Request failed:', error);
      throw error;
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.models.list();
      return true;
    } catch (e) {
      return false;
    }
  }
}

export const aiService = new AIService();
