import { describe, it, expect } from 'vitest';
import { goldPassBoosts, nextBoostStep } from '../src/services/goldPass';
import { LinkedAccount } from '../src/types/user';

const account = (goldPass?: LinkedAccount['goldPass']): LinkedAccount => ({
  playerTag: '#ANON12345',
  name: 'Tester',
  townHallLevel: 12,
  isPrimary: true,
  ...(goldPass ? { goldPass } : {}),
});
const october = Date.parse('2026-10-30T12:00:00Z');
const november = Date.parse('2026-11-01T00:00:00Z');

describe('Gold Pass boosts', () => {
  it('are off until set', () => {
    expect(goldPassBoosts(account(), october)).toEqual({ builder: 0, research: 0 });
  });

  it('step through 10, 15 and 20%, then off, one boost at a time', () => {
    const a = account();
    const seen = [1, 2, 3, 4].map(() => {
      a.goldPass = nextBoostStep(a, 'builder', october);
      return a.goldPass.builder;
    });
    expect(seen).toEqual([10, 15, 20, 0]);
    a.goldPass = nextBoostStep(a, 'research', october);
    expect(a.goldPass).toEqual({ builder: 0, research: 10, month: '2026-10' });
  });

  it("end with the month, so last month's pass never lowers this month's costs", () => {
    const a = account({ builder: 20, research: 15, month: '2026-10' });
    expect(goldPassBoosts(a, october)).toEqual({ builder: 20, research: 15 });
    expect(goldPassBoosts(a, november)).toEqual({ builder: 0, research: 0 });
    expect(nextBoostStep(a, 'builder', november)).toEqual({ builder: 10, research: 0, month: '2026-11' });
  });
});
