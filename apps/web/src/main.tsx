import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'
import { AuthGate } from './auth/AuthGate'

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
