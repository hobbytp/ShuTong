import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSproutStore } from './store';
import { Sprout, Plus, Trash2, Activity, Leaf } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ConfirmDialog } from '../../components/Settings/ConfirmDialog';

export const SproutGarden: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { history, loadHistory, loadSprout, deleteSprout, isLoadingHistory, reset } = useSproutStore();

    // P2: State for delete confirmation dialog
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; topic: string } | null>(null);

    useEffect(() => {
        loadHistory();
    }, []);

    const handleNewSprout = () => {
        reset();
        loadSprout('new');
    };

    const handleDeleteClick = (e: React.MouseEvent, session: { id: string; topic: string }) => {
        e.stopPropagation();
        setDeleteTarget(session);
    };

    const handleConfirmDelete = () => {
        if (deleteTarget) {
            deleteSprout(deleteTarget.id);
            setDeleteTarget(null);
        }
    };

    const isEmpty = !isLoadingHistory && history.length === 0;

    return (
        <div className="p-8 max-w-4xl mx-auto min-h-screen text-zinc-50">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                        <Sprout size={22} className="text-emerald-400" />
                        {t('sprouts.garden', 'Idea Garden')}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">{t('sprouts.garden_subtitle', 'Your collection of growing ideas and insights.')}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* New Sprout Card */}
                <button
                    onClick={handleNewSprout}
                    className="group relative h-48 rounded-xl border-2 border-dashed border-zinc-800 hover:border-indigo-500/50 hover:bg-zinc-900/50 transition-all flex flex-col items-center justify-center gap-4"
                >
                    <div className="w-12 h-12 rounded-full bg-zinc-900 group-hover:bg-indigo-500/20 flex items-center justify-center transition-colors">
                        <Plus className="w-6 h-6 text-zinc-500 group-hover:text-indigo-400" />
                    </div>
                    <span className="text-zinc-500 group-hover:text-zinc-300 font-medium">
                        {t('sprouts.plant_new', 'Plant New Seed')}
                    </span>
                </button>

                {/* History Cards */}
                {history.map((session) => {
                    const isCompleted = session.status === 'completed';
                    const colors = isCompleted
                        ? { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'text-emerald-400' }
                        : { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'text-amber-400' };

                    return (
                        <div
                            key={session.id}
                            onClick={() => loadSprout(session.id)}
                            className={`group relative h-48 rounded-xl border ${colors.border} ${colors.bg} hover:scale-[1.02] transition-all p-6 cursor-pointer flex flex-col justify-between overflow-hidden`}
                        >
                            {/* Background Decoration */}
                            <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none select-none">
                                <Sprout className="w-32 h-32" />
                            </div>

                            <div className="relative z-10">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-xs font-bold uppercase tracking-wider ${colors.icon}`}>
                                            {isCompleted ? t('common.done', 'Done') : t('common.active', 'Active')}
                                        </span>
                                        <span className="text-xs text-zinc-600">
                                            {formatDistanceToNow(session.created_at, { addSuffix: true, locale: i18n.language === 'zh' ? zhCN : undefined })}
                                        </span>
                                    </div>
                                </div>
                                <h3 className="text-lg font-semibold text-zinc-100 line-clamp-2 leading-tight mb-2">
                                    {session.topic || t('sprouts.untitled', 'Untitled Idea')}
                                </h3>
                            </div>

                            <div className="flex items-center justify-between text-zinc-500 text-xs mt-auto relative z-10">
                                <div className="flex items-center gap-4">
                                    <span className="flex items-center gap-1">
                                        <Activity className="w-3 h-3" />
                                        {session.heatmap_score} {t('sprouts.events', 'events')}
                                    </span>
                                </div>

                                <button
                                    onClick={(e) => handleDeleteClick(e, { id: session.id, topic: session.topic })}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:text-red-400 transition-all cursor-pointer"
                                    aria-label={t('common.delete', 'Delete')}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    );
                })}

                {/* Loading State */}
                {isLoadingHistory && (
                    <div className="col-span-full py-12 flex justify-center text-zinc-500">
                        {t('common.loading', 'Loading...')}
                    </div>
                )}
            </div>

            {/* P2: Empty State */}
            {isEmpty && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-24 h-24 rounded-full bg-zinc-900/50 flex items-center justify-center mb-6">
                        <Leaf className="w-12 h-12 text-zinc-700" />
                    </div>
                    <h3 className="text-xl font-medium text-zinc-400 mb-2">
                        {t('sprouts.empty_title', 'Your garden is empty')}
                    </h3>
                    <p className="text-zinc-500 max-w-md">
                        {t('sprouts.empty_desc', 'Plant your first seed to start growing ideas. Each sprout becomes a collaborative AI discussion on your topic.')}
                    </p>
                </div>
            )}

            {/* P2: Custom Delete Confirm Dialog */}
            <ConfirmDialog
                isOpen={!!deleteTarget}
                title={t('sprouts.delete_title', 'Delete Sprout?')}
                message={t('sprouts.delete_message', 'This will permanently remove "{{topic}}" and all its conversation history. This action cannot be undone.', { topic: deleteTarget?.topic || '' })}
                confirmText={t('common.delete', 'Delete')}
                cancelText={t('common.cancel', 'Cancel')}
                isDestructive={true}
                onConfirm={handleConfirmDelete}
                onCancel={() => setDeleteTarget(null)}
            />
        </div>
    );
};
