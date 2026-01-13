import { cn } from '../../../lib/utils';
import { motion } from 'framer-motion';

export interface ExpertCardProps {
    id: string;
    name: string;
    role: string;
    emoji: string;
    description: string;
    relevance: number;
    isActive: boolean; // Blinking state
    summary?: string; // Core viewpoint
    onClick?: () => void;
}

export function ExpertCard({ name, role, emoji, description, relevance, isActive, onClick }: ExpertCardProps) {
    return (
        <motion.div
            className={cn(
                "relative group w-48 h-64 rounded-xl border border-white/10 bg-zinc-900/50 overflow-hidden cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/20",
                isActive ? "ring-2 ring-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)]" : ""
            )}
            onClick={onClick}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.02 }}
        >
            {/* Blinking overlay for active state */}
            {isActive && (
                <div className="absolute inset-0 bg-indigo-500/10 animate-pulse pointer-events-none" />
            )}

            <div className="p-4 flex flex-col h-full items-center text-center">
                {/* Emoji Avatar */}
                <div className="w-20 h-20 rounded-full bg-zinc-800/50 flex items-center justify-center text-4xl mb-4 shadow-inner border border-white/5">
                    {emoji}
                </div>

                {/* Name & Role */}
                <h3 className="text-zinc-100 font-semibold truncate w-full">{name}</h3>
                <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">{role}</p>

                {/* Relevance Meter */}
                <div className="w-full h-1 bg-zinc-800 rounded-full mt-auto mb-2 overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${relevance}%` }} />
                </div>
                <span className="text-xs text-zinc-500">{relevance}% Match</span>

                {/* Tooltip on Hover (Simple CSS based for now) */}
                <div className="absolute inset-0 bg-zinc-950/90 p-4 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center items-center text-sm">
                    <p className="text-zinc-300 italic">"{description}"</p>
                </div>
            </div>
        </motion.div>
    );
}
