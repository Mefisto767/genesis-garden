import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'
import { AuthGate } from './auth/AuthGate'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import { installErrorReporting } from './monitoring/errorReporting'

// Этап 9 — необязательный адаптер отчётов об ошибках (без ключа — no-op) и
// регистрация service worker для офлайн/установки как PWA.
installErrorReporting()
registerServiceWorker()

// AuthProvider/AuthGate — Этап 4, облачные аккаунты. Когда облако выключено
// (по умолчанию, см. lib/supabaseClient.ts), AuthGate рендерит <App/> сразу
// без каких-либо экранов — поведение идентично версии без Этапа 4.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
)
