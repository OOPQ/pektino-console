import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useUiStore } from '@/store/ui'
import { AppShell, PlaceholderPage } from '@/components/app-shell'
import { LibraryPage } from '@/features/library/library-page'
import { QueuePage } from '@/features/queue/queue-page'
import { CollectionsPage } from '@/features/collections/collections-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { BinPage } from '@/features/bin/bin-page'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function ToasterHost() {
  const theme = useUiStore(s => s.theme)
  return <Toaster theme={theme} position="bottom-right" richColors closeButton />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={220}>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<LibraryPage />} />
              <Route path="queue" element={<QueuePage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="bin" element={<BinPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <ConfirmDialog />
        <ToasterHost />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
