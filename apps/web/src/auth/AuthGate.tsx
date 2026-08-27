import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './useAuth';
import { useGameState } from '../game/useGameState';
import { gameStore } from '../game/store';
import {
  buildMigrationPayload,
  isMigrationDone,
  markMigrationDone,
  migrationOptions,
  shouldPromptMigration,
  summarizeLocalState,
  type MigrationChoice,
  type ProgressSummary,
} from '../sync/migration';
import { fetchCloudProgressSummary } from '../sync/cloudSummary';
import { createSupabaseRpcCaller } from '../sync/gameApi';
import { newRequestId } from '../lib/supabaseClient';
import { STARTING_STATE_CONFIG } from '../game/config';

// ============================================================================
// Этап 4 — экран входа + однократное сравнение локального/облачного
// прогресса. Рендерится ПЕРЕД игрой только когда облако включено
// (isCloudSyncEnabled) — если выключено, useAuth().status === 'disabled' и
// этот компонент сразу отдаёт children, не показывая ничего лишнего.
// ============================================================================

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.status === 'disabled') return <>{children}</>;

  if (auth.status === 'loading') {
    return (
      <div className="sheet-backdrop">
        <div className="sheet auth-gate-panel">
          <p>Подключаемся к облаку…</p>
        </div>
      </div>
    );
  }

  if (auth.status === 'error') {
    return (
      <div className="sheet-backdrop">
        <div className="sheet auth-gate-panel">
          <h2>Не получилось подключиться</h2>
          <p>{auth.error}</p>
          <p className="auth-gate-hint">Игра продолжает работать локально на этом устройстве.</p>
          {children}
        </div>
      </div>
    );
  }

  if (auth.status === 'signed_out') {
    return <SignInScreen />;
  }

  return <PostSignInGate>{children}</PostSignInGate>;
}

function SignInScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="sheet-backdrop">
      <div className="sheet auth-gate-panel">
        <h2>Genesis Garden</h2>
        <p>Войди, чтобы прогресс сохранялся в облаке и был доступен с других устройств.</p>

        <button
          className="sheet-buy-btn auth-gate-guest-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await auth.signInAsGuest();
            if (!result.ok) setError(result.error ?? 'Неизвестная ошибка');
            setBusy(false);
          }}
        >
          Играть как гость
        </button>

        {sent ? (
          <p className="auth-gate-hint">Письмо со ссылкой для входа отправлено на {email}. Проверь почту.</p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              const result = await auth.signInWithEmail(email);
              if (result.ok) setSent(true);
              else setError(result.error ?? 'Неизвестная ошибка');
              setBusy(false);
            }}
          >
            <input
              type="email"
              required
              placeholder="почта для входа по ссылке"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-gate-email-input"
            />
            <button type="submit" className="sheet-buy-btn" disabled={busy || !email}>
              Прислать ссылку для входа
            </button>
          </form>
        )}

        {error && <p className="auth-gate-error">{error}</p>}
      </div>
    </div>
  );
}

function PostSignInGate({ children }: { children: ReactNode }) {
  const localState = useGameState();
  const [phase, setPhase] = useState<'checking' | 'prompt' | 'done'>('checking');
  const [cloud, setCloud] = useState<ProgressSummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isMigrationDone()) {
      setPhase('done');
      return;
    }
    const local = summarizeLocalState(localState);
    if (!shouldPromptMigration(local, STARTING_STATE_CONFIG.startingCoins)) {
      // Нечего переносить — сразу помечаем перенесённым и продолжаем молча.
      markMigrationDone();
      setPhase('done');
      return;
    }
    fetchCloudProgressSummary().then((summary) => {
      if (cancelled) return;
      if (!summary) {
        // Не удалось прочитать облако (сеть/только что созданный сад) —
        // не блокируем игрока, попробуем предложить перенос в другой раз.
        setPhase('done');
        return;
      }
      setCloud(summary);
      setPhase('prompt');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'checking') {
    return (
      <div className="sheet-backdrop">
        <div className="sheet auth-gate-panel">
          <p>Сравниваем прогресс…</p>
        </div>
      </div>
    );
  }

  if (phase === 'done' || !cloud) return <>{children}</>;

  const local = summarizeLocalState(localState);
  const options = migrationOptions(local, cloud);

  async function apply(choice: MigrationChoice) {
    setBusy(true);
    const caller = createSupabaseRpcCaller();
    const payload = choice === 'keep_cloud' ? {} : buildMigrationPayload(gameStore.getState());
    await caller.call('migrate_local_progress' as never, {
      p_choice: choice,
      p_local_state: payload,
      p_request_id: newRequestId(),
    } as never);
    markMigrationDone();
    setBusy(false);
    setPhase('done');
  }

  return (
    <div className="sheet-backdrop">
      <div className="sheet auth-gate-panel">
        <h2>Нашли прогресс в двух местах</h2>
        <p>На этом устройстве и в твоём аккаунте есть разный прогресс. Что оставить?</p>
        {options.map((opt) => (
          <button
            key={opt.choice}
            className="sheet-buy-btn auth-gate-choice-btn"
            disabled={busy}
            onClick={() => apply(opt.choice)}
          >
            <strong>{opt.label}</strong>
            <span className="auth-gate-hint">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
