import { ChevronRight, Download, Filter, Search } from 'lucide-react';
import { ActivityCard } from '../../types';

interface TimelineSidebarProps {
    cards: ActivityCard[];
    selectedCardId: number | null;
    onSelectCard: (id: number) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    selectedCategory?: string;
    onCategorySelect: (c: string | undefined) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
    'Work': 'bg-indigo-500',
    'Personal': 'bg-emerald-500',
    'Distraction': 'bg-rose-500',
    'Idle': 'bg-zinc-500',
    'Meeting': 'bg-amber-500'
};

export function TimelineSidebar({
    cards,
    selectedCardId,
    onSelectCard,
    searchQuery,
    onSearchChange,
    selectedCategory,
    onCategorySelect
}: TimelineSidebarProps) {
    const categories = ['All', 'Work', 'Personal', 'Distraction', 'Meeting'];

    const handleExport = async () => {
        if (window.ipcRenderer) {
            // Default to today for now, future can be dynamic date
            const today = new Date().toISOString().split('T')[0];
            const result = await window.ipcRenderer.invoke('export-timeline-markdown', today);
            if (result.success) {
                alert(`Exported to ${result.filePath}`);
            } else if (result.error && result.error !== 'Cancelled') {
                alert('Export failed: ' + result.error);
            }
        }
    };

    return (
        <div className="w-80 border-r border-zinc-800 bg-zinc-950 flex flex-col h-full shadow-2xl z-10">
            {/* Header with Search and Filter */}
            <div className="p-5 border-b border-zinc-900 space-y-5 sticky top-0 bg-zinc-950/95 backdrop-blur-xl z-10">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Timeline</h2>
                    <div className="flex items-center gap-1">
                        <div
                            onClick={handleExport}
                            className="p-1.5 rounded-md hover:bg-zinc-900 transition-colors cursor-pointer group"
                            title="Export to Markdown"
                        >
                            <Download size={14} className="text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                        </div>
                        <div className="p-1.5 rounded-md hover:bg-zinc-900 transition-colors cursor-pointer group">
                            <Filter size={14} className="text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                        </div>
                    </div>
                </div>

                {/* Search Input Container */}
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-zinc-300 transition-colors" size={14} />
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/50 transition-all shadow-sm"
                    />
                </div>

                {/* Category Chips */}
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide no-scrollbar mask-linear-gradient">
                    {categories.map(cat => (
                        <button
                            key={cat}
                            onClick={() => onCategorySelect(cat === 'All' ? undefined : cat)}
                            className={`
                                text-[10px] px-3 py-1.5 rounded-full whitespace-nowrap transition-all font-semibold tracking-wide border
                                ${selectedCategory === cat || (!selectedCategory && cat === 'All')
                                    ? 'bg-zinc-100 text-zinc-900 border-zinc-100 shadow-md transform scale-105'
                                    : 'bg-zinc-900/50 text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:bg-zinc-900 hover:border-zinc-700'}
                            `}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar">
                {cards.length === 0 && (
                    <div className="flex flex-col items-center justify-center p-8 text-center h-48 opacity-50">
                        <Search size={24} className="text-zinc-700 mb-2" />
                        <p className="text-zinc-600 text-xs italic">
                            {searchQuery ? 'No matching activities.' : 'No activities yet.'}
                        </p>
                    </div>
                )}

                <div className="divide-y divide-zinc-900/50">
                    {cards.map(card => {
                        const start = new Date(card.start_ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const colorClass = CATEGORY_COLORS[card.category] || 'bg-zinc-500';
                        const isSelected = card.id === selectedCardId;

                        return (
                            <div
                                key={card.id}
                                onClick={() => onSelectCard(card.id)}
                                className={`
                                    p-4 cursor-pointer transition-all duration-200 flex gap-3 relative group
                                    ${isSelected ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/40'}
                                `}
                            >
                                {/* Active Indicator Bar */}
                                {isSelected && (
                                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-500 shadow-[2px_0_12px_rgba(99,102,241,0.5)]" />
                                )}

                                {/* Category Dot */}
                                <div className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${colorClass} ${isSelected ? 'ring-2 ring-zinc-900 shadow-lg scale-110' : 'opacity-70 group-hover:opacity-100'} transition-all`} />

                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <span className={`text-[10px] font-mono tracking-tight transition-colors ${isSelected ? 'text-zinc-400' : 'text-zinc-600'}`}>{start}</span>
                                        <span className={`text-[9px] font-bold uppercase tracking-wider ${isSelected ? 'text-zinc-500' : 'text-zinc-700'} opacity-80`}>
                                            {card.category}
                                        </span>
                                    </div>
                                    <h3 className={`text-sm font-semibold truncate transition-colors leading-tight mb-1 ${isSelected ? 'text-indigo-200' : 'text-zinc-300 group-hover:text-zinc-100'}`}>
                                        {card.title}
                                    </h3>
                                    <p className="text-xs text-zinc-500 truncate leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity">
                                        {card.summary}
                                    </p>
                                </div>

                                <ChevronRight size={14} className={`self-center transition-all duration-300 transform ${isSelected ? 'text-indigo-400 opacity-100 translate-x-0' : 'text-zinc-700 opacity-0 -translate-x-3 group-hover:opacity-100 group-hover:translate-x-0'}`} />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
