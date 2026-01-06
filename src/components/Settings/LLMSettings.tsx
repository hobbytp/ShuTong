
import { AlertCircle, Check, Download, Eye, EyeOff, Loader2, RotateCcw, Save, Terminal, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Button, Input, Label, Select } from './Shared';

// --- Types ---
interface ProviderConfig {
    apiBaseUrl: string;
    apiKeyEnv: string;
    hasKey: boolean;
    apiKey: string;
    models: Record<string, any>;
}

interface RoleConfig {
    provider: string;
    model: string;
    temperature: number;
    description: string;
}

interface LLMConfig {
    providers: Record<string, ProviderConfig>;
    roleConfigs: Record<string, RoleConfig>;
}

export function LLMSettings() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<LLMConfig | null>(null);
    const [activeSubTab, setActiveSubTab] = useState<'providers' | 'roles' | 'config'>('providers');
    const [toastState, setToastState] = useState<'idle' | 'saved'>('idle');

    useEffect(() => {
        loadConfig();
    }, []);

    useEffect(() => {
        if (toastState === 'saved') {
            const timer = setTimeout(() => setToastState('idle'), 2000);
            return () => clearTimeout(timer);
        }
    }, [toastState]);

    const showSavedToast = () => setToastState('saved');

    const loadConfig = async () => {
        if (window.ipcRenderer) {
            const cfg = await window.ipcRenderer.invoke('get-llm-config');
            setConfig(cfg);
        } else {
            console.warn('Browser environment: ipcRenderer not found. Mocking empty config.');
            setConfig({ providers: {}, roleConfigs: {} });
        }
    };

    const handleProviderUpdate = async (name: string, data: { baseUrl?: string, apiKey?: string }) => {
        if (window.ipcRenderer) {
            await window.ipcRenderer.invoke('set-llm-provider-config', name, data);
            loadConfig();
        }
    };

    const handleRoleUpdate = async (role: string, data: { provider?: string, model?: string, temperature?: number }) => {
        if (window.ipcRenderer) {
            await window.ipcRenderer.invoke('set-role-config', role, data);
            await loadConfig();
        }
    };

    if (!config) return (
        <div className="flex items-center justify-center h-48 text-zinc-500 gap-2">
            <Loader2 className="animate-spin" size={16} />
            {t('llm.loading_config', 'Loading Configuration...')}
        </div>
    );

    const providers = Object.entries(config.providers || {});
    const roles = Object.entries(config.roleConfigs || {});

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Sub-tabs */}
            <div className="flex gap-2 border-b border-zinc-800 pb-1">
                {[
                    { id: 'providers', label: t('llm.providers', 'Providers') },
                    { id: 'roles', label: t('llm.roles', 'Role Assignments') },
                    { id: 'config', label: t('llm.config', 'Raw Config') }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveSubTab(tab.id as any)}
                        className={cn(
                            "px-4 py-2 text-sm font-medium border-b-2 transition-all",
                            activeSubTab === tab.id
                                ? "border-indigo-500 text-white"
                                : "border-transparent text-zinc-500 hover:text-zinc-300"
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Providers Tab */}
            {activeSubTab === 'providers' && (
                <div className="grid gap-6">
                    {providers.map(([name, p]) => (
                        <div key={name} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 hover:border-zinc-700 transition-colors">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                                    {name}
                                </h3>
                                {p.hasKey ?
                                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                                        <Check size={12} strokeWidth={3} /> {t('llm.active', 'Active')}
                                    </span> :
                                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
                                        <AlertCircle size={12} strokeWidth={2.5} /> {t('llm.setup_required', 'Setup Required')}
                                    </span>
                                }
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <Label>{t('llm.base_url', 'Base URL')}</Label>
                                    <Input
                                        type="text"
                                        defaultValue={p.apiBaseUrl}
                                        onBlur={(e) => handleProviderUpdate(name, { baseUrl: e.target.value })}
                                        placeholder="https://api.example.com/v1"
                                    />
                                </div>

                                <div>
                                    <Label>{t('llm.api_key', 'API Key')}</Label>
                                    <div className="relative mb-3">
                                        <Input
                                            type="password"
                                            placeholder={p.hasKey ? t('llm.api_key_placeholder_loaded', 'Loaded from Settings/Env (Hidden)') : t('llm.api_key_placeholder_enter', 'Enter API Key')}
                                            defaultValue={p.apiKey} // Note: Usually empty or hidden
                                            onBlur={(e) => handleProviderUpdate(name, { apiKey: e.target.value })}
                                            className="pr-10"
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600">
                                            {p.hasKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </div>
                                    </div>
                                    <TestButton
                                        providerName={name}
                                        config={{ apiKey: p.apiKey, apiBaseUrl: p.apiBaseUrl }}
                                        hasKey={p.hasKey}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Roles Tab */}
            {activeSubTab === 'roles' && (
                <div className="grid gap-6">
                    {roles.map(([roleKey, roleCfg]) => {
                        const currentProvider = config.providers[roleCfg.provider];
                        const availableModels = currentProvider ? Object.keys(currentProvider.models) : [];

                        return (
                            <div key={roleKey} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-zinc-100 mb-1">{roleKey}</h3>
                                    <p className="text-sm text-zinc-400">{t(`llm.role_description.${roleKey}`, roleCfg.description)}</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <Label>{t('llm.role_provider', 'Provider')}</Label>
                                        <Select
                                            value={roleCfg.provider}
                                            onChange={(e) => {
                                                const newProvider = e.target.value;
                                                const newModels = Object.keys(config.providers[newProvider]?.models || {});
                                                handleRoleUpdate(roleKey, { provider: newProvider, model: newModels[0] });
                                            }}
                                        >
                                            {Object.keys(config.providers).map(p => (
                                                <option key={p} value={p}>{p}</option>
                                            ))}
                                        </Select>
                                        <p className="mt-2 text-[10px] text-zinc-500 font-mono flex items-center gap-1">
                                            <Terminal size={10} />
                                            {t('llm.active_key', 'Active Key')}: {config.providers[roleCfg.provider]?.hasKey ? t('llm.present', 'Present') : t('llm.missing', 'Missing')}
                                        </p>
                                    </div>

                                    <div>
                                        <Label>{t('llm.role_model', 'Model')}</Label>
                                        <Combobox
                                            value={roleCfg.model}
                                            options={availableModels}
                                            onChange={(val) => handleRoleUpdate(roleKey, { model: val })}
                                            placeholder={t('llm.select_model', 'Select or type model...')}
                                        />

                                        <div className="mt-4">
                                            <TestButton
                                                providerName={roleCfg.provider}
                                                config={{
                                                    apiKey: currentProvider?.apiKey || '',
                                                    apiBaseUrl: currentProvider?.apiBaseUrl || ''
                                                }}
                                                hasKey={currentProvider?.hasKey || false}
                                                modelName={roleCfg.model}
                                                onSuccess={showSavedToast}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Config Tab */}
            {activeSubTab === 'config' && <ConfigEditor />}

            {/* Save Toast (matches Capture Settings pattern) */}
            <div className={`fixed bottom-8 right-8 flex items-center gap-2 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-full shadow-lg transition-all duration-300 ${toastState === 'idle' ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'}`}>
                <div className="w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3 text-zinc-900">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                </div>
                <span className="text-sm font-medium text-zinc-200">
                    {t('llm.changes_saved', 'Changes saved')}
                </span>
            </div>
        </div>
    );
}

function Combobox({ value, options, onChange, placeholder }: { value: string, options: string[], onChange: (val: string) => void, placeholder?: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()));

    return (
        <div className="relative group">
            <Input
                type="text"
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                onBlur={() => setTimeout(() => setIsOpen(false), 200)}
                placeholder={placeholder}
            />

            {isOpen && (filtered.length > 0 || options.length > 0) && (
                <ul className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-lg max-h-48 overflow-y-auto z-50 shadow-xl ring-1 ring-black/20">
                    {(filtered.length > 0 ? filtered : options).map(opt => (
                        <li
                            key={opt}
                            onMouseDown={() => {
                                onChange(opt);
                                setIsOpen(false);
                            }}
                            className="px-3 py-2 cursor-pointer text-zinc-300 hover:bg-indigo-500/10 hover:text-indigo-300 text-sm transition-colors border-b border-zinc-800/50 last:border-0"
                        >
                            {opt}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ConfigEditor() {
    const { t } = useTranslation();
    const [content, setContent] = useState('');
    const [status, setStatus] = useState('');

    useEffect(() => {
        load();
    }, []);

    const load = async () => {
        if (window.ipcRenderer) {
            const res = await window.ipcRenderer.invoke('get-raw-llm-config');
            setContent(res.content);
        } else {
            setContent('{}');
        }
    };

    const handleSave = async () => {
        try {
            JSON.parse(content); // Validate
            if (window.ipcRenderer) {
                const res = await window.ipcRenderer.invoke('save-raw-llm-config', content);
                if (res.success) {
                    setStatus('Config saved successfully');
                    setTimeout(() => setStatus(''), 2000);
                } else {
                    setStatus('Error: ' + res.error);
                }
            } else {
                setStatus('Saved (Mock)');
            }
        } catch (e) {
            setStatus('Invalid JSON Format');
        }
    };

    const handleImport = async () => {
        if (window.ipcRenderer) {
            const res = await window.ipcRenderer.invoke('import-llm-config');
            if (res.success && res.content) {
                setContent(res.content);
                setStatus('Config imported. Review and Save.');
            } else if (res.error) {
                setStatus('Import Failed: ' + res.error);
            }
        }
    };

    const handleExport = async () => {
        if (window.ipcRenderer) {
            const res = await window.ipcRenderer.invoke('export-llm-config', content);
            if (res.success) setStatus('Config exported successfully');
            else if (res.error) setStatus('Export Failed: ' + res.error);
        }
    };

    return (
        <div className="flex flex-col h-[600px] bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b border-zinc-800 bg-zinc-900/50">
                <Button onClick={handleSave} variant="primary" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
                    <Save size={14} /> {t('llm.save', 'Save')}
                </Button>
                <Button onClick={load} variant="outline">
                    <RotateCcw size={14} /> {t('llm.reset', 'Reset')}
                </Button>
                <div className="flex-1"></div>

                {status && (
                    <span className={cn(
                        "text-xs font-medium px-2 py-1 rounded bg-zinc-950",
                        status.includes('Error') || status.includes('Invalid') ? "text-red-400" : "text-emerald-400"
                    )}>
                        {status}
                    </span>
                )}

                <Button onClick={handleImport} variant="outline">
                    <Upload size={14} /> {t('llm.import', 'Import')}
                </Button>
                <Button onClick={handleExport} variant="outline">
                    <Download size={14} /> {t('llm.export', 'Export')}
                </Button>
            </div>

            <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 bg-zinc-950 text-zinc-300 font-mono text-xs p-4 resize-none focus:outline-none"
                spellCheck={false}
            />
        </div>
    );
}

function TestButton({ providerName, config, hasKey, modelName, onSuccess }: { providerName: string, config: { apiKey: string, apiBaseUrl: string }, hasKey: boolean, modelName?: string, onSuccess?: () => void }) {
    const { t } = useTranslation();
    const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [msg, setMsg] = useState('');

    const handleTest = async () => {
        if (!hasKey && !config.apiKey) {
            setStatus('error');
            setMsg('Missing API Key');
            return;
        }

        setStatus('testing');
        setMsg('');

        try {
            if (!window.ipcRenderer) {
                setStatus('error');
                setMsg('Not running in Electron');
                return;
            }
            const result = await window.ipcRenderer.invoke('test-llm-connection', providerName, config, modelName);
            if (result.success) {
                setStatus('success');
                setMsg('Connected');
                onSuccess?.();
                setTimeout(() => setStatus('idle'), 3000);
            } else {
                setStatus('error');
                setMsg(result.message);
            }
        } catch (e: any) {
            setStatus('error');
            setMsg(e.message || 'Error');
        }
    };

    return (
        <div className="flex items-center gap-3">
            <Button
                onClick={handleTest}
                disabled={status === 'testing'}
                variant={status === 'testing' ? 'outline' : 'primary'}
                className={status === 'testing' ? 'cursor-not-allowed text-zinc-500 bg-zinc-800' : ''}
            >
                {status === 'testing' ? <Loader2 size={12} className="animate-spin" /> : <Terminal size={12} />}
                {status === 'testing' ? t('llm.testing', 'Testing...') : `${t(modelName ? 'llm.test_model' : 'llm.test_connection', modelName ? 'Test Model' : 'Test Connection')}`}
            </Button>

            {status === 'success' && <span className="text-emerald-400 text-xs font-medium flex items-center gap-1"><Check size={12} /> {msg || t('llm.connected', 'Connected')}</span>}
            {status === 'error' && <span className="text-red-400 text-xs font-medium flex items-center gap-1"><AlertCircle size={12} /> {msg}</span>}
        </div>
    );
}
