# TF2 Trade Guard

[![Tests](https://github.com/dns144444-del/tf2-trade-guard/actions/workflows/test.yml/badge.svg)](https://github.com/dns144444-del/tf2-trade-guard/actions/workflows/test.yml)

A userscript that protects Steam traders from the scams that empty the most TF2 inventories:

1. **The API key scam.** A phishing site registers a Steam Web API key on your account. With it, the scammer watches your trade offers, cancels the real one and instantly sends you an identical offer from an impostor account.
2. **Impostor accounts.** Someone copies the name and avatar of your friend, a middleman or a well-known trading bot.
3. **Fake items.** A cheap item gets a Name Tag or Description Tag that makes it look like an Unusual, an Australium or a key.
4. **Phishing links.** A message or comment sends you to a copy of Steam or a trading site to steal your login.

![An impostor's offer flagged in red next to a legitimate offer from a friend](docs/screenshots/trade-offers.png)

![The API key banner, and a phishing comment flagged on a profile](docs/screenshots/api-key-and-comments.png)

![A "Sign in through Steam" page for a lookalike of backpack.tf, flagged in red](docs/screenshots/sign-in.png)

*The real script running on a simulated Steam page, with fictional accounts. "blue falcon" is the example secret phrase.*

## What it does

**API key watch** (every Steam Community page)
- Checks `steamcommunity.com/dev/apikey` in the background (at most every 15 minutes, every 2 minutes on trade pages).
- If a key is registered, shows a red banner on every Steam page with a button to revoke it.
- If the key is yours (e.g. for your own bot), you can trust it. Only a SHA-256 fingerprint and the last 4 characters are stored, never the key itself. A *different* key triggers the alert again.

**Trade offer checks** (offer list and trade window)
- Shows the partner's **SteamID64**, account age and links to rep.tf and backpack.tf.
- **Impostor detection:** compares the partner's name and avatar against your friends list and everyone you've traded with in the last 90 days. A different account with the same name, or a copied avatar with a similar name, is flagged in red. Lookalike tricks are caught too: Cyrillic, Greek, Armenian and Cherokee letters (capital and small), small capitals, letters in boxes, circles and flag symbols, zero-width and "blank" characters, combining marks, right-to-left overrides that flip a name, and `I`/`l`/`1`/`!`, `0`/`O`, `rn`/`m`, `vv`/`w`. A shared avatar alone is only a warning, since official Steam avatars are used by thousands of accounts.
- A friend added recently doesn't get the benefit of the doubt that long-standing friends get ("I lost my account, add my new one" is a classic opener). An old, public account sharing a past partner's name gets a yellow "check the site's bot list" instead of red, since some sites run several bots with one name; new, private or just-renamed copies stay red.
- Warns when a name contains a SteamID64 or text-direction controls, both used to make a fake name look trustworthy. The real SteamID64 is always shown first in the panel, before the quoted name.
- **Copied-offer detection:** flags an incoming offer that asks for the same items as an offer you recently had with another account. It checks your offer history too, because the real offer is usually canceled seconds before the copy arrives, often before you ever see it. Giving the same items for nothing is flagged red; the same deal on both sides is flagged yellow, since it can also be two buyers offering the same price.
- **Name history:** warns when the partner changed their name in the last 7 days and shows their previous name. Impostor accounts usually rename right before a scam.
- Warns about trade-banned, new (under 6 months), private and limited accounts.
- **Account age even for private profiles:** Steam hands out account IDs in order, so the SteamID alone dates an account. Trade Guard ships a table of real reference points (2004–2025, typically within ~10 days) and refines it locally from every public profile it sees. This also fixes Steam sometimes omitting the year of a creation date.
- Warns when you're giving items and receiving nothing. In the trade window this updates live.
- **Fake-named items:** checks every item you'd receive for a Name Tag or Description Tag and shows its real name. If the custom text claims something the item doesn't have (an unusual effect, Australium, Strange, a key…), the offer is flagged red. In a new offer this updates live as items are added.
- **Phishing links and scam lines in offer messages:** links to lookalike domains of Steam or trading sites (`steamcommunlty.com`, `backpack-tf.com`, lookalike letters, punycode, `steamcommunity.com@other-site`) are flagged red, other links yellow, and common scam lines ("is this your item?", "vote for my team", "your account will be banned") yellow.
- **Fake staff:** a partner whose name claims to be Steam or Valve staff ("Steam Support", "Valve Admin") is flagged red. Valve staff never trade.
- **Bots with a trade hold:** every real trading bot uses the Steam Guard Mobile Authenticator, so its trades are never held. An account that calls itself a bot but whose items would be held is flagged red; any other partner without the authenticator gets a yellow note. (Only judged when your own side of the trade has no hold, since Steam's numbers can't tell the two apart otherwise.)
- **Items from other games:** an item from another game named like a TF2 key, metal or hat (a Steam or CS2 item passed off as a Mann Co. Supply Crate Key) is flagged red; other cross-game items get a note.
- **What the community wrote:** reads the partner's profile comments. Warnings from several different people ("scammer", "stole", "impostor", "-rep") raise the alert; praise like "+rep, not a scammer" doesn't count. A new account with its comments hidden gets a yellow note.
- **Verified bots:** paste the SteamIDs from a trading site's official bot list (menu → *Verified bots*). From then on, any other account using one of those names is flagged red, even on first contact. Lists can be exported and imported as JSON.
- **Before you confirm:** the trade window reminds you what the Steam app or email confirmation must show: the partner's name and account age.
- **Report a scammer:** red panels get *Copy report*, *Steam* and *backpack.tf* buttons. Each copies a ready-to-paste report (scammer, who they copied, what was detected) and opens the place to send it. On Steam, the profile shows how to reach *Report Player → Attempted Trade Scam*. Trade Guard never submits anything itself.

**Signing in through Steam** (`steamcommunity.com/openid/...`)
- Shows which site you're signing in to. Known trading sites get a green bar, unknown sites a yellow one, and lookalike domains or a sign-in that sends you back to a different site a red one. It works before you sign in, on the password form itself.

**Your secret phrase** (menu → *Set secret phrase*)
- Shown on every Trade Guard panel, banner and sign-in bar. A fake panel written into an offer message, or a fake "Steam login" window drawn inside a phishing site, can't show it: if the phrase is missing, it isn't Trade Guard.

**Security checkup** (menu → *Security checkup*)
- Your API key status (with *Check now*), your secret phrase, your verified bots, what Trade Guard has stored, and a *Forget everything* button.

**Comments** (profiles, groups, workshop)
- Comments with lookalike links, scam lines or authors posing as Steam/Valve staff get a warning note. Normal comments are left alone. Forum threads are skipped, where "contact Steam Support" is ordinary advice.

## Privacy and security

- **Only talks to `steamcommunity.com`.** It makes no request to any other domain, has no `@connect` entries and doesn't use `GM_xmlhttpRequest`.
- Doesn't read cookies or your session ID, and never sends, accepts or modifies trade offers. It only adds warning panels.
- Everything it remembers (friends, past trade partners, cached profiles, your verified bots and secret phrase) stays in Tampermonkey's local storage. Data about your account is kept per Steam account, so alts on the same browser never mix. Of a partner's comments, only the scam warnings are kept. *Forget everything* in the security checkup deletes it all.
- Its permissions, and what for: storage (`GM_getValue`, `GM_setValue`, `GM_listValues`, `GM_deleteValue`), styles (`GM_addStyle`), the Tampermonkey menu (`GM_registerMenuCommand`), and the clipboard (`GM_setClipboard`), which is only written when you click a report or export button.
- Names from Steam are inserted as plain text, never as HTML.
- **It fails loudly.** If a check can't run (Steam changed a page, a request failed, the friends list didn't load), you get a yellow warning instead of a green "No alerts".
- Trusting your own API key requires typing its domain, so a phishing page can't talk you into a single click.
- Found a security issue, or a way to get past a check? Please report it privately, see [SECURITY.md](SECURITY.md).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Download `tf2-trade-guard.user.js` from the [latest release](../../releases/latest) and confirm the install.
3. Optional but recommended: check that the file's SHA-256 matches the one in the release notes.
   - Windows (PowerShell): `Get-FileHash .\tf2-trade-guard.user.js`
   - Linux/macOS: `sha256sum tf2-trade-guard.user.js`

### Updates are manual, on purpose

The script declares `@downloadURL none`, so Tampermonkey never updates it on its own. If this GitHub account were ever compromised, a malicious version would not reach anyone who already has the script installed. To update, install the new release the same way and check its hash.

## Limitations

- It warns you, it can't stop you. Always check the items and the partner in the Steam Guard mobile confirmation.
- Impostor detection only knows your friends, the partners it has seen while installed and your verified bots. A first contact with an impostor of a bot that isn't on your verified list can't be detected by name (a trade hold or a new account may still give it away).
- The trade-hold check needs your own side of the trade to have no hold; otherwise it stays quiet rather than guess.
- Comment warnings are a hint, not a verdict: friends joke, and scammers delete comments. Several different people warning is what raises the alert.
- Steam has no direct link to its report form, so the *Steam* report button opens the profile and explains the three clicks. backpack.tf reports go through its issue tracker.
- Item checks need Steam to describe each item: in a new offer they read the partner's public inventory, so a private inventory (or Steam's rate limit) means a yellow "couldn't check every item" instead.
- Phishing detection knows Steam and the main TF2 trading sites. A phishing site that imitates something else only gets the generic "unknown link" warning.
- Avatar matching uses Steam's image hash. A slightly edited copy of an avatar gets a new hash, so the name checks are what catch it.
- Trade Guard's panels never appear *inside* an offer's message. Text there that looks like a Trade Guard verdict was written by the other person, and it won't show your secret phrase.
- It relies on Steam's page structure and profile XML. If Steam changes them, the affected checks show a warning instead of a false "all clear".

## Development

The userscript is a single file with no dependencies, so what you read here is exactly what you install.
It has three parts: `Core` (pure detection logic), `Page` (reads Steam's markup) and the browser layer.
The tests cover all three:

- `tests/core.test.js`: the detection logic, with cases taken from real data.
- `tests/page.test.js`: page parsing, on HTML fixtures shaped like Steam's pages.
- `tests/userscript.test.js`: the whole script running on a simulated Steam page.
- `tests/source.test.js`, `tests/style.test.js`: no hidden characters, no HTML built from strings, one style.

```sh
npm ci --ignore-scripts   # test-only dependency: linkedom, a small DOM for Node
npm test
```

See [CHANGELOG.md](CHANGELOG.md) for the changes in each release.

## License

[MIT](LICENSE)
