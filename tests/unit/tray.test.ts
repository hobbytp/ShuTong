import { app } from 'electron'; // Import mocked app directly
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Electron
const mockSetContextMenu = vi.fn()
const mockSetToolTip = vi.fn()
const mockMenuBuild = vi.fn()

vi.mock('electron', () => {
    return {
        // Arrow functions cannot be constructors, so we use a standard function
        Tray: vi.fn().mockImplementation(function () {
            return {
                setContextMenu: mockSetContextMenu,
                setToolTip: mockSetToolTip,
                on: vi.fn(),
            }
        }),
        Menu: {
            buildFromTemplate: vi.fn().mockImplementation((template) => {
                mockMenuBuild(template)
                return 'MOCK_MENU'
            })
        },
        nativeImage: {
            createFromPath: vi.fn()
        },
        app: {
            emit: vi.fn(),
            quit: vi.fn()
        }
    }
})

// Set env var for testing
process.env.VITE_PUBLIC = './public'

// Mock event bus with hoisted variable
const mocks = vi.hoisted(() => {
    return { mockEmitEvent: vi.fn() }
})

vi.mock('../../electron/infrastructure/events', () => ({
    eventBus: {
        emitEvent: mocks.mockEmitEvent
    }
}))

// Import after mock and env setup
import { setupTray, updateTrayMenu } from '../../electron/tray';

describe('Tray Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setupTray(vi.fn())
    })

    it('should show "Start Recording" when idle', () => {
        updateTrayMenu(vi.fn(), false)

        expect(mockMenuBuild).toHaveBeenCalled()
        const template = mockMenuBuild.mock.calls[0][0]
        const recordItem = template.find((item: any) => item.label && item.label.includes('Recording'))

        expect(recordItem.label).toBe('Start Recording')
    })

    it('should show "Stop Recording" when recording', () => {
        updateTrayMenu(vi.fn(), true)

        const template = mockMenuBuild.mock.calls[1][0]
        const recordItem = template.find((item: any) => item.label && item.label.includes('Recording'))

        expect(recordItem.label).toBe('Stop Recording')
    })

    it('should quit app when Quit clicked', () => {
        // Reset mocks by clearing
        mockMenuBuild.mockClear()

        updateTrayMenu(vi.fn(), false)

        const template = mockMenuBuild.mock.calls[0][0]
        const quitItem = template.find((item: any) => item.label === 'Quit')

        quitItem.click()
        expect(app.quit).toHaveBeenCalled()
    })

    it('should emit toggle command when Record clicked', () => {
        mockMenuBuild.mockClear()
        mocks.mockEmitEvent.mockClear()

        // Provide a mock window so the click handler proceeds
        const mockWin = { show: vi.fn(), focus: vi.fn() }
        updateTrayMenu(() => mockWin as any, false)

        const template = mockMenuBuild.mock.calls[0][0]
        const recordItem = template.find((item: any) => item.label && item.label.includes('Recording'))

        recordItem.click()
        expect(mocks.mockEmitEvent).toHaveBeenCalledWith('command:toggle-recording', undefined)
    })
})
