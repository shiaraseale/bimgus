import { EPIC_EQUIPMENT } from './cocMaxLevels';
import { EMOJIS } from '../constants/emojis';

/**
 * Helper to estimate and format the cost for the NEXT level of an upgrade.
 * Supports Gold, Elixir, Dark Elixir, Ores (Shiny, Glowy, Starry), and Builder Base resources.
 */

const DARK_ELIXIR_TROOPS = new Set([
  'Minion',
  'Hog Rider',
  'Valkyrie',
  'Golem',
  'Witch',
  'Lava Hound',
  'Bowler',
  'Ice Golem',
  'Headhunter',
  'Apprentice Warden',
  'Druid',
]);

const DARK_ELIXIR_SPELLS = new Set([
  'Poison Spell',
  'Earthquake Spell',
  'Haste Spell',
  'Skeleton Spell',
  'Bat Spell',
  'Overgrowth Spell',
]);

export function formatUpgradeCost(
  name: string,
  currentLevel: number,
  category: 'hero' | 'equipment' | 'troop' | 'spell' | 'building' | string,
  village: 'home' | 'builder' = 'home',
  hallLevel?: number
): string {
  const nextLevel = currentLevel + 1;

  // 1. Hero Equipment (Ores)
  if (category === 'equipment') {
    const isEpic = EPIC_EQUIPMENT.has(name);
    if (isEpic) {
      const shiny = Math.min(3000, 400 + (nextLevel - 1) * 110);
      const glowy = Math.min(350, 40 + (nextLevel - 1) * 15);
      const needsStarry = nextLevel % 3 === 0 && nextLevel >= 9;
      const starry = needsStarry ? (nextLevel >= 18 ? 15 : 10) : 0;
      return starry > 0
        ? `${Math.round(shiny / 100) * 100} ${EMOJIS.SHINY_ORE}, ${glowy} ${EMOJIS.GLOWY_ORE}, ${starry} ${EMOJIS.STARRY_ORE}`
        : `${Math.round(shiny / 100) * 100} ${EMOJIS.SHINY_ORE}, ${glowy} ${EMOJIS.GLOWY_ORE}`;
    } else {
      const shiny = Math.min(2700, 200 + (nextLevel - 1) * 150);
      const needsGlowy = nextLevel >= 8;
      const glowy = needsGlowy ? Math.min(280, 80 + (nextLevel - 8) * 20) : 0;
      return glowy > 0
        ? `${Math.round(shiny / 100) * 100} ${EMOJIS.SHINY_ORE}, ${glowy} ${EMOJIS.GLOWY_ORE}`
        : `${Math.round(shiny / 100) * 100} ${EMOJIS.SHINY_ORE}`;
    }
  }

  // 2. Heroes
  if (category === 'hero') {
    if (village === 'builder') {
      const beCost = Math.min(4.5, Math.round((1.0 + nextLevel * 0.08) * 10) / 10);
      return `${beCost}M ${EMOJIS.BUILDER_ELIXIR}`;
    }

    if (name === 'Grand Warden') {
      const elixCost = Math.min(18.0, Math.round((2.0 + nextLevel * 0.22) * 10) / 10);
      return `${elixCost}M ${EMOJIS.ELIXIR}`;
    }

    // Dark Elixir heroes (King, Queen, Royal Champion, Minion Prince)
    if (name === 'Royal Champion') {
      const deCost = Math.min(340, Math.round((100 + nextLevel * 5) / 5) * 5);
      return `${deCost}K ${EMOJIS.DARK_ELIXIR}`;
    }

    if (name === 'Minion Prince') {
      const deCost = Math.min(140, Math.round((15 + nextLevel * 2.5) / 5) * 5);
      return `${deCost}K ${EMOJIS.DARK_ELIXIR}`;
    }

    // Barbarian King / Archer Queen
    let deCostK = 10;
    if (nextLevel <= 10) deCostK = 10 + nextLevel * 2;
    else if (nextLevel <= 25) deCostK = 30 + (nextLevel - 10) * 3;
    else if (nextLevel <= 40) deCostK = 75 + (nextLevel - 25) * 4;
    else if (nextLevel <= 65) deCostK = 135 + (nextLevel - 40) * 3;
    else if (nextLevel <= 80) deCostK = 210 + (nextLevel - 65) * 3.5;
    else deCostK = 260 + (nextLevel - 80) * 3;

    return `${Math.round(deCostK / 5) * 5}K ${EMOJIS.DARK_ELIXIR}`;
  }

  // 3. Troops
  if (category === 'troop') {
    if (village === 'builder') {
      const bbCost = Math.min(4.5, Math.round((0.5 + nextLevel * 0.2) * 10) / 10);
      return `${bbCost}M ${EMOJIS.BUILDER_ELIXIR}`;
    }

    if (DARK_ELIXIR_TROOPS.has(name)) {
      let deK = Math.min(220, Math.round((20 + (nextLevel - 1) * 16) / 5) * 5);
      return `${deK}K ${EMOJIS.DARK_ELIXIR}`;
    }

    // Elixir Troops
    let elixM = 0.5;
    if (nextLevel <= 3) elixM = 0.5;
    else if (nextLevel <= 5) elixM = 1.2;
    else if (nextLevel <= 7) elixM = 2.5;
    else if (nextLevel <= 9) elixM = 4.5;
    else if (nextLevel <= 11) elixM = 8.0;
    else if (nextLevel <= 13) elixM = 12.0;
    else elixM = 15.0;

    return `${elixM.toFixed(1)}M ${EMOJIS.ELIXIR}`;
  }

  // 4. Spells
  if (category === 'spell') {
    if (DARK_ELIXIR_SPELLS.has(name)) {
      const deK = Math.min(160, Math.round((25 + (nextLevel - 1) * 15) / 5) * 5);
      return `${deK}K ${EMOJIS.DARK_ELIXIR}`;
    }

    let elixM = 1.0;
    if (nextLevel <= 3) elixM = 1.0;
    else if (nextLevel <= 5) elixM = 2.5;
    else if (nextLevel <= 7) elixM = 4.5;
    else if (nextLevel <= 9) elixM = 7.0;
    else elixM = 9.5;

    return `${elixM.toFixed(1)}M ${EMOJIS.ELIXIR}`;
  }

  // 5. Buildings / Defenses
  if (category === 'building') {
    if (name.toLowerCase().includes('town hall')) {
      const thUpgradeCosts: Record<number, string> = {
        1: `1K ${EMOJIS.GOLD}`,
        2: `4K ${EMOJIS.GOLD}`,
        3: `25K ${EMOJIS.GOLD}`,
        4: `150K ${EMOJIS.GOLD}`,
        5: `750K ${EMOJIS.GOLD}`,
        6: `1.2M ${EMOJIS.GOLD}`,
        7: `2.0M ${EMOJIS.GOLD}`,
        8: `3.0M ${EMOJIS.GOLD}`,
        9: `4.5M ${EMOJIS.GOLD}`,
        10: `6.0M ${EMOJIS.GOLD}`,
        11: `8.0M ${EMOJIS.GOLD}`,
        12: `10.5M ${EMOJIS.GOLD}`,
        13: `13.0M ${EMOJIS.GOLD}`,
        14: `16.0M ${EMOJIS.GOLD}`,
        15: `18.0M ${EMOJIS.GOLD}`,
        16: `21.0M ${EMOJIS.GOLD}`,
      };
      const thLookup = hallLevel || (currentLevel > 0 ? currentLevel : 12);
      return thUpgradeCosts[thLookup] || `10.5M ${EMOJIS.GOLD}`;
    }

    if (name.toLowerCase().includes('builder hall')) {
      const bhUpgradeCosts: Record<number, string> = {
        1: `1K ${EMOJIS.BUILDER_GOLD}`,
        2: `15K ${EMOJIS.BUILDER_GOLD}`,
        3: `120K ${EMOJIS.BUILDER_GOLD}`,
        4: `400K ${EMOJIS.BUILDER_GOLD}`,
        5: `1.2M ${EMOJIS.BUILDER_GOLD}`,
        6: `1.8M ${EMOJIS.BUILDER_GOLD}`,
        7: `2.4M ${EMOJIS.BUILDER_GOLD}`,
        8: `3.8M ${EMOJIS.BUILDER_GOLD}`,
        9: `4.8M ${EMOJIS.BUILDER_GOLD}`,
      };
      const bhLookup = hallLevel || (currentLevel > 0 ? currentLevel : 9);
      return bhUpgradeCosts[bhLookup] || `4.8M ${EMOJIS.BUILDER_GOLD}`;
    }

    if (name.includes('Gear-Up')) {
      if (nextLevel === 1) return `1.5M ${EMOJIS.GOLD}`;
      if (nextLevel === 2) return `4.0M ${EMOJIS.GOLD}`;
      return `8.0M ${EMOJIS.GOLD}`;
    }

    return village === 'builder' ? `1.5M ${EMOJIS.BUILDER_GOLD}` : `4.0M ${EMOJIS.GOLD}`;
  }

  return '';
}
