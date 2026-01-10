import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Clock, Monitor } from 'lucide-react';
import { invoke } from '../../lib/ipc';

interface DrillDownItem {
    windowTitle: string;
    duration: number; // minutes
    percentage: number;
}

interface DrillDownModalProps {
    appName: string | null;
    startTs: number;
    endTs: number;
    isOpen: boolean;
    onClose: () => void;
}

export const DrillDownModal: React.FC<DrillDownModalProps> = ({ appName, startTs, endTs, isOpen, onClose }) => {
    const { t } = useTranslation();
    const [data, setData] = useState<DrillDownItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen && appName) {
            loadData();
        }
    }, [isOpen, appName, startTs, endTs]);

    const loadData = async () => {
        if (!appName) return;
        setIsLoading(true);
        try {
            const result = await invoke('get-app-drilldown', { appName, startTs, endTs });
            setData(result as DrillDownItem[]);
        } catch (error) {
            console.error('Failed to load drill down data:', error);
            setData([]);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen || !appName) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col max-h-[80vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center space-x-3">
                        <Monitor className="w-6 h-6 text-indigo-500" />
                        <div>
                            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                                {appName}
                            </h2>
                            <p className="text-sm text-zinc-500">
                                {t('insights.drilldown_subtitle', { defaultValue: 'Detailed Usage Breakdown' })}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-500"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                        </div>
                    ) : data.length === 0 ? (
                        <div className="text-center py-10 text-zinc-500">
                            {t('common.no_data', { defaultValue: 'No detailed activity found.' })}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {data.map((item, index) => (
                                <div key={index} className="flex items-center justify-between group">
                                    <div className="flex-1 min-w-0 mr-4">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate" title={item.windowTitle}>
                                                {item.windowTitle}
                                            </span>
                                            <span className="text-xs text-zinc-500 font-mono">
                                                {item.duration}m
                                            </span>
                                        </div>
                                        {/* Progress Bar */}
                                        <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                                            <div
                                                className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                                                style={{ width: `${item.percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
                    <div className="flex items-center justify-end text-xs text-zinc-400">
                        <Clock className="w-3 h-3 mr-1" />
                        <span>Showing top activities by time spent</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
