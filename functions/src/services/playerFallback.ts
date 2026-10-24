import { CocService } from './cocService';
import { LinkedAccount } from '../types/user';
import type { PlayerLike } from '../types/coc';

/**
 * Fetches a player live, falling back to the last saved snapshot (e.g. during Supercell maintenance).
 */
export async function getPlayerWithFallback(coc: CocService, account: LinkedAccount): Promise<{ player: PlayerLike; isCached: boolean }> {
  try {
    const fresh = await coc.getPlayer(account.playerTag);
    return { player: fresh, isCached: false };
  } catch (err: any) {
    const isMaintenance =
      err.response?.status === 503 ||
      err.response?.data?.reason === 'inMaintenance' ||
      err.message?.includes('503') ||
      err.message?.includes('inMaintenance');

    if (account.lastSnapshot) {
      const snap = account.lastSnapshot;
      const fromSnapshot = (list: Record<string, any> | undefined) =>
        Object.entries(list || {}).map(([key, x]: any) => ({
          name: x.name ?? key.replace(/^(home|builder):/, ''),
          level: x.level,
          maxLevel: x.maxLevel,
          village: x.village,
        }));
      const fallbackPlayer = {
        tag: snap.tag || account.playerTag,
        name: snap.name || account.name,
        townHallLevel: snap.townHallLevel || account.townHallLevel || 9,
        builderHallLevel: snap.builderHallLevel || account.builderHallLevel || 0,
        heroes: fromSnapshot(snap.heroes),
        heroEquipment: fromSnapshot(snap.heroEquipment),
        troops: fromSnapshot(snap.troops),
        spells: fromSnapshot(snap.spells),
        achievements: [],
      };
      return { player: fallbackPlayer, isCached: true };
    }

    if (isMaintenance) {
      throw new Error('🛠️ Clash of Clans API is currently down for maintenance by Supercell ("API is currently in maintenance, please come back later"). Please try again once maintenance concludes!');
    }
    throw err;
  }
}
