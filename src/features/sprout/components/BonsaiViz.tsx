import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSproutStore } from '../store';

// ============================================================================
// Types
// ============================================================================
interface Expert {
    name: string;
    role: string;
    emoji: string;
    description?: string;
    intro?: string; // Fallback
}

// ============================================================================
// Plant Assets (SVG Paths)
// ============================================================================
const PLANT_PATHS = {
    stem: "M 400 600 C 400 600, 400 500, 390 400 C 385 350, 400 300, 405 250",
    branchL1: "M 395 450 Q 350 430, 300 440",
    branchR1: "M 398 420 Q 450 400, 500 410",
    branchL2: "M 400 320 Q 360 300, 330 280",
    branchR2: "M 402 340 Q 440 320, 470 300",
    leafL1: "M 300 440 Q 280 430, 290 450 Q 310 460, 300 440",
    leafR1: "M 500 410 Q 520 400, 510 420 Q 490 430, 500 410",
    leafTop: "M 405 250 Q 385 200, 405 150 Q 425 200, 405 250"
};

// ============================================================================
// Expert Card Component
// ============================================================================
interface ExpertCardProps {
    expert: Expert;
    isActive: boolean;
    isFinished: boolean;
}

const ExpertCard: React.FC<ExpertCardProps> = ({ expert, isActive, isFinished }) => {
    const { t } = useTranslation();
    const [isHovered, setIsHovered] = useState(false);

    // Only show role if it's not the generic default
    const showRole = expert.role && expert.role !== 'AI Expert' && expert.role !== '思想家';

    return (
        <div
            className="relative w-36 h-36 perspective-1000 group cursor-pointer"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <motion.div
                className={`w-full h-full relative preserve-3d transition-all duration-700 ${isActive ? 'ring-2 ring-indigo-500 rounded-xl shadow-[0_0_20px_rgba(99,102,241,0.5)]' : ''}`}
                animate={{
                    rotateY: isHovered && isFinished ? 180 : 0,
                    scale: isActive ? 1.05 : 1
                }}
            >
                {/* Front Side */}
                <div className="absolute inset-0 backface-hidden bg-zinc-900/90 border border-zinc-700 rounded-xl flex flex-col items-center justify-center p-4 backdrop-blur-md shadow-xl">

                    {/* Name (Large) */}
                    <div className="text-lg font-bold text-center text-white leading-tight mb-2">
                        {expert.name}
                    </div>

                    {/* Role / Title (Small) - Only if available */}
                    {showRole && (
                        <div className="text-xs text-indigo-400 text-center uppercase tracking-wide font-medium">
                            {expert.role}
                        </div>
                    )}

                    {isActive && (
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                    )}
                </div>

                {/* Back Side (Info) */}
                <div className="absolute inset-0 backface-hidden bg-indigo-900/90 border border-indigo-500/50 rounded-xl p-4 flex items-center justify-center rotate-y-180 backdrop-blur-md">
                    <p className="text-[11px] text-indigo-100 text-center leading-relaxed font-medium">
                        {expert.description || t('sprouts.viz.default_expert_desc', "An expert analyzing your topic from a unique perspective.")}
                    </p>
                </div>
            </motion.div>

            {/* Speaking Popup (When Active) */}
            <AnimatePresence>
                {isActive && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.8 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.8 }}
                        className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-48 z-50 pointer-events-none"
                    >
                        <div className="bg-indigo-600 text-white text-xs p-2 rounded-lg shadow-lg text-center relative font-medium">
                            {t('sprouts.viz.thinking', 'Thinking...')}
                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-indigo-600 rotate-45" />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ============================================================================
// Main Component
// ============================================================================
export const BonsaiViz: React.FC = () => {
    const { t } = useTranslation();
    const { messages, activeSpeaker, experts, maxRounds, status } = useSproutStore();

    // Calculate Progress
    const progress = useMemo(() => {
        if (!experts?.length) return 0;
        if (status === 'done') return 1;

        // Count assistant messages (approximate turns)
        const assistantMsgs = messages.filter(m => m.role !== 'user' && m.role !== 'system' && m.role !== 'tool').length;
        const totalEstMsgs = experts.length * (maxRounds || 3);

        return Math.min(assistantMsgs / totalEstMsgs, 1);
    }, [messages, experts, maxRounds, status]);

    // Derived states for animation stages
    const stemProgress = Math.min(progress / 0.3, 1);
    const branchesProgress = progress > 0.3 ? Math.min((progress - 0.3) / 0.4, 1) : 0;
    const leavesProgress = progress > 0.7 ? Math.min((progress - 0.7) / 0.3, 1) : 0;

    return (
        <div className="w-full h-full relative overflow-hidden bg-zinc-950 flex flex-col">
            {/* 1. Expert Bar (Top) */}
            <div className="relative z-10 w-full p-6 flex justify-center gap-6 pointer-events-auto">
                {experts.map((exp: any, idx: number) => (
                    <ExpertCard
                        key={idx}
                        expert={exp}
                        isActive={activeSpeaker === exp.name}
                        isFinished={status === 'done'}
                    />
                ))}
            </div>

            {/* 2. Main Visualization Area */}
            <div className="flex-1 relative flex items-center justify-center overflow-hidden">

                {/* Background Atmosphere */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-zinc-950/80 to-zinc-950" />

                {/* The Growing Plant SVG */}
                <div className="relative w-full max-w-[600px] aspect-[1/1]">
                    <svg width="100%" height="100%" viewBox="0 0 800 800" className="overflow-visible">
                        {/* Filter for glow */}
                        <defs>
                            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="4" result="blur" />
                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                        </defs>

                        {/* Pot / Base */}
                        <motion.g initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                            <ellipse cx="400" cy="650" rx="80" ry="20" fill="#27272a" />
                            <path d="M 330 650 L 340 750 L 460 750 L 470 650 Z" fill="#3f3f46" />
                        </motion.g>

                        {/* Stem */}
                        <motion.path
                            d={PLANT_PATHS.stem}
                            fill="none"
                            stroke="#10b981" // emerald-500
                            strokeWidth="8"
                            strokeLinecap="round"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: stemProgress }}
                            transition={{ duration: 1, ease: "easeInOut" }}
                            filter="url(#glow)"
                        />

                        {/* Branches Layer 1 */}
                        {progress > 0.2 && (
                            <>
                                <motion.path d={PLANT_PATHS.branchL1} fill="none" stroke="#10b981" strokeWidth="6" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: branchesProgress }} />
                                <motion.path d={PLANT_PATHS.branchR1} fill="none" stroke="#10b981" strokeWidth="6" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: branchesProgress }} />
                            </>
                        )}

                        {/* Branches Layer 2 */}
                        {progress > 0.4 && (
                            <>
                                <motion.path d={PLANT_PATHS.branchL2} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: branchesProgress }} />
                                <motion.path d={PLANT_PATHS.branchR2} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: branchesProgress }} />
                            </>
                        )}

                        {/* Leaves (Fade In / Scale) */}
                        {progress > 0.6 && (
                            <motion.g initial={{ opacity: 0, scale: 0 }} animate={{ opacity: leavesProgress, scale: leavesProgress }} transform-origin="400 300">
                                <path d={PLANT_PATHS.leafL1} fill="#4ade80" stroke="none" opacity="0.8" />
                                <path d={PLANT_PATHS.leafR1} fill="#4ade80" stroke="none" opacity="0.8" />
                                <path d={PLANT_PATHS.leafTop} fill="#86efac" stroke="none" opacity="0.9" />

                                {/* Extra sparkle if done */}
                                {status === 'done' && (
                                    <circle cx="405" cy="180" r="5" fill="#fff" className="animate-pulse">
                                        <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />
                                        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
                                    </circle>
                                )}
                            </motion.g>
                        )}
                    </svg>

                    {/* Completion Text */}
                    {status === 'done' && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="absolute bottom-10 left-0 right-0 text-center"
                        >
                            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-4 py-1.5 rounded-full text-sm font-medium tracking-wide">
                                {t('sprouts.viz.growth_complete', '🌱 Growth Complete')}
                            </span>
                        </motion.div>
                    )}
                </div>
            </div>
        </div>
    );
};
