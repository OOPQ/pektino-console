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
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<LibraryPage />} />
              <Route path="queue" element={<QueuePage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="bin" element={<PlaceholderPage title="回收站" description="下一批迁移：恢复、彻底删除和清空回收站。" />} />
              <Route path="settings" element={<PlaceholderPage title="设置" description="下一批迁移：代理、Cookie、FFmpeg、并发、封面修复、日志和运行指标。" />} />
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
