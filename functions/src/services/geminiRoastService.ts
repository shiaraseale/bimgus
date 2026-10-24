import axios from 'axios';
import { config } from '../config';
import { log } from '../utils/log';

export interface PlayerRoastData {
  name: string;
  tag: string;
  townHallLevel: number;
  builderHallLevel?: number;
  trophies: number;
  warStars: number;
  donations: number;
  donationsReceived: number;
  attackWins?: number;
  defenseWins?: number;
  warPreference?: string;
  warPerformance?: string;
  heroes?: Array<{ name: string; level: number; maxLevel?: number }>;
}

export interface RoastTargetProfile {
  discordMention: string;
  discordUsername: string;
  accounts?: PlayerRoastData[];
}

export class GeminiRoastService {
  // Stable Flash-Lite model (https://ai.google.dev/gemini-api/docs/models, checked 2026-10-24).
  // gemini-3.8-flash didn't answer within 30–40 s in tests that day, while this took 2.5–5.4 s.
  private static readonly MODEL = 'gemini-3.5-flash-lite';
  // "minimal" thinking is enough for a 1–2 sentence roast; the output cap includes any thinking tokens
  private static readonly THINKING_LEVEL = 'minimal';
  private static readonly MAX_OUTPUT_TOKENS = 1024;
  // The roast runs in a Cloud Task, so it isn't bound by Discord's 3-second deadline
  private static readonly TIMEOUT_MS = 8000;

  private static readonly GENERIC_CLASH_ROASTS = [
    'You look like the type of attacker who drops all 10 Electro Dragons in a single pixel and prays to the heavens.',
    'Your war attack strategy has the tactical depth of a Barbarian attempting to do calculus against a crusher.',
    'You definitely drop Jump Spells on open grass just to hear the bounce sound effect.',
    'Even a lone Wall Breaker running backwards into a giant bomb has more combat IQ than your last five war hits combined.',
    'You are the exact reason Supercell made the tutorial unskippable.',
    'Your troop funneling is so catastrophic that your Queen gets second-hand embarrassment and shoots a corner wall for 3 minutes.',
    "You definitely leave your Grand Warden on air mode during an all-ground smash attack and wonder why he's floating uselessly.",
    "Your war plan is closing your eyes, swiping all ten fingers across your tablet, and blaming lag when it's a 34% one-star.",
    'You probably donate Wall Breakers when clanmates ask for war defense troops.',
  ];

  /**
   * Generates a witty, customized Clash of Clans roast for a tagged Discord member.
   * Compares all linked accounts to find the funniest material, or writes a generic Clash roast if unlinked.
   */
  static async generateRoast(target: RoastTargetProfile): Promise<string> {
    const apiKey = config.gemini.apiKey;
    if (!apiKey) {
      return this.getRandomFallback(target);
    }

    try {
      const prompt = this.buildPrompt(target);
      const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`;

      const response = await axios.post(
        url,
        {
          model: this.MODEL,
          input: prompt,
          store: false,
          generation_config: {
            thinking_level: this.THINKING_LEVEL,
            max_output_tokens: this.MAX_OUTPUT_TOKENS,
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.TIMEOUT_MS,
        }
      );

      const steps = response.data?.steps || [];
      const modelStep = steps.find((s: any) => s.type === 'model_output');
      let roastText = (modelStep?.content || [])
        .filter((c: any) => c?.type === 'text' || typeof c?.text === 'string')
        .map((c: any) => c.text)
        .join('')
        .trim();

      if (!roastText && response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        roastText = response.data.candidates[0].content.parts[0].text.trim();
      }

      if (roastText && roastText.length > 15) {
        return roastText.replace(/^["'`]|["'`]$/g, '').trim();
      }

      return this.getRandomFallback(target);
    } catch (err: any) {
      log.warn('[GeminiRoast] Falling back to dynamic clash roast:', err.message);
      return this.getRandomFallback(target);
    }
  }

  private static buildPrompt(target: RoastTargetProfile): string {
    if (target.accounts && target.accounts.length > 0) {
      const accountDescriptions = target.accounts
        .map((p, i) => {
          const heroes =
            p.heroes && p.heroes.length > 0
              ? `Heroes: ${p.heroes.map((h) => `${h.name} Lv${h.level}`).join(', ')}`
              : '';
          const warMissed = p.warPerformance ? `War Performance: ${p.warPerformance}` : '';
          return `Account ${i + 1} ("${p.name}"):
- Town Hall: ${p.townHallLevel}, Builder Hall: ${p.builderHallLevel || 'N/A'}
- Trophies: ${p.trophies}, War Stars: ${p.warStars}
- Season Attack Wins: ${p.attackWins ?? 0}, Defense Wins: ${p.defenseWins ?? 0}
- Donations: Donated ${p.donations} vs Received ${p.donationsReceived}
${heroes ? `- ${heroes}` : ''}
${warMissed ? `- ${warMissed}` : ''}`.trim();
        })
        .join('\n\n');

      return `You are Bimgus, a sassy, witty, legendary cat mascot from a Clash of Clans Discord bot.
The user ${target.discordMention} (${target.discordUsername}) has ${target.accounts.length} linked Clash of Clans account(s):

${accountDescriptions}

YOUR TASK:
Analyze all their linked accounts and write a devastating, highly creative, and uniquely funny roast targeting whichever account or behavior will make for the absolute FUNNIEST roast.

RULES:
- Do NOT mechanically list their Town Hall level, trophy count, or war stars unless it directly powers the punchline (e.g. having a high Town Hall but level 2 heroes or 0 attack wins).
- Roasts should be as unique and witty as possible—mock real Clash gameplay habits (e.g., e-drag spamming, rushed heroes, terrible donation ratios, ghosting clan war attacks, putting jump spells on grass, 49% 0-star time fails).
- If one account is particularly embarrassing or rushed compared to another, you can roast that contrast!
- Tag ${target.discordMention} directly.
- Return ONLY the raw roast text (1-2 sentences), no quotes, no explanations.`;
    }

    return `You are Bimgus, a sassy, witty, legendary cat mascot from a Clash of Clans Discord bot.
Write a punchy, hilarious, and unique 1-2 sentence Clash of Clans themed roast for ${target.discordMention} (${target.discordUsername}).

RULES:
- Do NOT ask them to link their account or mention '/link'. Do NOT complain that they haven't linked.
- Roast them purely on generic Clash of Clans gameplay stereotypes (e.g., dropping all 10 Electro Dragons in a single clump, missing war attacks because they 'fell asleep', using earthquake spells on grass, leaving Grand Warden on air mode for ground attacks, goblin tutorial builder having more tactical skill).
- Make the roast as unique, creative, and hilarious as possible.
- Tag ${target.discordMention} directly.
- Return ONLY the raw roast text without quotes.`;
  }

  private static getRandomFallback(target: RoastTargetProfile): string {
    if (target.accounts && target.accounts.length > 0) {
      // Pick the account with the funniest/most roastable material
      const sorted = [...target.accounts].sort((a, b) => {
        const aScore = a.donationsReceived - a.donations + (100 - (a.attackWins || 0));
        const bScore = b.donationsReceived - b.donations + (100 - (b.attackWins || 0));
        return bScore - aScore;
      });
      const p = sorted[0];

      const accountRoasts = [
        `${target.discordMention} On your account **${p.name}**, you've received **${p.donationsReceived}** troops and only donated **${p.donations}**—your clanmates aren't your friends, they're your unpaid charity workers!`,
        `${target.discordMention} Looking at **${p.name}**, you have **${p.attackWins ?? 0} attack wins** this whole season. Your troops aren't invading enemy bases, they're taking guided museum tours!`,
        `${target.discordMention} Your account **${p.name}** has the offensive firepower of an angry goblin with a toothpick. Even the enemy Clan Castle troops yawn when you deploy!`,
        `${target.discordMention} I analyzed your account **${p.name}**—even a blindfolded Wall Breaker has better attack pathing than whatever you've been doing in war!`,
      ];
      return accountRoasts[Math.floor(Math.random() * accountRoasts.length)];
    }

    const item = this.GENERIC_CLASH_ROASTS[Math.floor(Math.random() * this.GENERIC_CLASH_ROASTS.length)];
    return `${target.discordMention} ${item}`;
  }
}
