import { describe, expect, it, beforeEach } from 'vitest';
import { hasSeenOnboarding, markOnboardingSeen } from './onboardingState';

const KEY = 'genesis-garden-onboarding-seen-v1';

describe('onboardingState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('первый визит — онбординг ещё не виден', () => {
    expect(hasSeenOnboarding()).toBe(false);
  });

  it('после markOnboardingSeen() онбординг считается увиденным', () => {
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('повторный markOnboardingSeen() идемпотентен', () => {
    markOnboardingSeen();
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });
});
