import { BackupProgressEvent } from '../../types/backup';

interface BackupProgressModalProps {
    progress: BackupProgressEvent | null;
    onClose: () => void;
}

export function BackupProgressModal({ progress, onClose }: BackupProgressModalProps) {
    if (!progress) return null;

    const isDone = progress.phase === 'done' || progress.phase === 'error';
    const isError = progress.phase === 'error';

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[480px] shadow-xl border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                    {progress.operation === 'backup' ? 'Creating Backup' : 'Restoring Data'}
                </h3>

                <div className="space-y-4">
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                        <span>{progress.message}</span>
                        <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                    </div>

                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                        <div
                            className={`h-2.5 rounded-full transition-all duration-300 ${isError ? 'bg-red-500' : 'bg-blue-600'
                                }`}
                            style={{ width: `${(progress.current / progress.total) * 100}%` }}
                        ></div>
                    </div>

                    <div className="text-xs text-gray-500 dark:text-gray-500 font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded max-h-24 overflow-y-auto">
                        Phase: {progress.phase}
                    </div>

                    {isDone && (
                        <div className="flex justify-end pt-2">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
                            >
                                {isError ? 'Close' : 'Done'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
