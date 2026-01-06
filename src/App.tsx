import { useEffect, useState } from 'react'
import { AppShell } from './components/Shell/AppShell'
import { ActivityDetail } from './components/Timeline/ActivityDetail'
import { TimelineSidebar } from './components/Timeline/TimelineSidebar'
import type { TimelineCard } from './lib/ipc'
import { Analytics } from './pages/Analytics'
import { Dashboard } from './pages/Dashboard'
import { Journal } from './pages/Journal'
import { Onboarding } from './pages/Onboarding'
import { PulseFeed } from './pages/PulseFeed'
import { Settings } from './pages/Settings'
import { Timelapse } from './pages/Timelapse'

import { StartupSplash } from './components/StartupSplash'
import { useSystemStore, type AppState } from './stores/systemStore'

function App() {
  const [page, setPage] = useState<'home' | 'settings' | 'onboarding' | 'journal' | 'timelapse' | 'timeline' | 'pulse' | 'analytics'>('home')
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)

  const status = useSystemStore((state) => state.status);
  const setStatus = useSystemStore((state) => state.setStatus);

  // Check state on mount & Subscribe to Lifecycle
  useEffect(() => {
    // CRITICAL: Query current state immediately on mount
    // This handles the race condition where Main Process may have already
    // sent lifecycle events before React finished mounting
    const fetchCurrentState = async () => {
      try {
        // @ts-ignore
        const currentState = await window.ipcRenderer?.invoke('get-app-lifecycle');
        if (currentState && currentState !== status) {
          console.log('[App] Synced lifecycle state:', currentState);
          setStatus(currentState);
        }
      } catch (e) {
        console.warn('[App] Failed to fetch lifecycle state:', e);
      }
    };
    fetchCurrentState();

    // Subscribe to future lifecycle updates
    // @ts-ignore
    const cleanupLifecycle = window.electron?.on('app-lifecycle', (newStatus: AppState) => {
      console.log('[App] System Status:', newStatus);
      setStatus(newStatus);
    });

    // Subscribe to language changes
    // @ts-ignore
    const cleanupLang = window.electron?.on('language-changed', (lang: string) => {
      import('./i18n').then(({ default: i18n }) => {
        if (i18n.language !== lang) {
          i18n.changeLanguage(lang);
        }
      });
    });

    return () => {
      // @ts-ignore
      if (cleanupLang) cleanupLang();
      // @ts-ignore
      if (cleanupLifecycle) cleanupLifecycle();
    }
  }, []); // Only run once on mount!

  // Check onboarding when status changes to HYDRATING or READY
  useEffect(() => {
    if (status === 'HYDRATING' || status === 'READY') {
      const checkState = async () => {
        try {
          const { invoke } = await import('./lib/ipc');
          const settings = await invoke('get-settings');
          if (settings && !settings.onboarding_complete) {
            setPage('onboarding');
          }
        } catch (e) {
          console.error("Failed to load settings:", e);
        }
      }
      checkState();
    }
  }, [status]);


  return (
    <>
      <StartupSplash />

      <div className={`transition-opacity duration-700 ${status === 'BOOTING' ? 'opacity-0' : 'opacity-100'}`}>
        {page === 'onboarding' ? (
          <Onboarding onComplete={() => setPage('home')} />
        ) : (
          <AppShell activePage={page} onNavigate={(p) => setPage(p as any)}>
            <div className={`h-full flex flex-col transition-all duration-1000 ${status !== 'READY' ? 'filter blur-sm grayscale-[0.5] pointer-events-none' : ''}`}>
              {page === 'home' && <Dashboard />}

              {page === 'timeline' && (
                <div className="flex h-full overflow-hidden">
                  <TimelineContainer
                    selectedCardId={selectedCardId}
                    onSelectCard={setSelectedCardId}
                  />
                  <ActivityDetail cardId={selectedCardId} />
                </div>
              )}

              {page === 'journal' && <Journal />}
              {page === 'timelapse' && <Timelapse />}
              {page === 'pulse' && <PulseFeed />}
              {page === 'analytics' && <Analytics />}
              {page === 'settings' && <Settings onBack={() => setPage('home')} />}
            </div>
          </AppShell>
        )}
      </div>
    </>
  )
}

function TimelineContainer({ selectedCardId, onSelectCard }: { selectedCardId: number | null, onSelectCard: (id: number) => void }) {
  const [cards, setCards] = useState<TimelineCard[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | undefined>(undefined)

  useEffect(() => {
    const fetchCards = async () => {
      // Using typed IPC - no more @ts-ignore!
      const { invoke } = await import('./lib/ipc');
      const data = await invoke('get-timeline-cards', 50, 0, search, category);
      setCards(data);
    }

    fetchCards()
    fetchCards()

    // Subscribe to real-time events instead of polling
    // This reduces IPC overhead and improves responsiveness
    // @ts-ignore
    const cleanup = window.electron?.on('app-event', (event: any) => {
      // Refresh timeline when a new card is created
      if (event.type === 'card:created') {
        fetchCards();
      }
    });

    return () => {
      if (cleanup) cleanup();
    }
  }, [search, category]) // Re-fetch on filter change

  return (
    <TimelineSidebar
      cards={cards}
      selectedCardId={selectedCardId}
      onSelectCard={onSelectCard}
      searchQuery={search}
      onSearchChange={setSearch}
      selectedCategory={category}
      onCategorySelect={setCategory}
    />
  )
}

export default App

