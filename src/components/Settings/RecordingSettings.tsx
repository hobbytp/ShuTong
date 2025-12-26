import { Camera, Clock, Eye, EyeOff, Gauge, HardDrive, Layers, Monitor, Play, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from './Shared';

interface RecordingConfig {
    capture_interval_ms: number;
    capture_resolution: string;
    capture_quality: number;
    capture_screen_index: number;
    capture_mode: 'screen' | 'window';
    auto_start_recording: boolean;
    excluded_apps: string[];
    excluded_title_patterns: string[];
    min_disk_space_gb: number;
    // Smart Capture Guard
    guard_idle_threshold: number;
    guard_enable_idle_detection: boolean;
    guard_enable_lock_detection: boolean;
    guard_debounce_ms: number;
    // Frame Deduplication
    dedup_enable: boolean;
}

const RESOLUTION_OPTIONS = [
    { value: '1920x1080', label: '1920×1080 (Full HD)' },
    { value: '1280x720', label: '1280×720 (HD)' },
    { value: '2560x1440', label: '2560×1440 (QHD)' },
    { value: '3840x2160', label: '3840×2160 (4K)' },
];

const CAPTURE_MODE_OPTIONS = [
    { value: 'screen', label: 'Full Screen', description: 'Capture entire screen' },
    { value: 'window', label: 'Active Window', description: 'Capture only the focused window' },
];


export function RecordingSettings() {
    const [config, setConfig] = useState<RecordingConfig>({
        capture_interval_ms: 1000,
        capture_resolution: '1920x1080',
        capture_quality: 60,
        capture_screen_index: 0,
        capture_mode: 'screen',
        auto_start_recording: false,
        excluded_apps: [],
        excluded_title_patterns: [],
        min_disk_space_gb: 1,
        guard_idle_threshold: 30,
        guard_enable_idle_detection: true,
        guard_enable_lock_detection: true,
        guard_debounce_ms: 2000,
        dedup_enable: true,
    });
    const [screens, setScreens] = useState<{ id: number; name: string }[]>([]);
    const [excludedAppsText, setExcludedAppsText] = useState('');
    const [excludedPatternsText, setExcludedPatternsText] = useState('');
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

    useEffect(() => {
        loadConfig();
    }, []);

    useEffect(() => {
        if (saveState === 'saved') {
            const timer = setTimeout(() => setSaveState('idle'), 2000);
            return () => clearTimeout(timer);
        }
    }, [saveState]);

    const loadConfig = async () => {
        if (!window.ipcRenderer) return;

        // 1. Load Settings (Critical)
        try {
            const settings = await window.ipcRenderer.invoke('get-settings');

            // Safe parsing helper
            const safeParse = (json: string, fallback: any) => {
                try {
                    return json ? JSON.parse(json) : fallback;
                } catch (e) {
                    console.warn('Failed to parse setting:', e);
                    return fallback;
                }
            };

            setConfig({
                capture_interval_ms: parseInt(settings.capture_interval_ms) || 1000,
                capture_resolution: settings.capture_resolution || '1920x1080',
                capture_quality: parseInt(settings.capture_quality) || 60,
                capture_screen_index: parseInt(settings.capture_screen_index) || 0,
                capture_mode: (settings.capture_mode as 'screen' | 'window') || 'screen',
                auto_start_recording: settings.auto_start_recording === 'true',
                excluded_apps: safeParse(settings.excluded_apps, []),
                excluded_title_patterns: safeParse(settings.excluded_title_patterns, []),
                min_disk_space_gb: parseFloat(settings.min_disk_space_gb) || 1,
                guard_idle_threshold: parseInt(settings.guard_idle_threshold) || 30,
                guard_enable_idle_detection: settings.guard_enable_idle_detection !== 'false',
                guard_enable_lock_detection: settings.guard_enable_lock_detection !== 'false',
                guard_debounce_ms: parseInt(settings.guard_debounce_ms) || 2000,
                dedup_enable: settings.dedup_enable !== 'false',
            });

            setExcludedAppsText(safeParse(settings.excluded_apps, []).join('\n'));
            setExcludedPatternsText(safeParse(settings.excluded_title_patterns, []).join('\n'));
        } catch (err) {
            console.error('Failed to load recording config:', err);
        }

        // 2. Load Screens (Optional / Progressive)
        try {
            const screenList = await window.ipcRenderer.invoke('get-available-screens');
            setScreens(screenList || [{ id: 0, name: 'Primary Display' }]);
        } catch (err) {
            console.warn('Failed to get screens, defaulting to Primary:', err);
            setScreens([{ id: 0, name: 'Primary Display' }]);
        }
    };

    const updateSetting = async (key: keyof RecordingConfig, value: any) => {
        // Optimistic update
        setConfig(prev => ({ ...prev, [key]: value }));
        setSaveState('saving');

        if (window.ipcRenderer) {
            try {
                const storageValue = typeof value === 'boolean' ? String(value) :
                    Array.isArray(value) ? JSON.stringify(value) : String(value);
                await window.ipcRenderer.invoke('set-setting', key, storageValue);
                setSaveState('saved');
            } catch (err) {
                console.error('Failed to save setting:', err);
                setSaveState('idle'); // Or error state if we had one
            }
        }
    };

    const handleExcludedAppsChange = async (text: string) => {
        setExcludedAppsText(text);
        const apps = text.split('\n').map(s => s.trim()).filter(Boolean);
        await updateSetting('excluded_apps', apps);
    };

    const handleExcludedPatternsChange = async (text: string) => {
        setExcludedPatternsText(text);
        const patterns = text.split('\n').map(s => s.trim()).filter(Boolean);
        await updateSetting('excluded_title_patterns', patterns);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Capture Settings */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-zinc-100 mb-6 flex items-center gap-2">
                    <Camera size={20} className="text-indigo-400" />
                    Capture Settings
                </h3>

                <div className="space-y-6">
                    {/* Capture Interval */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-indigo-500/10 rounded-lg">
                                <Clock size={18} className="text-indigo-400" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Capture Interval</div>
                                <div className="text-xs text-zinc-500">How often to take screenshots</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 w-1/2 justify-end">
                            <input
                                type="range"
                                min="1"
                                max="300"
                                step="1"
                                value={config.capture_interval_ms / 1000}
                                onChange={(e) => updateSetting('capture_interval_ms', parseInt(e.target.value) * 1000)}
                                className="w-48 accent-indigo-500"
                            />
                            <span className="text-sm font-mono text-zinc-400 w-16 text-right">
                                {config.capture_interval_ms < 60000
                                    ? `${config.capture_interval_ms / 1000}s`
                                    : `${Math.floor(config.capture_interval_ms / 60000)}m ${((config.capture_interval_ms % 60000) / 1000).toFixed(0)}s`}
                            </span>
                        </div>
                    </div>

                    {/* Capture Mode */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-violet-500/10 rounded-lg">
                                <Layers size={18} className="text-violet-400" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Capture Mode</div>
                                <div className="text-xs text-zinc-500">Choose what to capture</div>
                            </div>
                        </div>
                        <div className="w-48">
                            <select
                                value={config.capture_mode}
                                onChange={(e) => updateSetting('capture_mode', e.target.value)}
                                className="w-full appearance-none bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                            >
                                {CAPTURE_MODE_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Screen Selection - Only shown in screen mode */}
                    {config.capture_mode === 'screen' && (
                        <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-emerald-500/10 rounded-lg">
                                    <Monitor size={18} className="text-emerald-400" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-zinc-200">Screen to Capture</div>
                                    <div className="text-xs text-zinc-500">Select which display to record</div>
                                </div>
                            </div>
                            <div className="w-48">
                                <select
                                    value={String(config.capture_screen_index)}
                                    onChange={(e) => updateSetting('capture_screen_index', parseInt(e.target.value))}
                                    className="w-full appearance-none bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                                >
                                    {screens.map((s, i) => (
                                        <option key={i} value={String(i)}>{s.name || `Display ${i + 1}`}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Resolution */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-amber-500/10 rounded-lg">
                                <Gauge size={18} className="text-amber-400" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Capture Resolution</div>
                                <div className="text-xs text-zinc-500">Maximum resolution for screenshots</div>
                            </div>
                        </div>
                        <div className="w-48">
                            <select
                                value={config.capture_resolution}
                                onChange={(e) => updateSetting('capture_resolution', e.target.value)}
                                className="w-full appearance-none bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                            >
                                {RESOLUTION_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Quality */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-rose-500/10 rounded-lg">
                                <Eye size={18} className="text-rose-400" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-zinc-200">JPEG Quality</div>
                                <div className="text-xs text-zinc-500">Higher = better quality, larger files (1-100)</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                min="10"
                                max="100"
                                step="5"
                                value={config.capture_quality}
                                onChange={(e) => updateSetting('capture_quality', parseInt(e.target.value))}
                                className="w-32 accent-indigo-500"
                            />
                            <span className="text-sm font-mono text-zinc-400 w-10">{config.capture_quality}%</span>
                        </div>
                    </div>

                    {/* Auto Start */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-cyan-500/10 rounded-lg">
                                <Play size={18} className="text-cyan-400" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Auto-Start Recording</div>
                                <div className="text-xs text-zinc-500">Start recording when app launches</div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={config.auto_start_recording}
                                onChange={(e) => updateSetting('auto_start_recording', e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>

                    {/* Min Disk Space */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-orange-500/10 rounded-lg">
                                <HardDrive size={18} className="text-orange-400" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Minimum Disk Space</div>
                                <div className="text-xs text-zinc-500">Stop recording when disk space falls below this</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-20">
                                <Input
                                    type="number"
                                    min="0.5"
                                    step="0.5"
                                    value={String(config.min_disk_space_gb)}
                                    onChange={(e) => updateSetting('min_disk_space_gb', parseFloat(e.target.value))}
                                />
                            </div>
                            <span className="text-sm text-zinc-500">GB</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Smart Capture Guard */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-zinc-100 mb-6 flex items-center gap-2">
                    <Shield size={20} className="text-blue-400" />
                    Smart Capture Guard
                </h3>

                <div className="space-y-6">
                    {/* Idle Detection */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div>
                                <div className="text-sm font-medium text-zinc-200">System Idle Threshold</div>
                                <div className="text-xs text-zinc-500">Pause recording after seconds of inactivity</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-20">
                                <Input
                                    type="number"
                                    min="5"
                                    max="300"
                                    step="5"
                                    value={String(config.guard_idle_threshold)}
                                    onChange={(e) => updateSetting('guard_idle_threshold', parseInt(e.target.value))}
                                />
                            </div>
                            <span className="text-sm text-zinc-500">sec</span>
                        </div>
                    </div>

                    {/* Idle Detection Toggle */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Pause When Idle</div>
                                <div className="text-xs text-zinc-500">Skip captures when system is inactive</div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={config.guard_enable_idle_detection}
                                onChange={(e) => updateSetting('guard_enable_idle_detection', e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>

                    {/* Lock Screen Detection */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Pause on Lock Screen</div>
                                <div className="text-xs text-zinc-500">Automatically pause when screen is locked or sleeping</div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={config.guard_enable_lock_detection}
                                onChange={(e) => updateSetting('guard_enable_lock_detection', e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>

                    {/* Window Switch Debounce */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Window Switch Delay</div>
                                <div className="text-xs text-zinc-500">Wait before capturing new active window (avoids Alt+Tab spam)</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-24">
                                <Input
                                    type="number"
                                    min="0"
                                    max="5000"
                                    step="100"
                                    value={String(config.guard_debounce_ms)}
                                    onChange={(e) => updateSetting('guard_debounce_ms', parseInt(e.target.value))}
                                />
                            </div>
                            <span className="text-sm text-zinc-500">ms</span>
                        </div>
                    </div>

                    {/* Similar Frame Deduplication */}
                    <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-4">
                            <div>
                                <div className="text-sm font-medium text-zinc-200">Skip Similar Frames</div>
                                <div className="text-xs text-zinc-500">Avoid storing redundant screenshots when screen is static</div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={config.dedup_enable}
                                onChange={(e) => updateSetting('dedup_enable', e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>
                </div>
            </div>

            {/* Privacy Filters */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-zinc-100 mb-6 flex items-center gap-2">
                    <EyeOff size={20} className="text-emerald-400" />
                    Privacy Filters
                </h3>

                <div className="space-y-6">
                    {/* Excluded Apps */}
                    <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-2 mb-3">
                            <EyeOff size={16} className="text-zinc-400" />
                            <span className="text-sm font-medium text-zinc-200">Excluded Applications</span>
                        </div>
                        <p className="text-xs text-zinc-500 mb-3">
                            Recording will pause when these applications are in focus (one per line)
                        </p>
                        <textarea
                            value={excludedAppsText}
                            onChange={(e) => handleExcludedAppsChange(e.target.value)}
                            placeholder="e.g.&#10;1Password&#10;KeePass&#10;Bitwarden"
                            rows={4}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                        />
                    </div>

                    {/* Excluded Window Title Patterns */}
                    <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-2 mb-3">
                            <EyeOff size={16} className="text-zinc-400" />
                            <span className="text-sm font-medium text-zinc-200">Excluded Window Titles</span>
                        </div>
                        <p className="text-xs text-zinc-500 mb-3">
                            Recording will pause when window title contains these keywords (one per line)
                        </p>
                        <textarea
                            value={excludedPatternsText}
                            onChange={(e) => handleExcludedPatternsChange(e.target.value)}
                            placeholder="e.g.&#10;Password&#10;密码&#10;Credential&#10;Private"
                            rows={4}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                        />
                    </div>
                </div>
            </div>
            {/* Save Toast */}
            <div className={`fixed bottom-8 right-8 flex items-center gap-2 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-full shadow-lg transition-all duration-300 ${saveState === 'idle' ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'}`}>
                {saveState === 'saving' ? (
                    <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                    <div className="w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3 text-zinc-900">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>
                )}
                <span className="text-sm font-medium text-zinc-200">
                    {saveState === 'saving' ? 'Saving changes...' : 'Changes saved'}
                </span>
            </div>
        </div>
    );
}
