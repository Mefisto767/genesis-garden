import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./track', () => ({ track: vi.fn() }));

import { track } from './track';
import { recordSessionStart } from './retention';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = 'genesis-garden-first-seen-v1';

describe('recordSessionStart', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(track).mockClear();
  });

  it('всегда шлёт session_started', () => {
    recordSessionStart(1000);
    expect(track).toHaveBeenCalledWith('session_started');
  });

  it('первый визит запоминает время, но не шлёт day_1/day_7', () => {
    recordSessionStart(1000);
    expect(track).not.toHaveBeenCalledWith('day_1_return');
    expect(track).not.toHaveBeenCalledWith('day_7_return');
    expect(localStorage.getItem(KEY)).toBe('1000');
  });

  it('визит ровно через сутки шлёт day_1_return', () => {
    recordSessionStart(1000);
    vi.mocked(track).mockClear();
    recordSessionStart(1000 + DAY_MS);
    expect(track).toHaveBeenCalledWith('day_1_return');
    expect(track).not.toHaveBeenCalledWith('day_7_return');
  });

  it('визит ровно через 7 суток шлёт day_7_return', () => {
    recordSessionStart(1000);
    vi.mocked(track).mockClear();
    recordSessionStart(1000 + 7 * DAY_MS);
    expect(track).toHaveBeenCalledWith('day_7_return');
    expect(track).not.toHaveBeenCalledWith('day_1_return');
  });

  it('визит в тот же день (day 0) не шлёт ни day_1, ни day_7', () => {
    recordSessionStart(1000);
    vi.mocked(track).mockClear();
    recordSessionStart(1000 + 60 * 60 * 1000); // +1 час
    expect(track).not.toHaveBeenCalledWith('day_1_return');
    expect(track).not.toHaveBeenCalledWith('day_7_return');
  });

  it('визит на день 3 (не 1 и не 7) не шлёт возвратные события', () => {
    recordSessionStart(1000);
    vi.mocked(track).mockClear();
    recordSessionStart(1000 + 3 * DAY_MS);
    expect(track).not.toHaveBeenCalledWith('day_1_return');
    expect(track).not.toHaveBeenCalledWith('day_7_return');
  });

  it('повреждённое значение в localStorage не роняет вызов — просто пересчитывает точку отсчёта', () => {
    localStorage.setItem(KEY, 'not-a-number');
    expect(() => recordSessionStart(5000)).not.toThrow();
    expect(localStorage.getItem(KEY)).toBe('5000');
  });
});
