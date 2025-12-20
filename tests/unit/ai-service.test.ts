import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AIService } from '../../src/services/ai/openai'

// Properly mock OpenAI as a class
vi.mock('openai', () => {
    const MockOpenAI = vi.fn().mockImplementation(function () {
        return {
            models: {
                list: vi.fn().mockResolvedValue({ data: [{ id: 'gpt-4o' }] })
            },
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        choices: [{ message: { content: 'Test response' } }]
                    })
                }
            }
        }
    })
    return { default: MockOpenAI }
})

describe('AIService', () => {
    let service: AIService

    beforeEach(() => {
        service = new AIService()
    })

    describe('configure', () => {
        it('should configure the client with apiKey and baseURL', () => {
            expect(() => {
                service.configure('test-api-key', 'https://api.example.com/v1')
            }).not.toThrow()
        })
    })

    describe('checkConnection', () => {
        it('should return false when not configured', async () => {
            const result = await service.checkConnection()
            expect(result).toBe(false)
        })

        it('should return true when configured and API responds', async () => {
            service.configure('test-api-key', 'https://api.example.com/v1')
            const result = await service.checkConnection()
            expect(result).toBe(true)
        })
    })

    describe('generateSummary', () => {
        it('should throw error when not configured', async () => {
            await expect(service.generateSummary('/path/to/image')).rejects.toThrow('AI Service not configured')
        })

        it('should return response content when configured', async () => {
            service.configure('test-api-key', 'https://api.example.com/v1')
            const result = await service.generateSummary('/path/to/image')
            expect(result).toBe('Test response')
        })
    })
})
