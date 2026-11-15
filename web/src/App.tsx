import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell, PlaceholderPage } from '@/components/app-shell'
import { LibraryPage } from '@/features/library/library-page'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={220}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<LibraryPage />} />
              <Route path="queue" element={<PlaceholderPage title="下载队列" description="下一批迁移：进行中 / 已完成 / 失败 / 已取消，进度、暂停、取消、重试和并发控制。" />} />
              <Route path="collections" element={<PlaceholderPage title="合集" description="下一批迁移：合集卡片墙、合集编辑、颜色、批量加入和在台账中查看。" />} />
              <Route path="bin" element={<PlaceholderPage title="回收站" description="下一批迁移：恢复、彻底删除和清空回收站。" />} />
              <Route path="settings" element={<PlaceholderPage title="设置" description="下一批迁移：代理、Cookie、FFmpeg、并发、封面修复、日志和运行指标。" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
