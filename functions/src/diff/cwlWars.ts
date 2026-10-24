import { CocService } from '../services/cocService';
import { CurrentWarResponse, CwlGroupResponse } from '../types/coc';
import { mapWithConcurrency } from '../utils/concurrency';

const PARALLEL_WAR_FETCHES = 4; // a CWL round has 4 wars

function isOurs(war: CurrentWarResponse, clanTag: string): boolean {
  const tag = clanTag.toUpperCase();
  return war.clan.tag.toUpperCase() === tag || war.opponent.tag.toUpperCase() === tag;
}

/** War tags in a round that exist yet ('#0' means the round hasn't been drawn). */
export function roundWarTags(group: CwlGroupResponse, roundIndex: number): string[] {
  return (group.rounds?.[roundIndex]?.warTags || []).filter((t) => t && t !== '#0');
}

/**
 * Finds our clan's war in one CWL round (3.3). With `knownTag` (saved from an earlier poll) it's one
 * request; otherwise the round's 4 wars are fetched in parallel. Returns null if none is ours.
 */
export async function findOurCwlWar(
  warTags: string[],
  clanTag: string,
  coc: CocService,
  knownTag?: string
): Promise<{ warTag: string; war: CurrentWarResponse } | null> {
  if (knownTag && warTags.includes(knownTag)) {
    const war = await coc.getCwlWar(knownTag);
    if (isOurs(war, clanTag)) return { warTag: knownTag, war };
  }
  const wars = await mapWithConcurrency(warTags, PARALLEL_WAR_FETCHES, async (warTag) => {
    try {
      return { warTag, war: await coc.getCwlWar(warTag) };
    } catch (err: any) {
      console.warn(`[CWL] Could not fetch warTag ${warTag}: ${err.message}`);
      return null;
    }
  });
  return wars.find((w) => w && isOurs(w.war, clanTag)) ?? null;
}

/**
 * Our current CWL war: checks rounds newest first and stops early. On a war day the next round is
 * already in preparation, so an 'inWar' war wins over a 'preparation' one.
 */
export async function findActiveCwlWar(
  group: CwlGroupResponse,
  clanTag: string,
  coc: CocService,
  states: ReadonlyArray<'inWar' | 'preparation'> = ['inWar', 'preparation']
): Promise<{ warTag: string; war: CurrentWarResponse; roundIndex: number } | null> {
  let preparation: { warTag: string; war: CurrentWarResponse; roundIndex: number } | null = null;
  for (let r = (group.rounds?.length ?? 0) - 1; r >= 0; r--) {
    const tags = roundWarTags(group, r);
    if (tags.length === 0) continue;
    const found = await findOurCwlWar(tags, clanTag, coc);
    if (!found) continue;
    if (found.war.state === 'inWar' && states.includes('inWar')) return { ...found, roundIndex: r };
    if (found.war.state === 'preparation' && states.includes('preparation') && !preparation) {
      preparation = { ...found, roundIndex: r };
      continue;
    }
    // An older round that has ended means nothing earlier can be active
    if (found.war.state === 'warEnded') break;
  }
  return preparation;
}
