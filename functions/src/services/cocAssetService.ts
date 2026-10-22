/**
 * Service to resolve high-resolution transparent assets (Town Halls, Builder Halls,
 * Heroes, Troops, Spells, Equipment, Helpers, and Defenses) sourced directly from Supercell's game files.
 */
export class CocAssetService {
  private static BASE_URL = 'https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/assets';

  /**
   * Cleans and normalizes item names to match asset file paths.
   */
  static normalize(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[\s\.\-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  /**
   * Official Town Hall level image URL (Levels 1 to 18).
   * Appears in the top-right thumbnail of Discord embed messages.
   */
  static getTownHallUrl(level: number): string {
    const safeLevel = Math.max(1, Math.min(18, Math.floor(level)));
    return `${this.BASE_URL}/buildings/home-village/town_hall/level_${safeLevel}.webp`;
  }

  /**
   * Official Builder Hall level image URL (Levels 1 to 10).
   */
  static getBuilderHallUrl(level: number): string {
    const safeLevel = Math.max(1, Math.min(10, Math.floor(level)));
    return `${this.BASE_URL}/buildings/builder-base/builder_hall/level_${safeLevel}.webp`;
  }

  /**
   * Official B.O.B (6th Builder) / B.O.B Control asset URL.
   * Tasks completed (0 to 4) maps to B.O.B Control levels 1 to 5.
   */
  static getBobUrl(tasksCompleted: number = 4): string {
    const level = Math.max(1, Math.min(5, Math.floor(tasksCompleted) + 1));
    return `${this.BASE_URL}/buildings/builder-base/bob_control/level_${level}.webp`;
  }

  /**
   * Official Player League Badge image URL from live profile.
   * Checks both new ranked League Tiers and legacy multiplayer league badges.
   */
  static getPlayerLeagueUrl(player: any): string | undefined {
    if (!player) return undefined;
    return (
      player.leagueTier?.iconUrls?.large ||
      player.leagueTier?.iconUrls?.small ||
      player.league?.iconUrls?.large ||
      player.league?.iconUrls?.medium ||
      player.league?.iconUrls?.small
    );
  }

  /**
   * Official Hero icon URL.
   */
  static getHeroUrl(heroName: string): string {
    const slug = this.normalize(heroName);
    return `${this.BASE_URL}/heroes/${slug}/icon.webp`;
  }

  /**
   * Official Hero Equipment icon URL.
   */
  static getEquipmentUrl(equipmentName: string): string {
    const slug = this.normalize(equipmentName);
    return `${this.BASE_URL}/equipment/${slug}.webp`;
  }

  /**
   * Official Troop icon URL.
   */
  static getTroopUrl(troopName: string): string {
    const slug = this.normalize(troopName);
    return `${this.BASE_URL}/troops/${slug}/icon.webp`;
  }

  /**
   * Official Spell icon URL.
   */
  static getSpellUrl(spellName: string): string {
    let slug = this.normalize(spellName);
    if (!slug.endsWith('_spell')) {
      slug += '_spell';
    }
    return `${this.BASE_URL}/spells/${slug}.webp`;
  }

  /**
   * Official Apprentice Builder / Assistant image URL.
   */
  static getApprenticeUrl(type: 'builder' | 'lab' = 'builder'): string {
    return type === 'lab'
      ? `${this.BASE_URL}/helpers/lab_assistant.webp`
      : `${this.BASE_URL}/helpers/builder%27s_apprentice.webp`;
  }

  /**
   * Official Building image URL by name and level.
   */
  static getBuildingUrl(buildingName: string, level: number = 1, village: 'home' | 'builder' = 'home'): string {
    const subfolder = village === 'builder' ? 'builder-base' : 'home-village';
    const slug = this.normalize(buildingName);
    return `${this.BASE_URL}/buildings/${subfolder}/${slug}/level_${level}.webp`;
  }

  /**
   * Universal resolver: given item name, category, and level, returns the asset thumbnail URL
   * to place in the top-right of Discord embeds.
   */
  static getThumbnail(
    name: string,
    category?: 'hero' | 'equipment' | 'troop' | 'spell' | 'townHall' | 'builderHall' | 'defense' | 'building' | string,
    level?: number,
    village?: 'home' | 'builder'
  ): string {
    const lowerName = name.toLowerCase();

    // 1. Town Hall
    if (category === 'townHall' || lowerName.includes('town hall') || lowerName === 'th') {
      return this.getTownHallUrl(level || 1);
    }

    // 2. Builder Hall
    if (category === 'builderHall' || lowerName.includes('builder hall') || lowerName === 'bh') {
      return this.getBuilderHallUrl(level || 1);
    }

    // 3. Heroes
    const knownHeroes = [
      'barbarian king',
      'archer queen',
      'grand warden',
      'royal champion',
      'minion prince',
      'dragon duke',
      'battle machine',
      'battle copter',
    ];
    if (category === 'hero' || knownHeroes.some((h) => lowerName.includes(h))) {
      return this.getHeroUrl(name);
    }

    // 4. Equipment
    if (category === 'equipment') {
      return this.getEquipmentUrl(name);
    }

    // 5. Spells
    if (category === 'spell' || lowerName.includes('spell')) {
      return this.getSpellUrl(name);
    }

    // 6. Troops
    if (category === 'troop') {
      return this.getTroopUrl(name);
    }

    // 7. Helpers
    if (lowerName.includes('apprentice') || lowerName.includes('builder apprentice')) {
      return this.getApprenticeUrl('builder');
    }
    if (lowerName.includes('lab assistant') || lowerName.includes('assistant')) {
      return this.getApprenticeUrl('lab');
    }

    // 8. Buildings / Defenses
    if (category === 'defense' || category === 'building') {
      return this.getBuildingUrl(name, level || 1, village || 'home');
    }

    // Default to Town Hall level thumbnail if level provided, or TH17 default
    return this.getTownHallUrl(level || 17);
  }
}
