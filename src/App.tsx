import { useEffect, useState } from 'react'
import { AppShell } from './components/Shell/AppShell'
import { ActivityDetail } from './components/Timeline/ActivityDetail'
import { TimelineSidebar } from './components/Timeline/TimelineSidebar'
import { Dashboard } from './pages/Dashboard'
import { Journal } from './pages/Journal'
import { Onboarding } from './pages/Onboarding'
import { PulseFeed } from './pages/PulseFeed'
import { Settings } from './pages/Settings'
import { Timelapse } from './pages/Timelapse'
import { ActivityCard } from './types'

function App() {
  const [page, setPage] = useState<'home' | 'settings' | 'onboarding' | 'journal' | 'timelapse' | 'timeline' | 'pulse'>('home')
  const [loading, setLoading] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)

  // NOTE: Recording state logic will be moved to a context provider later for global access
  // For now, we keep it simple for the UI Migration

  // Check state on mount
  useEffect(() => {
    const checkState = async () => {
      try {
        // @ts-ignore
        if (window.ipcRenderer) {
          // @ts-ignore
          const settings = await window.ipcRenderer.invoke('get-settings');
          if (settings && !settings.onboarding_complete) {
            setPage('onboarding');
          }
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoading(false);
      }
    }
    checkState()
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

      {/* Settings handles its own internal layout, but we might want to unify styles later. 
              For now, render it within the shell's content area. 
          */}
      {page === 'settings' && <Settings onBack={() => setPage('home')} />}
    </AppShell>
  )
}

function TimelineContainer({ selectedCardId, onSelectCard }: { selectedCardId: number | null, onSelectCard: (id: number) => void }) {
  const [cards, setCards] = useState<ActivityCard[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | undefined>(undefined)

  useEffect(() => {
    const fetch = async () => {
      // @ts-ignore
      const data = await window.ipcRenderer.invoke('get-timeline-cards', 50, 0, search, category)
      setCards(data)
    }

    fetch()
    const interval = setInterval(fetch, 5000) // Poll every 5s for new cards
    return () => clearInterval(interval)
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

