import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../lib/ipc'

type Step = 'welcome' | 'storage' | 'complete'

interface OnboardingProps {
    onComplete: () => void
}

export function Onboarding({ onComplete }: OnboardingProps) {
    const { t } = useTranslation();
    const [step, setStep] = useState<Step>('welcome')
    const [recordingPath, setRecordingPath] = useState('');

    useEffect(() => {
        // Load initial settings using typed IPC
        invoke('get-settings').then((settings) => {
            if (settings.recording_path) setRecordingPath(settings.recording_path);
        });
    }, []);

    const handleFinish = async () => {
        // Using typed IPC - no more @ts-ignore!
        await invoke('set-setting', 'onboarding_complete', 'true')
        onComplete()
    }

    const handleSelectDirectory = async () => {
        // Using typed IPC - true = onboarding mode (hot swap, no restart)
        const path = await invoke('select-directory', true);
        if (path) {
            setRecordingPath(path);
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
                {['welcome', 'storage', 'complete'].map((s) => (
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
                            {t('onboarding.welcome_title', '👋 Welcome to ShuTong')}
                        </h1>
                        <p style={{ color: '#9CA3AF', textAlign: 'center', marginBottom: '24px' }}>
                            {t('onboarding.welcome_desc', 'ShuTong records your screen and uses AI to help you understand how you spend your time.')}
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
                            {t('onboarding.get_started', 'Get Started →')}
                        </button>
                    </>
                )}

                {step === 'storage' && (
                    <>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '16px' }}>
                            {t('onboarding.data_storage', 'Data Storage')}
                        </h2>
                        <p style={{ color: '#9CA3AF', marginBottom: '24px', fontSize: '14px' }}>
                            {t('onboarding.storage_desc', 'Choose where to store your recordings and database. We recommend a drive with plenty of space (e.g., D: or E:).')}
                        </p>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#9CA3AF' }}>{t('onboarding.storage_path', 'Storage Path')}</label>
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
                                    {t('onboarding.browse', 'Browse...')}
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={() => setStep('complete')}
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
                            {t('onboarding.next_step', 'Next Step →')}
                        </button>
                    </>
                )}

                {step === 'complete' && (
                    <>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '16px' }}>
                                {t('onboarding.all_set', 'You\'re All Set!')}
                            </h2>
                            <p style={{ color: '#9CA3AF', marginBottom: '24px' }}>
                                {t('onboarding.ready', 'ShuTong is ready to start recording. Click "Start Recording" on the main screen to begin.')}
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
                                {t('onboarding.start_using', 'Start Using ShuTong')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
