import { AnimatePresence } from 'framer-motion';
import { ExpertCard, ExpertCardProps } from './ExpertCard';
import { useTranslation } from 'react-i18next';

interface ExpertDeckProps {
    experts: ExpertCardProps[];
}

export function ExpertDeck({ experts }: ExpertDeckProps) {
    const { t } = useTranslation();
    if (experts.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-zinc-600">
                <p>{t('sprouts.waiting_experts')}</p>
            </div>
        );
    }

    return (
        <div className="flex gap-4 p-4 overflow-x-auto no-scrollbar items-center justify-center min-h-[300px]">
            <AnimatePresence>
                {experts.map(expert => (
                    <ExpertCard key={expert.id} {...expert} />
                ))}
            </AnimatePresence>
        </div>
    );
}
