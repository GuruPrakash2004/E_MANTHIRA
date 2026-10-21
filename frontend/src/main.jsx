import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { MotionConfig } from 'framer-motion'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import './theme/global.css'
import { theme } from './theme/theme'
import { AuthProvider } from './hooks/useAuth'
import ConfirmProvider from './components/ui/ConfirmProvider'
import App from './App'


// Sensible app-wide defaults: reads stay fresh for 30 s (no refetch storm on every mount / window focus),
// 4xx errors are not retried (a 403/422 will not fix itself), server errors retry at most twice.
// Pages that need live data call refetch()/invalidateQueries() after their own writes.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => (error?.response?.status ?? 500) >= 500 && failureCount < 2,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <MotionConfig reducedMotion="user">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MotionConfig>
    </MantineProvider>
  </React.StrictMode>
)
