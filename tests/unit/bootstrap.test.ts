import { app } from 'electron';
import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCustomUserDataPath, resolveUserDataPath, setCustomUserDataPath } from '../../electron/bootstrap';

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn((name) => {
            if (name === 'appData') return '/mock/appData';
            if (name === 'userData') return '/mock/userData';
            return '/mock';
        }),
        name: 'shutong',
        setPath: vi.fn()
    }
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn()
    },
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
}));

describe('Bootstrap Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null if bootstrap file missing', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        expect(getCustomUserDataPath()).toBeNull();
    });

    it('should return path if bootstrap file exists', () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            if (p.toString().endsWith('bootstrap.json')) return true;
            return true;
        });
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ userDataPath: '/custom/path' }) as any);
        expect(getCustomUserDataPath()).toBe('/custom/path');
    });

    it('should set custom path in bootstrap file', () => {
        setCustomUserDataPath('/new/path');
        expect(fs.writeFileSync).toHaveBeenCalled();
        const call = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(JSON.parse(call[1] as string)).toEqual({ userDataPath: '/new/path' });
    });

    it('should redirect app userData path if config exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ userDataPath: '/custom/path' }) as any);

        resolveUserDataPath();
        expect(app.setPath).toHaveBeenCalledWith('userData', '/custom/path');
    });
});
