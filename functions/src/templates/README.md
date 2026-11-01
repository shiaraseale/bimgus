# Message templates

The wording of Bimgus's Discord messages lives in the JSON files in this folder. Change a file here and the real message changes, with no code to touch.

| File             | What's in it                                                       |
| ---------------- | ------------------------------------------------------------------ |
| `clan.json`      | Members joining, leaving and changing role, and Town Hall upgrades |
| `clanGames.json` | Clan Games starting, tiers and players maxing out                  |
| `war.json`       | War matchups, attack cards, war summaries and attack reminders     |
| `cwl.json`       | CWL group draw, rounds and the season recap                        |
| `raids.json`     | Raid weekend starting, capitals and the end-of-weekend recap       |
| `dms.json`       | Upgrade DMs, war roster DMs and the DM on/off buttons              |
| `commands.json`  | Every slash command's replies, and the error messages              |
| `shared.json`    | Button labels and wording used in several messages                 |

## Changing a message

1. Find the text in its file and edit it between the quotes.
2. Check it with `npm test`, then `npm run preview-layouts` from the `functions` folder. The preview posts to your test channel, and `-- raids` limits it to one section (`clan`, `clan-games`, `war`, `cwl`, `raids`, `reminders`, `dms`, `status`). Slash command replies don't appear in the preview, so try those with the test bot.
3. Deploy the functions. The bot reads these files when it's built, so nothing changes in Discord until you deploy. `firebase deploy` runs the tests and the build first, and stops if either fails.

## Placeholders

Text in `{curly brackets}` is filled in when the message is sent:

```json
"title": "🏛️ {name} reached TH{level}",
"body": "🎉 Well done!"
```

You can move a placeholder, use it more than once or remove it. Keep its spelling exactly as it is: `npm test` fails on a misspelt one, which would otherwise show in Discord as `{nmae}`. You can't add a new placeholder to a message unless the code supplies it, so to show something extra the code needs changing too. The tests catch a placeholder no message uses at all, but not a real one moved to a message that doesn't fill it in, so check your edit in the preview.

Custom emoji work as placeholders in any message:

`{crown}` `{anvil}` `{star}` `{gold}` `{elixir}` `{dark_elixir}` `{builder_gold}` `{builder_elixir}` `{shiny_ore}` `{glowy_ore}` `{starry_ore}` `{capital_gold}` `{raid}`

Normal emoji can be typed straight in.

## Formatting

Discord's markdown works: `**bold**`, `*italics*`, `` `code` `` and `-# small text` at the start of a line.

Each file is JSON, so a few rules apply:

- Use `\n` for a new line, and `\"` for a double quote inside the text.
- Keep the quotes around each piece of text, and the comma after every line except the last in a group.
- Don't rename or delete the name on the left of a line (such as `"title":`). The code looks wording up by that name, and the build fails if one is missing.

A mistake in the JSON fails the tests or the build, so `firebase deploy` stops before it can reach Discord.

## What isn't here

These stay in the code:

- **Column layouts**: the rows in the raid ranking, capital districts, CWL leaderboard and war lineup, because their spacing has to be worked out as they're built. Headings, totals and footers around them are templates.
- **Counted words**: "1 district" and "2 districts" are picked by the code, so `{districts}` already includes the word.
- **Slash command descriptions**: changing what Discord shows in its command list also needs the commands re-registering.
- **Button and menu emoji**: labels are here, but their emoji are set in the code.
- **Roasts**: the AI prompt and the fallback roasts are in `geminiRoastService.ts`.

## Keep it short

- Messages should stay compact: lead with what happened, and avoid filler.
- A monospace row fits about 48 characters on a phone before it wraps.
- Discord allows 4,000 characters per message. Long lists are trimmed to fit, or carry on into a second message.
