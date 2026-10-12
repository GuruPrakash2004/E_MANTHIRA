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
import { applyPalette, storedPalette } from './components/PaletteSwitch'

applyPalette(storedPalette())

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <MotionConfig reducedMotion="user">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
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
