# Security policy

TF2 Trade Guard is a security tool, so a flaw in it can hurt the people relying on it. Reports are very
welcome.

## Supported versions

Only the [latest release](https://github.com/dns144444-del/tf2-trade-guard/releases/latest) gets fixes.
Updates are manual on purpose, so please check that you're on it before reporting.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/dns144444-del/tf2-trade-guard/security/advisories/new).

Include what you can of:

- what an attacker can do, and what they need (a crafted name, an offer message, a page…)
- steps to reproduce, with **fictional or test accounts only**; never include real API keys,
  session cookies or other people's account details
- the Trade Guard version and your browser and userscript manager

There's no bug bounty and no guaranteed response time, but reports are taken seriously and you'll be
credited in the release notes unless you'd rather not be.

### What counts

- Anything that makes Trade Guard show "No alerts" for a scam it's meant to catch, such as a new way to
  disguise an impostor's name, a phishing link or a fake item. Report these privately too: a public
  bypass helps scammers before it's fixed.
- Text from Steam (names, messages, item descriptions) being treated as HTML or code.
- Data leaving `steamcommunity.com`, or data stored beyond what the README describes.
- A way to get the API key trust prompt accepted without the user typing the confirmation.

### What doesn't

- Vulnerabilities in Steam itself; report those to [Valve](https://hackerone.com/valve).
- Scams that don't involve Trade Guard at all. A detection idea for a new kind of scam is welcome as a
  normal issue, as long as it doesn't describe a working bypass.

## Verifying a release

Every release lists the SHA-256 of `tf2-trade-guard.user.js` in its notes, and releases are immutable:
once published, their file and tag can't be changed. If the hash of the file you downloaded doesn't
match, don't install it, and please report it.
