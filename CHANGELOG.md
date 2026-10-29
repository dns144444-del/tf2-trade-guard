# Changelog

All notable changes to TF2 Trade Guard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

## [0.8.0] - 2026-10-29

### Added

- **Bots with a trade hold:** a partner that calls itself a bot but whose items would be held is flagged
  red, since every real trading bot uses the Steam Guard Mobile Authenticator. Other partners without it
  get a note.
- **Items from other games** in what you receive: flagged red when they're named like a TF2 key, metal or
  hat, noted otherwise. The trade window now reads the partner's inventory for every game in the offer.
- **Profile comments:** scam warnings left on the partner's profile by several different people raise
  the alert; a new account with hidden comments gets a note.
- **Verified bots:** a list you build from trading sites' official bot pages (menu). Copies of those bots
  are flagged red even on first contact. Import and export as JSON.
- **Sign-in guard** on Steam's "Sign in through Steam" pages: which site you're signing in to, and a red
  bar for lookalike domains, a sign-in that returns to a different site, or a request Steam could read
  two ways (repeated or aliased parameters). Works while signed out.
- **Secret phrase** (menu), shown on every panel, banner and sign-in bar, so fakes can't pass for them.
- **Report buttons** on red panels: copy a ready-to-paste report and open Steam's report flow (with a
  guide on the profile) or backpack.tf's issue tracker.
- **Confirmation reminder** in the trade window: the name and account age the Steam confirmation must show.
- **Security checkup** (menu): API key status, secret phrase, verified bots, stored data, and
  *Forget everything*.

### Fixed

- A panel without alerts printed "null".
- Comment warnings like "do not trade" or "he scams" went unnoticed.

### Changed

- New permissions: `GM_registerMenuCommand` (menu), `GM_setClipboard` (only on a button click),
  `GM_listValues` and `GM_deleteValue` (*Forget everything*). Still no requests outside steamcommunity.com.
- Each account the user knows is now one contact, whether it's a friend, a past partner, a verified bot or
  all three, so it gets one consistent verdict.
- Reports are written in the third person and never say who the user's friends are. A finding goes into a
  report only once it has public wording, so a new kind of alert can't leak into one by default.
- In the trade window, alerts about the items being added join the panel's list, and anything that turns
  the panel red brings the report buttons with it.
- When a trade's hold times or a profile's name history and comments can't be read, the panel says so.
- Several people calling a long-standing friend or a verified bot a scammer is a warning, not a red verdict.
- *Forget everything* keeps when each friend was first seen, so a reset can't turn a recent friend into a
  trusted one.
- The browser layer is organized into named sections, and every text lives in one `Strings` table.

### Security

Found by an independent review of this release before it was published, and fixed in it:

- The report guide could be shown, with the user's secret phrase, on any profile through a link. It now
  appears only for the report button just clicked, using a one-time code.
- A verified-bots entry turned off every other check for that account, so a planted ID could pass a copy
  of a friend as safe. It now only skips comparisons with other verified bots, and warns when a listed bot
  goes by another name.
- A secret phrase starting with `[` or `{` was dropped on reload, making real panels look fake.
- The trade-hold check could be fooled by a partner name containing Steam's variable name.
- Pasting a single SteamID into the verified list added nothing, and numeric IDs in a JSON list were
  rounded to a different account.
- A partner's private inventory was requested again for every item added to an offer.
- A sign-in request could hide a second return address behind a spelling Steam's server treats as the same
  parameter (`openid.return.to`, a leading space, `[`, a NUL byte). Every such spelling is now read as
  ambiguous and shown red.
- A verified bot sharing its name with an unlisted account the user had traded with was flagged red. The
  listed bot now gets a warning instead.
- A verified bot whose profile failed to load was reported as renamed.
- Scam warnings typed with a phone's curly apostrophe ("don’t trade") went unnoticed.

## [0.7.2] - 2026-10-29

First public release.

### Protection

- **API key watch:** checks `steamcommunity.com/dev/apikey` in the background and shows a banner with a
  revoke button when a key is registered. A key you trust is remembered by fingerprint, never stored.
- **Impostor detection** against your friends and past trade partners: lookalike letters from several
  scripts, hidden and "blank" characters, flipped text, copied avatars, recent renames and former names.
  Recently added friends get extra scrutiny.
- **Copied-offer detection:** an offer that asks for the same items as one you just had with another
  account, including offers that were canceled before you saw them.
- **Account age** for every partner, estimated from the SteamID when the profile is private.
- **Fake-named items:** Name Tags and Description Tags that claim an unusual effect, Australium, a key or
  another quality the item doesn't have. New offers are checked live as items are added.
- **Phishing** in offer messages and comments: lookalike domains of Steam and TF2 trading sites, common
  scam lines, and names posing as Steam or Valve staff.

### Project

- Tests for the detection logic, for the page parsing (on HTML fixtures) and for the whole userscript
  running on a simulated Steam page, plus checks that the source has no hidden characters and never
  builds HTML from strings. They run on every push.
- Security policy with private vulnerability reporting.

### Notes

Versions 0.7.0 and 0.7.1 were published briefly on the same day and withdrawn while the repository was
being prepared. Releases are immutable, so their version numbers can't be reused.

[0.8.0]: https://github.com/dns144444-del/tf2-trade-guard/releases/tag/v0.8.0
[0.7.2]: https://github.com/dns144444-del/tf2-trade-guard/releases/tag/v0.7.2
