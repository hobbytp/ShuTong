import { SproutView } from '../features/sprout/SproutView';
import { SproutGarden } from '../features/sprout/SproutGarden';
import { useSproutStore } from '../features/sprout/store';

export function SproutPage() {
    const { activeSproutId } = useSproutStore();

    if (!activeSproutId) {
        return <SproutGarden />;
    }

    return <SproutView />;
}
