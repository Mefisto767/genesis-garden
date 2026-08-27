import { createContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient, isCloudSyncEnabled } from '../lib/supabaseClient';

// ============================================================================
// Этап 4 — аккаунты. Активен только при VITE_CLOUD_SYNC_ENABLED=true и
// настроенных ключах Supabase (см. lib/supabaseClient.ts) — иначе status
// сразу 'disabled' и вся остальная игра работает как раньше, полностью
// локально. AuthGate.tsx (UI) рендерит экран входа только когда
// status !== 'disabled'.
// ============================================================================

export type AuthStatus = 'disabled' | 'loading' | 'signed_out' | 'signed_in' | 'error';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** true, если текущая сессия — анонимный гость (Supabase anonymous sign-in). */
  isGuest: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  signInAsGuest: () => Promise<{ ok: boolean; error?: string }>;
  signInWithEmail: (email: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
export type { AuthContextValue };

function initialState(): AuthState {
  return {
    status: isCloudSyncEnabled ? 'loading' : 'disabled',
    session: null,
    user: null,
    isGuest: false,
    error: null,
  };
}

function isAnonymousSession(session: Session | null): boolean {
  // Supabase помечает анонимных пользователей is_anonymous=true в самом User.
  return Boolean(session?.user && (session.user as unknown as { is_anonymous?: boolean }).is_anonymous);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    if (!isCloudSyncEnabled) return;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setState({ status: 'error', session: null, user: null, isGuest: false, error: 'supabase_not_configured' });
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setState({ status: 'error', session: null, user: null, isGuest: false, error: error.message });
        return;
      }
      setState({
        status: data.session ? 'signed_in' : 'signed_out',
        session: data.session,
        user: data.session?.user ?? null,
        isGuest: isAnonymousSession(data.session),
        error: null,
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        status: session ? 'signed_in' : 'signed_out',
        session,
        user: session?.user ?? null,
        isGuest: isAnonymousSession(session),
        error: null,
      });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signInAsGuest(): Promise<{ ok: boolean; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: 'supabase_not_configured' };
    setState((s) => ({ ...s, status: 'loading', error: null }));
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setState((s) => ({ ...s, status: 'error', error: error.message }));
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async function signInWithEmail(email: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: 'supabase_not_configured' };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function signOut(): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ ...state, signInAsGuest, signInWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
