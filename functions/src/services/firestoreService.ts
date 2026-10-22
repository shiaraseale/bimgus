import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  ClanSnapshotDoc,
  WarSnapshotDoc,
  RaidSnapshotDoc,
  BotConfigDoc,
  CwlSnapshotDoc,
  ClanGamesSnapshotDoc,
} from '../types/db';
import { UserDoc, LinkedAccount, ActiveUpgrade, ApprenticeTimer } from '../types/user';
import { config } from '../config';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp();
}

export const db = getFirestore();

export class FirestoreService {
  private static clansCol = db.collection('clans');
  private static usersCol = db.collection('users');
  private static pollsCol = db.collection('warPolls');
  private static pendingInteractionsCol = db.collection('pendingInteractions');

  /**
   * Tracks an active/pending deferred interaction token for a user so it can be cancelled if stuck.
   */
  static async setPendingInteraction(discordUserId: string, token: string): Promise<void> {
    try {
      await this.pendingInteractionsCol.doc(discordUserId).set({
        token,
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.warn('[Firestore] Failed to save pending interaction:', err.message);
    }
  }

  /**
   * Retrieves any active pending interaction token for a user.
   */
  static async getPendingInteraction(discordUserId: string): Promise<string | null> {
    try {
      const doc = await this.pendingInteractionsCol.doc(discordUserId).get();
      return doc.exists ? (doc.data()?.token || null) : null;
    } catch {
      return null;
    }
  }

  /**
   * Clears the pending interaction token when a command completes.
   */
  static async clearPendingInteraction(discordUserId: string): Promise<void> {
    try {
      await this.pendingInteractionsCol.doc(discordUserId).delete();
    } catch {}
  }

  /**
   * Retrieves the current bot configuration for a clan.
   */
  static async getConfig(clanTag: string): Promise<BotConfigDoc> {
    const formattedTag = config.formatTag(clanTag);
    const docRef = this.clansCol.doc(formattedTag).collection('config').doc('botSettings');
    const doc = await docRef.get();

    const defaultConfig: BotConfigDoc = {
      clanTag: formattedTag,
      webhooks: {
        clanActivity: config.webhooks.clanActivity,
        warRoom: config.webhooks.warRoom,
        cwlHub: config.webhooks.cwlHub || config.webhooks.warRoom,
        raidWeekend: config.webhooks.raidWeekend,
        clanGames: config.webhooks.clanGames,
      },
      notificationsEnabled: {
        memberJoinedLeft: true,
        roleChanges: true,
        thUpgrades: true,
        warAttacks: true,
        warEndSummary: true,
        warAttackReminders: true,
        raidDistricts: true,
        cwlGroup: true,
        cwlRoundSummary: true,
        clanGamesStart: true,
        clanGamesTiers: true,
        clanGamesMaxers: true,
      },
      warReminderHours: [4, 1],
    };

    if (!doc.exists) {
      await docRef.set(defaultConfig);
      return defaultConfig;
    }

    const saved = doc.data() as Partial<BotConfigDoc>;
    return {
      clanTag: formattedTag,
      webhooks: {
        clanActivity: saved.webhooks?.clanActivity || defaultConfig.webhooks.clanActivity,
        warRoom: saved.webhooks?.warRoom || defaultConfig.webhooks.warRoom,
        cwlHub: saved.webhooks?.cwlHub || defaultConfig.webhooks.cwlHub || saved.webhooks?.warRoom || defaultConfig.webhooks.warRoom,
        raidWeekend: saved.webhooks?.raidWeekend || defaultConfig.webhooks.raidWeekend,
        clanGames: saved.webhooks?.clanGames || defaultConfig.webhooks.clanGames,
      },
      notificationsEnabled: {
        memberJoinedLeft: saved.notificationsEnabled?.memberJoinedLeft ?? true,
        roleChanges: saved.notificationsEnabled?.roleChanges ?? true,
        thUpgrades: saved.notificationsEnabled?.thUpgrades ?? true,
        warAttacks: saved.notificationsEnabled?.warAttacks ?? true,
        warEndSummary: saved.notificationsEnabled?.warEndSummary ?? true,
        warAttackReminders: saved.notificationsEnabled?.warAttackReminders ?? true,
        raidDistricts: saved.notificationsEnabled?.raidDistricts ?? true,
        cwlGroup: saved.notificationsEnabled?.cwlGroup ?? true,
        cwlRoundSummary: saved.notificationsEnabled?.cwlRoundSummary ?? true,
        clanGamesStart: saved.notificationsEnabled?.clanGamesStart ?? true,
        clanGamesTiers: saved.notificationsEnabled?.clanGamesTiers ?? true,
        clanGamesMaxers: saved.notificationsEnabled?.clanGamesMaxers ?? true,
      },
      warReminderHours: saved.warReminderHours || defaultConfig.warReminderHours,
    };
  }

  /**
   * Updates bot configuration (e.g. from the co-leader dashboard).
   */
  static async updateConfig(clanTag: string, update: Partial<BotConfigDoc>): Promise<void> {
    const formattedTag = config.formatTag(clanTag);
    const docRef = this.clansCol.doc(formattedTag).collection('config').doc('botSettings');
    await docRef.set(update, { merge: true });
  }

  /**
   * Gets the last known clan snapshot.
   */
  static async getClanSnapshot(clanTag: string): Promise<ClanSnapshotDoc | null> {
    try {
      const formattedTag = config.formatTag(clanTag);
      const doc = await this.clansCol.doc(formattedTag).get();
      return doc.exists ? (doc.data() as ClanSnapshotDoc) : null;
    } catch (err: any) {
      console.warn(`[Firestore] Unable to read clan snapshot (${err.message}). Falling back to live API.`);
      return null;
    }
  }

  /**
   * Saves an updated clan snapshot.
   */
  static async saveClanSnapshot(snapshot: ClanSnapshotDoc): Promise<void> {
    const formattedTag = config.formatTag(snapshot.tag);
    await this.clansCol.doc(formattedTag).set(snapshot, { merge: true });
  }

  /**
   * Gets the active war snapshot.
   */
  static async getWarSnapshot(clanTag: string): Promise<WarSnapshotDoc | null> {
    const formattedTag = config.formatTag(clanTag);
    const doc = await this.clansCol.doc(formattedTag).collection('wars').doc('current').get();
    return doc.exists ? (doc.data() as WarSnapshotDoc) : null;
  }

  /**
   * Saves the current war snapshot.
   */
  static async saveWarSnapshot(clanTag: string, war: WarSnapshotDoc): Promise<void> {
    const formattedTag = config.formatTag(clanTag);
    await this.clansCol.doc(formattedTag).collection('wars').doc('current').set(war, { merge: true });
  }

  /**
   * Gets the raid weekend snapshot.
   */
  static async getRaidSnapshot(clanTag: string): Promise<RaidSnapshotDoc | null> {
    const formattedTag = config.formatTag(clanTag);
    const doc = await this.clansCol.doc(formattedTag).collection('raids').doc('current').get();
    return doc.exists ? (doc.data() as RaidSnapshotDoc) : null;
  }

  /**
   * Saves the raid weekend snapshot.
   */
  static async saveRaidSnapshot(clanTag: string, raid: RaidSnapshotDoc): Promise<void> {
    const formattedTag = config.formatTag(clanTag);
    await this.clansCol.doc(formattedTag).collection('raids').doc('current').set(raid, { merge: true });
  }

  /**
   * Gets the CWL snapshot.
   */
  static async getCwlSnapshot(clanTag: string): Promise<CwlSnapshotDoc | null> {
    const formattedTag = config.formatTag(clanTag);
    const doc = await this.clansCol.doc(formattedTag).collection('cwl').doc('current').get();
    return doc.exists ? (doc.data() as CwlSnapshotDoc) : null;
  }

  /**
   * Saves the CWL snapshot.
   */
  static async saveCwlSnapshot(clanTag: string, cwl: CwlSnapshotDoc): Promise<void> {
    const formattedTag = config.formatTag(clanTag);
    await this.clansCol.doc(formattedTag).collection('cwl').doc('current').set(cwl, { merge: true });
  }

  /**
   * Gets the Clan Games snapshot.
   */
  static async getClanGamesSnapshot(clanTag: string): Promise<ClanGamesSnapshotDoc | null> {
    const formattedTag = config.formatTag(clanTag);
    const doc = await this.clansCol.doc(formattedTag).collection('clangames').doc('current').get();
    return doc.exists ? (doc.data() as ClanGamesSnapshotDoc) : null;
  }

  /**
   * Saves the Clan Games snapshot.
   */
  static async saveClanGamesSnapshot(clanTag: string, cg: ClanGamesSnapshotDoc): Promise<void> {
    const formattedTag = config.formatTag(clanTag);
    await this.clansCol.doc(formattedTag).collection('clangames').doc('current').set(cg, { merge: true });
  }

  /**
   * Gets a user's multi-account document.
   */
  static async getUser(discordUserId: string): Promise<UserDoc | null> {
    const doc = await this.usersCol.doc(discordUserId).get();
    return doc.exists ? (doc.data() as UserDoc) : null;
  }

  /**
   * Saves or updates a user document.
   */
  static async saveUser(user: UserDoc): Promise<void> {
    await this.usersCol.doc(user.discordUserId).set({
      ...user,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  /**
   * Toggles B.O.B Defense Level 9 completion status for a specific linked account.
   */
  static async setBobDefenseCompleted(discordUserId: string, playerTag: string, completed: boolean): Promise<boolean> {
    const user = await this.getUser(discordUserId);
    if (!user || !user.accounts) return false;
    const cleanTag = config.formatTag(playerTag).toUpperCase();
    const acc = user.accounts.find((a) => a.playerTag.toUpperCase() === cleanTag);
    if (!acc) return false;
    acc.bobDefenseCompleted = completed;
    await this.saveUser(user);
    return true;
  }

  /**
   * Gets all users registered for upgrade tracking.
   */
  static async getAllUsers(): Promise<UserDoc[]> {
    const snapshot = await this.usersCol.get();
    return snapshot.docs.map((doc: any) => doc.data() as UserDoc);
  }

  /**
   * Links or updates a player account for a Discord user.
   */
  static async linkAccount(
    discordUserId: string,
    account: LinkedAccount
  ): Promise<UserDoc> {
    const existing = await this.getUser(discordUserId);
    const now = new Date().toISOString();

    if (!existing) {
      const newUser: UserDoc = {
        discordUserId,
        activeAccountTag: account.playerTag,
        dmsEnabled: account.dmsEnabled ?? true,
        accounts: [account],
        createdAt: now,
        updatedAt: now,
      };
      await this.saveUser(newUser);
      return newUser;
    }

    const index = existing.accounts.findIndex(
      (a) => a.playerTag.toUpperCase() === account.playerTag.toUpperCase()
    );

    let updatedAccounts = [...existing.accounts];
    if (index >= 0) {
      updatedAccounts[index] = { ...updatedAccounts[index], ...account, isPrimary: false };
    } else {
      updatedAccounts.push({ ...account, isPrimary: false });
    }

    // Default to 'ALL' when multiple accounts exist so all accounts are equal
    const newActiveTag =
      existing.activeAccountTag && existing.activeAccountTag !== ''
        ? existing.activeAccountTag
        : (updatedAccounts.length > 1 ? 'ALL' : account.playerTag);

    const updatedUser: UserDoc = {
      ...existing,
      activeAccountTag: newActiveTag,
      dmsEnabled: account.dmsEnabled !== undefined ? account.dmsEnabled : (existing.dmsEnabled ?? true),
      accounts: updatedAccounts,
      updatedAt: now,
    };

    await this.saveUser(updatedUser);
    return updatedUser;
  }

  /**
   * Sets the active account tag for commands (supports 'ALL' for equal multi-account mode).
   */
  static async setActiveAccount(discordUserId: string, playerTag: string): Promise<UserDoc | null> {
    const user = await this.getUser(discordUserId);
    if (!user) return null;

    if (playerTag.toUpperCase() === 'ALL') {
      user.activeAccountTag = 'ALL';
      await this.saveUser(user);
      return user;
    }

    const formatted = config.formatTag(playerTag);
    const found = user.accounts.find((a) => a.playerTag.toUpperCase() === formatted.toUpperCase());
    if (!found) return null;

    user.activeAccountTag = formatted;
    await this.saveUser(user);
    return user;
  }

  /**
   * Unlinks a player account for a Discord user.
   * If it was the last account, removes the user record.
   */
  static async unlinkAccount(
    discordUserId: string,
    playerTag?: string
  ): Promise<{ success: boolean; removedTag: string; remainingAccounts: number; removedName?: string }> {
    const user = await this.getUser(discordUserId);
    if (!user || user.accounts.length === 0) {
      return { success: false, removedTag: '', remainingAccounts: 0 };
    }

    let tagToRemove = playerTag ? config.formatTag(playerTag) : (user.activeAccountTag || user.accounts[0]?.playerTag);
    if (!tagToRemove) {
      return { success: false, removedTag: '', remainingAccounts: user.accounts.length };
    }

    const index = user.accounts.findIndex(
      (a) => a.playerTag.toUpperCase() === tagToRemove.toUpperCase()
    );

    if (index === -1) {
      return { success: false, removedTag: tagToRemove, remainingAccounts: user.accounts.length };
    }

    const removedAccount = user.accounts.splice(index, 1)[0];

    // If active account was removed, shift active to first remaining
    if (user.activeAccountTag?.toUpperCase() === removedAccount.playerTag.toUpperCase()) {
      user.activeAccountTag = user.accounts.length > 0 ? user.accounts[0].playerTag : '';
    }

    if (user.accounts.length === 0) {
      await this.usersCol.doc(discordUserId).delete();
    } else {
      await this.saveUser(user);
    }

    return {
      success: true,
      removedTag: removedAccount.playerTag,
      removedName: removedAccount.name,
      remainingAccounts: user.accounts.length,
    };
  }

  /**
   * Adds an active building upgrade timer to an account.
   */
  static async addActiveUpgrade(
    discordUserId: string,
    playerTag: string,
    upgrade: ActiveUpgrade
  ): Promise<boolean> {
    const user = await this.getUser(discordUserId);
    if (!user) return false;

    const formatted = config.formatTag(playerTag);
    const account = user.accounts.find((a) => a.playerTag.toUpperCase() === formatted.toUpperCase());
    if (!account) return false;

    account.activeUpgrades = account.activeUpgrades || [];
    account.activeUpgrades.push(upgrade);
    await this.saveUser(user);
    return true;
  }

  /**
   * Sets the apprentice builder timer for an account.
   */
  static async setApprenticeTimer(
    discordUserId: string,
    playerTag: string,
    timer: ApprenticeTimer
  ): Promise<boolean> {
    const user = await this.getUser(discordUserId);
    if (!user) return false;

    const formatted = config.formatTag(playerTag);
    const account = user.accounts.find((a) => a.playerTag.toUpperCase() === formatted.toUpperCase());
    if (!account) return false;

    account.apprenticeTimer = timer;
    await this.saveUser(user);
    return true;
  }

  /**
   * Saves imported village data for an account.
   */
  static async saveVillageData(
    discordUserId: string,
    playerTag: string,
    villageData: any
  ): Promise<boolean> {
    const user = await this.getUser(discordUserId);
    if (!user) return false;

    const formatted = config.formatTag(playerTag);
    const account = user.accounts.find((a) => a.playerTag.toUpperCase() === formatted.toUpperCase());
    if (!account) return false;

    account.villageData = villageData;
    await this.saveUser(user);
    return true;
  }

  /**
   * Gets a War Poll by ID.
   */
  static async getWarPoll(pollId: string): Promise<any | null> {
    const doc = await this.pollsCol.doc(pollId).get();
    return doc.exists ? doc.data() : null;
  }

  /**
   * Saves or updates a War Poll.
   */
  static async saveWarPoll(pollId: string, data: any): Promise<void> {
    await this.pollsCol.doc(pollId).set(data, { merge: true });
  }
}

