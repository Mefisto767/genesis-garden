import { describe, expect, it } from 'vitest';
import { deriveLumiState, lumiFollowStep, LUMI_FOLLOW_SLACK, LUMI_SPEED } from './lumiBehavior';

describe('lumiFollowStep', () => {
  it('does not move when already within the follow slack distance', () => {
    const pos = { x: 100, y: 100 };
    const player = { x: 100 + LUMI_FOLLOW_SLACK - 5, y: 100 };
    const next = lumiFollowStep(pos, player, 1);
    expect(next).toEqual(pos);
  });

  it('moves toward the player when farther than the slack distance', () => {
    const pos = { x: 0, y: 0 };
    const player = { x: 1000, y: 0 };
    const next = lumiFollowStep(pos, player, 0.1);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThanOrEqual(LUMI_SPEED * 0.1 + 0.001);
    expect(next.y).toBe(0);
  });

  it('never overshoots past the follow-slack distance from the player', () => {
    const pos = { x: 0, y: 0 };
    const player = { x: 60, y: 0 }; // dist 60, slack 46, remaining 14
    const next = lumiFollowStep(pos, player, 10); // huge dt — should clamp to remaining, not overshoot
    const distAfter = Math.hypot(player.x - next.x, player.y - next.y);
    expect(distAfter).toBeCloseTo(LUMI_FOLLOW_SLACK, 5);
  });

  it('is a pure function — same inputs produce same outputs, no shared mutable state', () => {
    const pos = { x: 10, y: 20 };
    const player = { x: 200, y: 20 };
    const a = lumiFollowStep(pos, player, 0.5);
    const b = lumiFollowStep(pos, player, 0.5);
    expect(a).toEqual(b);
    // и не мутирует входные точки
    expect(pos).toEqual({ x: 10, y: 20 });
  });

  it('handles zero dt without NaN', () => {
    const next = lumiFollowStep({ x: 0, y: 0 }, { x: 500, y: 500 }, 0);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
  });
});

describe('deriveLumiState', () => {
  it('is idle when nothing is moving and nothing is nearby', () => {
    expect(deriveLumiState({ playerIsMoving: false, nearInteractable: false, lumiIsMoving: false })).toBe('idle');
  });

  it('follows when the player is moving', () => {
    expect(deriveLumiState({ playerIsMoving: true, nearInteractable: false, lumiIsMoving: false })).toBe('follow');
  });

  it('follows when lumi itself is still catching up, even if player stopped', () => {
    expect(deriveLumiState({ playerIsMoving: false, nearInteractable: false, lumiIsMoving: true })).toBe('follow');
  });

  it('points when near an interactable, taking priority over movement', () => {
    expect(deriveLumiState({ playerIsMoving: true, nearInteractable: true, lumiIsMoving: true })).toBe('point');
  });

  it('never returns "work" — reserved for a future stage, not implemented yet', () => {
    const combos = [
      { playerIsMoving: true, nearInteractable: true, lumiIsMoving: true },
      { playerIsMoving: false, nearInteractable: false, lumiIsMoving: false },
      { playerIsMoving: true, nearInteractable: false, lumiIsMoving: false },
    ];
    for (const c of combos) expect(deriveLumiState(c)).not.toBe('work');
  });
});
