# Changelog

What's new in Bimgus, newest first. Each release is tagged `vYYYY.MM.DD`, the day it went live (with `.2` for a second release that day), and is also listed on the repository's Releases page. Changes from before these notes started are in the commit history.

## v2026.10.30.4 (30 October 2026)

### For clan members

**No more upgrade DMs straight after an import.** `/import-village` already lists what finished since your last import, so the DMs repeating that list are gone.

- Upgrades Bimgus finds through an import now only show in that import's reply, under "Since Your Last Import".
- You still get a DM when a timer from your import runs out, and for hero, troop and spell upgrades.

### If you run your own copy

- Deploy the functions: `firebase deploy --only functions`. The slash commands and dashboard haven't changed, so there's nothing to re-register.

## v2026.10.30.3 (30 October 2026)

### For clan members

**Hero timers are fixed.** Bimgus took a hero reaching a new level as the start of an upgrade, so `/status` could show a finished hero as still upgrading for another day or more.

- A hero's new level now means that upgrade is done, and you get one DM for it.
- A running hero upgrade shows the right level: a hero at 39 says "→ Lv 40", not "→ Lv 39".
- `/status` only lists hero upgrades from your latest `/import-village`, because the game doesn't share when one starts. Import after starting an upgrade to see its timer.

**Costs match the game.**

- Hero, hero equipment, troop and spell costs were showing the price of the following upgrade. They now show the next one.
- If you have the Gold Pass, set your **Builder Boost** and **Research Boost** with the new buttons on the Home Village card in `/status`. Each press moves a boost through Off, 10%, 15% and 20%, and the costs in `/status`, `/defenses`, `/troops` and `/spells` drop to match. Bimgus can't see your Gold Pass, so you set them for each account, and they go back to Off each month. Timers don't need them: they already include your boosts.
- Pets and the Builder Base stay at list price for now.

### If you run your own copy

- Deploy the functions: `firebase deploy --only functions`. The slash commands and dashboard haven't changed, so there's nothing to re-register.
- Stored data updates itself. Imports that put upgrading heroes a level too low are corrected when read, and old hero timers from the API are removed the next time an account is saved.
- `npm --prefix functions run preview-layouts -- status` now also shows a running hero timer, and the Heroes and Lab views at 20%.

## v2026.10.30.2 (30 October 2026)

### For clan members

- Attack reminders' second button says **Clash of Stats**, like the other war cards. It opens the same war page "Live War Map" did.
- The time left in a reminder's title is rounded down, so it agrees with the end time under it ("~3h left" with "in 3 hours"), and it says "Under an hour" at the end.

## v2026.10.30 (30 October 2026)

Every Bimgus message has a new look. Discord's newer card layouts replace the old embeds, and most messages are much shorter.

### For clan members

**`/status` replaces `/upgrades`.** One message now covers all your linked accounts. Use the menus at the bottom of the card to pick the account, the Home Village or Builder Base, and the area: Overview, Buildings, Defenses, Heroes, Lab, or B.O.B on the Builder Base. The message changes in place, so the channel doesn't fill up. `/upgrades` keeps working for a little while.

**Cards instead of embeds.** Pictures sit beside the heading, buttons are inside the card, and sections have more space between them.

**A shorter clan feed:**
- A join, departure, promotion or Town Hall upgrade is a title and a line or two, and everything from one check arrives as one message.
- War and CWL attacks lead with the result ("💥 Clan attack: ⭐⭐⭐ 100%"), then who hit whom, then the live score.
- War declarations and CWL matchups show the lineup: each map position with our player, their mirror and both Town Halls.
- A war or CWL round's result and its audit are one card: who didn't attack, who has attacks left, hits on bases already at three stars, and perfect attacks.
- A raid capital is one line per district, with its attackers in order.
- The CWL season recap is two cards: the record, highlights, underdogs and missed attacks, then the stars leaderboard.
- When several Clan Games tiers are reached at once, only the highest gets a card.

**Reminders and DMs:**
- Attack reminders say how long is left and who still has to attack, with "(1 left)" for anyone who has started.
- Upgrade DMs are cards, and the war roster DM is two lines: your map position, Town Hall, team size and when battle day starts.

### If you run your own copy

- **Re-register the slash commands after updating** (Bot Settings → *Register Slash Commands*, or `npm --prefix functions run register-commands`), so Discord shows `/status` instead of `/upgrades`.
- **Deploy the dashboard as well as the functions**, since its command list changed. `firebase deploy` from [Updating](README.md#updating) does both.
- New optional setting `DISCORD_TEST_CHANNEL_WEBHOOK` in `functions/.env`: a private test channel's webhook. `npm --prefix functions run preview-layouts` posts an example of every message there (add `-- --print` to print them instead, or `-- war cwl` for some sections).
- The dashboard's *Test webhook* posts a card, the same kind of message a channel will get.
- Stored data hasn't changed, so there's nothing to migrate.
