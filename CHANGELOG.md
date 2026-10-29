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
  bar for lookalike domains or a sign-in that returns to a different site. Works while signed out.
- **Secret phrase** (menu), shown on every panel, banner and sign-in bar, so fakes can't pass for them.
- **Report buttons** on red panels: copy a ready-to-paste report and open Steam's report flow (with a
  guide on the profile) or backpack.tf's issue tracker.
- **Confirmation reminder** in the trade window: the name and account age the Steam confirmation must show.
- **Security checkup** (menu): API key status, secret phrase, verified bots, stored data, and
  *Forget everything*.

### Fixed

- Values stored as plain text (the new secret phrase) were read back as broken JSON and dropped.

### Changed

- New permissions: `GM_registerMenuCommand` (menu), `GM_setClipboard` (only on a button click),
  `GM_listValues` and `GM_deleteValue` (*Forget everything*). Still no requests outside steamcommunity.com.

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
