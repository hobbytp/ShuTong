import { useEffect, useState } from 'react'
import { aiService } from '../services/ai/openai'

type Step = 'welcome' | 'storage' | 'ai-config' | 'complete'

interface OnboardingProps {
    onComplete: () => void
}

export function Onboarding({ onComplete }: OnboardingProps) {
    const [step, setStep] = useState<Step>('welcome')
    const [recordingPath, setRecordingPath] = useState('');
    const [baseUrl, setBaseUrl] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [modelName, setModelName] = useState('')
    const [status, setStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle')

    useEffect(() => {
        // Load initial settings
        // @ts-ignore
        window.ipcRenderer.invoke('get-settings').then((settings: any) => {
            if (settings.openai_base_url) setBaseUrl(settings.openai_base_url);
            if (settings.openai_api_key) setApiKey(settings.openai_api_key);
            if (settings.openai_model_name) setModelName(settings.openai_model_name);
            if (settings.recording_path) setRecordingPath(settings.recording_path);
        });
    }, []);

    const handleTestConnection = async () => {
        setStatus('checking')

        // Save settings
        // @ts-ignore
        await window.ipcRenderer.invoke('set-setting', 'openai_base_url', baseUrl)
        // @ts-ignore
        await window.ipcRenderer.invoke('set-setting', 'openai_api_key', apiKey)
        // @ts-ignore
        await window.ipcRenderer.invoke('set-setting', 'openai_model_name', modelName)

        // Configure and test
        aiService.configure(apiKey, baseUrl)
        const success = await aiService.checkConnection()
        setStatus(success ? 'success' : 'error')

        if (success) {
            setTimeout(() => setStep('complete'), 1000)
        }
    }

    const handleFinish = async () => {
        // @ts-ignore
        await window.ipcRenderer.invoke('set-setting', 'onboarding_complete', 'true')
        onComplete()
    }

    const handleSelectDirectory = async () => {
        // @ts-ignore
        const path = await window.ipcRenderer.invoke('select-directory');
        if (path) {
            setRecordingPath(path);
            // Onboarding doesn't strictly need to set-setting here because select-directory 
            // triggered restart and migration which updates bootstrap.
            // On restart, the new DB will handle settings.
            // However, if we haven't restarted yet (e.g. user cancelled), path is null.
            // If path is returned, it means restart logic might have been bypassed or we are just updating UI?
            // Actually, per my fix in main.ts, if restart happens, app quits.
            // If restart cancelled, null is returned.
            // So this code block `if (path)` only runs if logic allows continuing without restart?
            // Wait, my main.ts main logic says: if restart confirmed, app.quit().
            // So the promise never resolves? Or resolves then quits?
            // If the promise doesn't resolve, this code won't run.
            // If it resolves, `path` is valid.
            // But usually the app will die before this updates.
            // That's fine.
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            backgroundColor: '#111827',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px'
        }}>
            {/* Progress Indicator */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
                {['welcome', 'storage', 'ai-config', 'complete'].map((s) => (
                    <div
                        key={s}
                        style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            backgroundColor: step === s ? '#3B82F6' : '#374151'
                        }}
                    />
                ))}
            </div>

            {/* Step Content */}
            <div style={{
                maxWidth: '500px',
                width: '100%',
                backgroundColor: '#1F2937',
                borderRadius: '12px',
                padding: '32px'
            }}>
                {step === 'welcome' && (
                    <>
                        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '16px', textAlign: 'center' }}>
                            👋 Welcome to ShuTong
                        </h1>
                        <p style={{ color: '#9CA3AF', textAlign: 'center', marginBottom: '24px' }}>
                            ShuTong records your screen and uses AI to help you understand how you spend your time.
                        </p>
                        <button
                            onClick={() => setStep('storage')}
                            style={{
                                width: '100%',
                                padding: '12px',
                                backgroundColor: '#3B82F6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer'
                            }}
                        >
                            Get Started →
                        </button>
                    </>
                )}

                {step === 'storage' && (
                    <>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '16px' }}>
                            Data Storage
                        </h2>
                        <p style={{ color: '#9CA3AF', marginBottom: '24px', fontSize: '14px' }}>
                            Choose where to store your recordings and database. We recommend a drive with plenty of space (e.g., D: or E:).
                        </p>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#9CA3AF' }}>Storage Path</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    readOnly
                                    value={recordingPath || 'Loading...'}
                                    style={{
                                        flex: 1,
                                        padding: '10px',
                                        backgroundColor: '#111827',
                                        border: '1px solid #374151',
                                        borderRadius: '6px',
                                        color: 'white',
                                        fontSize: '12px',
                                        fontFamily: 'monospace'
                                    }}
                                />
                                <button
                                    onClick={handleSelectDirectory}
                                    style={{
                                        padding: '0 16px',
                                        backgroundColor: '#374151',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '14px'
                                    }}
                                >
                                    Browse...
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={() => setStep('ai-config')}
                            style={{
                                width: '100%',
                                padding: '12px',
                                backgroundColor: '#3B82F6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer'
                            }}
                        >
                            Next Step →
                        </button>
                    </>
                )}

                {step === 'ai-config' && (
                    <>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '16px' }}>
                            Configure AI Provider
                        </h2>
                        <p style={{ color: '#9CA3AF', marginBottom: '24px', fontSize: '14px' }}>
                            Enter your OpenAI-compatible API details. Works with OpenAI, Ollama, DeepSeek, etc.
                        </p>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#9CA3AF' }}>Base URL</label>
                            <input
                                type="text"
                                value={baseUrl}
                                onChange={(e) => setBaseUrl(e.target.value)}
                                placeholder="https://api.openai.com/v1"
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#111827',
                                    border: '1px solid #374151',
                                    borderRadius: '6px',
                                    color: 'white'
                                }}
                            />
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#9CA3AF' }}>API Key</label>
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="sk-..."
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#111827',
                                    border: '1px solid #374151',
                                    borderRadius: '6px',
                                    color: 'white'
                                }}
                            />
                        </div>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#9CA3AF' }}>Model Name</label>
                            <input
                                type="text"
                                value={modelName}
                                onChange={(e) => setModelName(e.target.value)}
                                placeholder="gpt-4o, llama3.2, deepseek-chat"
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#111827',
                                    border: '1px solid #374151',
                                    borderRadius: '6px',
                                    color: 'white'
                                }}
                            />
                        </div>

                        <button
                            onClick={handleTestConnection}
                            disabled={status === 'checking' || !baseUrl}
                            style={{
                                width: '100%',
                                padding: '12px',
                                backgroundColor: status === 'success' ? '#10B981' : '#3B82F6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                opacity: status === 'checking' ? 0.5 : 1
                            }}
                        >
                            {status === 'checking' ? 'Testing...' : status === 'success' ? '✓ Connected!' : 'Test Connection'}
                        </button>
                        {status === 'error' && (
                            <p style={{ color: '#EF4444', marginTop: '8px', fontSize: '14px', textAlign: 'center' }}>
                                Connection failed. Please check your settings.
                            </p>
                        )}
                    </>
                )}

                {step === 'complete' && (
                    <>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '16px' }}>
                                You're All Set!
                            </h2>
                            <p style={{ color: '#9CA3AF', marginBottom: '24px' }}>
                                ShuTong is ready to start recording. Click "Start Recording" on the main screen to begin.
                            </p>
                            <button
                                onClick={handleFinish}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    backgroundColor: '#10B981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '16px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                            >
                                Start Using ShuTong
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
