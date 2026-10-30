/**
 * The Gold Pass's Builder and Research Boosts, which take a percentage off upgrade costs. Neither the
 * export nor the API says who has them (an export taken with the boost running has no field for it), so
 * players set them with the buttons on /status. Timers need nothing: the export's already include them.
 */
import { CostBoosts, NO_BOOSTS } from './gameDataService';
import { GoldPassSetting, LinkedAccount } from '../types/user';

export const BOOST_STEPS = [0, 10, 15, 20];

const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);

/** The account's boosts, if they were set this month: each month's Gold Pass starts over. */
export function goldPassBoosts(account: LinkedAccount, now: number = Date.now()): CostBoosts {
  const set = account.goldPass;
  return set?.month === monthOf(now) ? { builder: set.builder, research: set.research } : NO_BOOSTS;
}

/** The setting after moving one boost to its next step (off after the last), keeping the other. */
export function nextBoostStep(
  account: LinkedAccount,
  boost: keyof CostBoosts,
  now: number = Date.now()
): GoldPassSetting {
  const current = goldPassBoosts(account, now);
  const next = BOOST_STEPS[(BOOST_STEPS.indexOf(current[boost]) + 1) % BOOST_STEPS.length];
  return { ...current, [boost]: next, month: monthOf(now) };
}
