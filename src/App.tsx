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

function App() {
  const [page, setPage] = useState<'home' | 'settings' | 'onboarding' | 'journal' | 'timelapse' | 'timeline' | 'pulse' | 'analytics'>('home')
  const [loading, setLoading] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)

  // NOTE: Recording state logic will be moved to a context provider later for global access
  // For now, we keep it simple for the UI Migration

  // Check state on mount
  useEffect(() => {
    const checkState = async () => {
      try {
        // Using typed IPC - no more @ts-ignore!
        const { invoke } = await import('./lib/ipc');
        const settings = await invoke('get-settings');
        if (settings && !settings.onboarding_complete) {
          setPage('onboarding');
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoading(false);
      }
    }
    checkState()
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
    }
  }, [])


  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-500">Loading...</p>
      </div>
    )
  }

  if (page === 'onboarding') {
    return <Onboarding onComplete={() => setPage('home')} />
  }

  // Wrap everything else in the new App Shell
  return (
    <AppShell activePage={page} onNavigate={(p) => setPage(p as any)}>
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

      {/* Settings handles its own internal layout, but we might want to unify styles later. 
              For now, render it within the shell's content area. 
          */}
      {page === 'settings' && <Settings onBack={() => setPage('home')} />}
    </AppShell>
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

