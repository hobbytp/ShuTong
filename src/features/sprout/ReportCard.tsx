import React from 'react';
import { SproutReport } from '@shared/sprout';
import { Brain, Lightbulb, Share2, HelpCircle, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ReportCardProps {
    report: SproutReport;
}

export const ReportCard: React.FC<ReportCardProps> = ({ report }) => {
    const { t } = useTranslation();
    if (!report || !report.core_essence) return null;

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header / Essence Section */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-950 via-purple-950 to-zinc-950 border border-indigo-500/30 p-8 shadow-2xl">
                <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl"></div>

                <div className="relative z-10 space-y-4">
                    <div className="flex items-center gap-2 text-indigo-300 text-sm font-semibold uppercase tracking-wider">
                        <Brain className="w-4 h-4" />
                        <span>{t('sprouts.cognitive_dna')}</span>
                    </div>
                    <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-100 to-purple-200">
                        {report.core_essence}
                    </h2>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Mental Model Lens */}
                <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-6 space-y-4 hover:border-indigo-500/30 transition-colors">
                    <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
                        <Lightbulb className="w-4 h-4" />
                        <span>{t('sprouts.mental_model')}: {report.mental_model_lens}</span>
                    </div>
                    <p className="text-zinc-300 leading-relaxed italic">
                        "{report.perspective_shift}"
                    </p>
                </div>

                {/* Cross Pollination */}
                <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-6 space-y-4 hover:border-pink-500/30 transition-colors">
                    <div className="flex items-center gap-2 text-pink-400 text-sm font-medium">
                        <Share2 className="w-4 h-4" />
                        <span>{t('sprouts.cross_pollination')}</span>
                    </div>
                    <ul className="space-y-3">
                        {(report.cross_pollination || []).map((item, idx) => (
                            <li key={idx} className="group">
                                <span className="text-xs font-bold text-zinc-500 uppercase block mb-1 group-hover:text-pink-300 transition-colors">{item.field}</span>
                                <span className="text-zinc-300 text-sm">{item.insight}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Rabbit Holes */}
            <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-6 space-y-4">
                <div className="flex items-center gap-2 text-sky-400 text-sm font-medium">
                    <HelpCircle className="w-4 h-4" />
                    <span>{t('sprouts.rabbit_holes')}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(report.rabbit_holes || []).map((hole, idx) => (
                        <div key={idx} className="bg-black/20 rounded-lg p-4 border border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                            <span className={`text-xs font-bold uppercase mb-2 block ${hole.type === 'deepen' ? 'text-blue-400' :
                                hole.type === 'invert' ? 'text-orange-400' : 'text-purple-400'
                                }`}>
                                {hole.type}
                            </span>
                            <p className="text-zinc-300 text-sm font-medium">{hole.question}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Micro Experiment */}
            {report.experiments && report.experiments.length > 0 && (
                <div className="bg-gradient-to-r from-emerald-950/30 to-teal-950/30 rounded-xl border border-emerald-500/20 p-6 space-y-4">
                    <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                        <FlaskConical className="w-4 h-4" />
                        <span>{t('sprouts.experiments')}: {report.experiments[0].title}</span>
                    </div>
                    <ul className="space-y-2">
                        {report.experiments[0].steps.map((step, idx) => (
                            <li key={idx} className="flex gap-3 text-zinc-300 text-sm">
                                <span className="w-5 h-5 rounded-full bg-emerald-900/50 text-emerald-400 flex items-center justify-center text-xs flex-shrink-0 border border-emerald-800">
                                    {idx + 1}
                                </span>
                                <span>{step}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};
