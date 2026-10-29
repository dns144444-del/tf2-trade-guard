// ==UserScript==
// @name         TF2 Trade Guard
// @namespace    https://github.com/dns144444-del/tf2-trade-guard
// @version      0.7.2
// @description  Warns about Steam API key scams, impostors, fake items and phishing. Talks only to steamcommunity.com.
// @author       dns144444-del
// @license      MIT
// @homepageURL  https://github.com/dns144444-del/tf2-trade-guard
// @supportURL   https://github.com/dns144444-del/tf2-trade-guard/issues
// @downloadURL  none
// @match        https://steamcommunity.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-end
// @noframes
// ==/UserScript==

'use strict';

// This file has three parts, from most to least testable:
//   Core           pure detection logic: no DOM, no network. Tested in tests/core.test.js.
//   Page           reads Steam's pages (offers, friends, trade window, comments): DOM only, no
//                  network, no storage. Tested against HTML fixtures in tests/page.test.js.
//   runUserscript  everything that needs the live browser: storage, same-origin requests and the UI.

// ---------------------------------------------------------------------------
// Core: pure detection logic. No DOM, no network.
// ---------------------------------------------------------------------------
const Core = (() => {
    const STEAMID64_BASE = 76561197960265728n;
    const DEFAULT_AVATAR_HASH = 'fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb';
    const DAY_MS = 24 * 60 * 60 * 1000;

    // ----- names: lookalike letters, hidden characters, comparison -----

    // Cyrillic/Greek letters that render (almost) like Latin ones, after lowercasing
    const HOMOGLYPHS = {
        '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u0451': 'e', '\u043A': 'k', '\u043C': 'm', '\u043D': 'h', '\u043E': 'o',
        '\u0440': 'p', '\u0441': 'c', '\u0442': 't', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0457': 'i', '\u0458': 'j',
        '\u0455': 's', '\u0501': 'd', '\u051B': 'q', '\u051D': 'w', '\u0261': 'g', '\u04CF': 'l',
        '\u03B1': 'a', '\u03B2': 'b', '\u03B5': 'e', '\u03B9': 'i', '\u03BA': 'k', '\u03BD': 'v', '\u03BF': 'o', '\u03C1': 'p',
        '\u03C4': 't', '\u03C5': 'u', '\u03C7': 'x', '\u03B7': 'n', '\u03C9': 'w', '\u03B3': 'y',
        // Armenian
        '\u0585': 'o', '\u057D': 'u', '\u0581': 'g', '\u0570': 'h', '\u0578': 'n', '\u0561': 'w', '\u0566': 'q',
        // Latin small capitals and letters that NFKC/NFD don't fold
        '\u1D00': 'a', '\u0299': 'b', '\u1D04': 'c', '\u1D05': 'd', '\u1D07': 'e', '\u0262': 'g', '\u029C': 'h', '\u026A': 'i',
        '\u1D0A': 'j', '\u1D0B': 'k', '\u029F': 'l', '\u1D0D': 'm', '\u0274': 'n', '\u1D0F': 'o', '\u1D18': 'p', '\u0280': 'r',
        '\uA731': 's', '\u1D1B': 't', '\u1D1C': 'u', '\u1D20': 'v', '\u1D21': 'w', '\u028F': 'y', '\u1D22': 'z',
        '\u0131': 'i', '\u0142': 'l', '\u00F8': 'o', '\u0111': 'd', '\u0127': 'h'
    };
    // zero-width, bidi controls, variation selectors, braille blank, Hangul fillers, etc.
    // Written as escapes: literal invisible characters in source can't be reviewed (see tests/source.test.js).
    const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

    function accountIdToSteamId64(accountId) {
        return (STEAMID64_BASE + BigInt(accountId)).toString();
    }

    // Capitals that look Latin but stop looking alike once lowercased (Greek capital Nu becomes a
    // lowercase nu, which reads as "v"), so they're folded before lowercasing. Code points, not
    // literal characters, so the table stays reviewable.
    const UPPER_HOMOGLYPHS = new Map([
        // Greek
        [0x391, 'a'], [0x392, 'b'], [0x395, 'e'], [0x396, 'z'], [0x397, 'h'], [0x399, 'i'], [0x39A, 'k'],
        [0x39C, 'm'], [0x39D, 'n'], [0x39F, 'o'], [0x3A1, 'p'], [0x3A4, 't'], [0x3A5, 'y'], [0x3A7, 'x'],
        // Cyrillic
        [0x405, 's'], [0x406, 'i'], [0x408, 'j'], [0x410, 'a'], [0x412, 'b'], [0x415, 'e'], [0x41A, 'k'],
        [0x41C, 'm'], [0x41D, 'h'], [0x41E, 'o'], [0x420, 'p'], [0x421, 'c'], [0x422, 't'], [0x423, 'y'],
        [0x425, 'x'], [0x4C0, 'l'], [0x51A, 'q'], [0x51C, 'w'],
        // Cherokee
        [0x13A0, 'd'], [0x13A1, 'r'], [0x13A2, 't'], [0x13A5, 'i'], [0x13A9, 'y'], [0x13AA, 'a'], [0x13AB, 'j'],
        [0x13AC, 'e'], [0x13B3, 'w'], [0x13B7, 'm'], [0x13BB, 'h'], [0x13BD, 'y'], [0x13C0, 'g'], [0x13C2, 'h'],
        [0x13C3, 'z'], [0x13CF, 'b'], [0x13D2, 'r'], [0x13D4, 'w'], [0x13D5, 's'], [0x13D9, 'v'], [0x13DA, 's'],
        [0x13DE, 'l'], [0x13DF, 'c'], [0x13E2, 'p'], [0x13E6, 'k'], [0x13F4, 'b']
    ]);

    // first code point of 26-letter A-Z runs: negative circled, negative squared, regional indicators
    const ENCLOSED_LETTER_RUNS = [0x1F150, 0x1F170, 0x1F1E6];

    function foldCharacter(ch) {
        let code = ch.codePointAt(0);

        // Cherokee small letters mirror the capitals
        if (code >= 0xAB70 && code <= 0xABBF) code = code - 0xAB70 + 0x13A0;
        if (UPPER_HOMOGLYPHS.has(code)) return UPPER_HOMOGLYPHS.get(code);

        const run = ENCLOSED_LETTER_RUNS.find((start) => code >= start && code < start + 26);
        return run === undefined ? ch : String.fromCharCode(97 + code - run);
    }

    // folds case, invisible characters, accents, marks and foreign homoglyphs
    function baseNormalize(name) {
        const folded = Array.from(String(name || '').normalize('NFKC'), foldCharacter)
            .join('')
            .toLowerCase()
            .replace(INVISIBLE, '')
            .normalize('NFD')
            .replace(/\p{M}/gu, '');

        return Array.from(folded, (ch) => HOMOGLYPHS[ch] || ch)
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // additionally folds Latin lookalikes that are indistinguishable in Steam's font
    function lookalikeNormalize(name) {
        return baseNormalize(name)
            .replace(/rn/g, 'm')
            .replace(/vv/g, 'w')
            .replace(/0/g, 'o')
            .replace(/[1|i!]/g, 'l');
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;

        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

        for (let i = 1; i <= a.length; i++) {
            const curr = [i];

            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            }

            prev = curr;
        }

        return prev[b.length];
    }

    // letters and digits only, so decorations like "★", "." or "_" don't hide a copy
    function skeleton(name) {
        return lookalikeNormalize(name).replace(/[^\p{L}\p{N}]/gu, '');
    }

    // right-to-left override/isolate, and the controls that end them
    const RTL_STARTS = new Set([0x202E, 0x2067]);
    const DIRECTION_ENDS = new Set([0x202C, 0x2069]);

    // What the reader sees when a right-to-left override flips part of a name: "[RLO]oriK" shows "Kiro".
    // An approximation of the bidi algorithm, enough to undo the trick.
    function visualForm(name) {
        const chars = Array.from(String(name || ''));
        const out = [];

        for (let i = 0; i < chars.length; i++) {
            if (!RTL_STARTS.has(chars[i].codePointAt(0))) {
                out.push(chars[i]);
                continue;
            }

            let end = i + 1;
            while (end < chars.length && !DIRECTION_ENDS.has(chars[end].codePointAt(0))) end++;

            out.push(...chars.slice(i + 1, end).reverse());
            i = end;
        }

        return out.join('');
    }

    function hasDirectionControls(name) {
        return Array.from(String(name || '')).some((ch) => {
            const code = ch.codePointAt(0);
            return (code >= 0x202A && code <= 0x202E) || (code >= 0x2066 && code <= 0x2069);
        });
    }

    const MATCH_RANK = { none: 0, similar: 1, lookalike: 2, identical: 3 };

    // 'identical' | 'lookalike' | 'similar' | 'none', comparing names as stored and as displayed
    function compareNames(a, b) {
        let best = 'none';

        for (const x of new Set([a, visualForm(a)])) {
            for (const y of new Set([b, visualForm(b)])) {
                const result = compareForms(x, y);
                if (MATCH_RANK[result] > MATCH_RANK[best]) best = result;
            }
        }

        return best;
    }

    function compareForms(a, b) {
        if (!a || !b) return 'none';
        if (a.trim() === b.trim()) return 'identical';

        const la = lookalikeNormalize(a);
        const lb = lookalikeNormalize(b);
        const sa = skeleton(a);
        const sb = skeleton(b);

        // two names made only of invisible characters both look blank
        if (!la && !lb) return a.trim() && b.trim() ? 'lookalike' : 'none';
        if (!la || !lb) return 'none';
        if (la === lb || (sa.length >= 3 && sa === sb)) return 'lookalike';

        // numbered series such as "Bank #1" vs "Bank #2" are different accounts by design
        const series = (s) => baseNormalize(s).replace(/\d+/g, '#');
        if (series(a) === series(b)) return 'none';

        // a copied name wrapped in tags like "[TF2] … !!" still contains the original
        const shortest = Math.min(sa.length, sb.length);
        if (shortest >= 6 && (sa.includes(sb) || sb.includes(sa))) return 'similar';

        // longer names tolerate one more edit before two accounts stop looking alike
        const allowedEdits = shortest >= 10 ? 2 : shortest >= 4 ? 1 : 0;
        if (allowedEdits && levenshtein(sa, sb) <= allowedEdits) return 'similar';

        return 'none';
    }

    function avatarHash(url) {
        const match = String(url || '').match(/([0-9a-f]{40})(?:_(?:full|medium))?\.jpg/i);
        if (!match) return null;

        const hash = match[1].toLowerCase();

        return hash === DEFAULT_AVATAR_HASH ? null : hash;
    }

    // ----- Steam responses read as text: API key page, profile XML -----

    // state: 'key' | 'none' | 'logged_out' | 'unknown'
    function parseApiKeyPage(html, finalUrl = '') {
        if (/\/login\b/.test(finalUrl) || /g_steamID\s*=\s*false/.test(html)) {
            return { state: 'logged_out' };
        }

        const domainMatch = html.match(/Domain Name:\s*([^<\n]+)/i);
        const domain = domainMatch ? domainMatch[1].trim() : null;
        const keyMatch = html.match(/Key:\s*([0-9A-F]{32})\b/i);

        if (keyMatch) {
            return { state: 'key', key: keyMatch[1].toUpperCase(), domain };
        }

        // a revoke form only exists while a key is registered
        if (/revokekey/i.test(html)) {
            return { state: 'key', key: null, domain };
        }

        if (/registerkey/i.test(html) || /id=["']domain["']/i.test(html)) {
            return { state: 'none' };
        }

        return { state: 'unknown' };
    }

    function xmlTag(xml, tag) {
        const match = xml.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`));
        if (!match) return null;

        return (match[1] !== undefined ? match[1] : match[2]).trim();
    }

    // parses https://steamcommunity.com/profiles/<id>/?xml=1
    function parseProfileXml(xml) {
        if (!xml || /<error>/.test(xml)) return null;

        const steamId = xmlTag(xml, 'steamID64');
        if (!/^\d{17}$/.test(steamId || '')) return null;

        return {
            steamId,
            name: xmlTag(xml, 'steamID') || '',
            avatarHash: avatarHash(xmlTag(xml, 'avatarFull') || xmlTag(xml, 'avatarIcon')),
            privacy: xmlTag(xml, 'privacyState') || 'unknown',
            tradeBan: xmlTag(xml, 'tradeBanState') || 'None',
            vacBanned: xmlTag(xml, 'vacBanned') === '1',
            limited: xmlTag(xml, 'isLimitedAccount') === '1',
            memberSince: xmlTag(xml, 'memberSince')
        };
    }

    // ----- account age: profile dates and SteamID estimates -----

    const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

    // accepts full ("October") and abbreviated ("Oct") English month names
    function monthIndex(name) {
        const prefix = String(name).toLowerCase().slice(0, 3);
        return prefix.length === 3 ? MONTHS.findIndex((m) => m.startsWith(prefix)) : -1;
    }

    // Steam omits the year for dates in the current year, so a missing year means the latest such date.
    // Parsed by hand because Date.parse is lenient and differs between browsers.
    function daysSince(monthName, day, year, now) {
        const month = monthIndex(monthName);
        if (month === -1) return null;

        let time = Date.UTC(year ? Number(year) : now.getUTCFullYear(), month, Number(day));
        if (!year && time > now.getTime()) time = Date.UTC(now.getUTCFullYear() - 1, month, Number(day));

        return Math.floor((now.getTime() - time) / DAY_MS);
    }

    // [accountId, creation date] from public profiles, with each ID rounded to the nearest 100,000 so
    // no anchor points at a specific account (that shifts a date by hours, not days). Account IDs are
    // handed out in order, but not at a steady pace (the 2017 PUBG boom alone created ~400M accounts),
    // hence many anchors.
    const ID_ANCHORS = [
        [3600000, '2004-01-14'], [68500000, '2010-08-09'], [119900000, '2012-12-31'], [136500000, '2013-07-05'],
        [159200000, '2013-12-25'], [188600000, '2014-08-07'], [216100000, '2015-01-28'], [243600000, '2015-06-25'],
        [285700000, '2015-08-21'], [321500000, '2016-02-05'], [362400000, '2016-08-07'], [436600000, '2017-06-17'],
        [449400000, '2017-08-04'], [872600000, '2018-04-27'], [901300000, '2018-09-22'], [940500000, '2019-02-05'],
        [1023300000, '2019-08-12'], [1058200000, '2020-01-13'], [1112800000, '2020-07-09'], [1164300000, '2020-12-30'],
        [1198400000, '2021-04-05'], [1477900000, '2022-11-23'], [1536400000, '2023-04-16'], [1873000000, '2025-03-08'],
        [1900700000, '2025-05-24']
    ].map(([id, date]) => [id, Date.parse(`${date}T00:00:00Z`)]);

    function steamId64ToAccountId(steamId) {
        return Number(BigInt(steamId) - STEAMID64_BASE);
    }

    // learned: extra [accountId, time] anchors collected at runtime. A learned point must fall between
    // the built-in points around it; otherwise one misread profile could push out every point after it.
    function mergeAnchors(learned = []) {
        const plausible = learned.filter(([id, time]) => {
            const before = [...ID_ANCHORS].reverse().find(([anchorId]) => anchorId <= id);
            const after = ID_ANCHORS.find(([anchorId]) => anchorId >= id);

            return (!before || time >= before[1]) && (!after || time <= after[1]);
        });
        const kept = [];

        for (const anchor of [...ID_ANCHORS, ...plausible].sort((a, b) => a[0] - b[0])) {
            if (!kept.length || anchor[1] >= kept[kept.length - 1][1]) kept.push(anchor);
        }

        return kept;
    }

    function estimateCreationTime(steamId, now = new Date(), learned = []) {
        const anchors = mergeAnchors(learned);
        const id = steamId64ToAccountId(steamId);

        if (id <= anchors[0][0]) return anchors[0][1];

        for (let i = 1; i < anchors.length; i++) {
            const [id1, t1] = anchors[i];
            if (id > id1) continue;

            const [id0, t0] = anchors[i - 1];
            return id1 === id0 ? t1 : t0 + ((t1 - t0) * (id - id0)) / (id1 - id0);
        }

        // newer than every anchor: extrapolate at the creation rate of roughly the last year
        const last = anchors[anchors.length - 1];
        const reference = [...anchors].reverse().find((a) => last[1] - a[1] >= 365 * DAY_MS) || anchors[0];
        const idsPerMs = (last[0] - reference[0]) / (last[1] - reference[1]);

        return Math.min(now.getTime(), last[1] + (id - last[0]) / idsPerMs);
    }

    function estimatedAgeDays(steamId, now = new Date(), learned = []) {
        return Math.max(0, Math.floor((now.getTime() - estimateCreationTime(steamId, now, learned)) / DAY_MS));
    }

    // "March 3, 2015" → creation time. Steam sometimes drops the year even for accounts years old
    // ("August 7" on a 2017 account), so a missing year is resolved from the SteamID, never assumed.
    function memberSinceTime(memberSince, steamId = null, now = new Date(), learned = []) {
        const match = String(memberSince || '').trim().match(/^([A-Za-z]+)\s+(\d{1,2}),?(?:\s+(\d{4}))?$/);
        if (!match) return null;

        const month = monthIndex(match[1]);
        if (month === -1) return null;

        const day = Number(match[2]);
        if (match[3]) return Date.UTC(Number(match[3]), month, day);
        if (!steamId) return null;

        const estimate = estimateCreationTime(steamId, now, learned);
        const year = new Date(estimate).getUTCFullYear();
        const candidates = [year - 1, year, year + 1]
            .map((y) => Date.UTC(y, month, day))
            .filter((time) => time <= now.getTime())
            .sort((a, b) => Math.abs(a - estimate) - Math.abs(b - estimate));

        return candidates.length ? candidates[0] : null;
    }

    function accountAgeDays(memberSince, now = new Date(), steamId = null, learned = []) {
        const time = memberSinceTime(memberSince, steamId, now, learned);
        return time === null ? null : Math.floor((now.getTime() - time) / DAY_MS);
    }

    // name-history timestamps: "28 Oct @ 4:41pm" or "Oct 28, 2024 @ 4:41pm" → days ago
    function aliasAgeDays(text, now = new Date()) {
        const value = String(text || '').trim();

        const dayFirst = value.match(/^(\d{1,2})\s+([A-Za-z]+),?(?:\s+(\d{4}))?\s*@/);
        if (dayFirst) return daysSince(dayFirst[2], dayFirst[1], dayFirst[3], now);

        const monthFirst = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?(?:\s+(\d{4}))?\s*@/);
        if (monthFirst) return daysSince(monthFirst[1], monthFirst[2], monthFirst[3], now);

        return null;
    }

    // ----- copied offers -----

    // order-independent key for a list of item identifiers
    function itemsKey(items) {
        return [...items].sort().join('|');
    }

    // offer: { offerId, partnerId, give: [...], get: [...] }
    // An API-key scam cancels a real offer and sends a copy from another account that asks for the
    // same items, giving back the same (look-alike) items or nothing at all.
    function findMirroredOffer(offer, others) {
        if (!offer.give.length || !offer.partnerId) return null;

        const give = itemsKey(offer.give);
        const get = itemsKey(offer.get);

        return others.find((other) =>
            other.offerId !== offer.offerId &&
            other.partnerId &&
            other.partnerId !== offer.partnerId &&
            itemsKey(other.give) === give &&
            (offer.get.length === 0 || itemsKey(other.get) === get)
        ) || null;
    }

    // ----- partner assessment -----

    // Steam's name history lists the current name first, with the date it was taken:
    // [{ newname: 'Kiro', timechanged: '3 Mar, 2021 @ 2:37pm' }, { newname: 'RocketMan', ... }, ...]
    function previousNames(profile, aliases) {
        const names = (aliases || []).map((alias) => alias.newname).filter((name) => name && name !== profile.name);
        return [...new Set(names)];
    }

    function renameFinding(profile, aliases, now) {
        if (!aliases || !aliases.length) return null;

        const names = previousNames(profile, aliases).slice(0, 3);
        const days = aliases[0].newname === profile.name ? aliasAgeDays(aliases[0].timechanged, now) : null;

        if (days !== null && days <= 7) return { level: 'warning', code: 'recentRename', value: days, previousNames: names };

        return names.length ? { level: 'info', code: 'renamed', previousNames: names } : null;
    }

    // contacts: [{ steamId, name, avatarHash, source: 'friend' | 'partner' }]
    // options: { selfId, now, aliases, anchors }
    // returns { findings: [{ level, code, ... }], ageDays, ageEstimated }
    function assessPartner(profile, contacts, options = {}) {
        const findings = [];
        const now = options.now || new Date();
        const exactAge = accountAgeDays(profile.memberSince, now, profile.steamId, options.anchors);
        const ageEstimated = exactAge === null;
        const ageDays = ageEstimated ? estimatedAgeDays(profile.steamId, now, options.anchors) : exactAge;

        const friendEntry = contacts.find((c) => c.source === 'friend' && c.steamId === profile.steamId);
        if (friendEntry) findings.push({ level: 'info', code: 'isFriend' });

        // "I lost my account, add my new one" is a classic opener: a friend added recently hasn't
        // earned the benefit of the doubt that long-standing friends get below
        const trustedFriend = Boolean(friendEntry && !friendEntry.recentFriend);
        if (friendEntry && friendEntry.recentFriend) findings.push({ level: 'warning', code: 'recentFriend' });

        const rename = renameFinding(profile, options.aliases, now);

        // trading sites sometimes run several bots with one name; a copy is usually new, private or just renamed
        const established = ageDays >= 365 && profile.privacy === 'public' && !(rename && rename.code === 'recentRename');

        const formerNames = previousNames(profile, options.aliases);

        for (const contact of contacts) {
            if (contact.steamId === profile.steamId || contact.steamId === options.selfId) continue;

            const nameMatch = compareNames(profile.name, contact.name);
            const sameAvatar = Boolean(profile.avatarHash && profile.avatarHash === contact.avatarHash);
            const sameName = nameMatch === 'identical' || nameMatch === 'lookalike';

            // names like "A" are too generic to prove anything on their own
            const distinctiveName = skeleton(profile.name).length >= 3;

            // Steam's official avatars are shared by thousands of accounts, so an avatar alone isn't
            // proof either: it takes a distinctive copied name, or a copied avatar plus a similar name
            const impostor = (sameName && distinctiveName) || (sameAvatar && nameMatch !== 'none');

            if (impostor) {
                // two real friends can share a common name; you already chose to friend this one
                if (trustedFriend) {
                    findings.push({ level: 'warning', code: 'sharedIdentity', contact, sameAvatar, sameName });
                } else if (contact.source === 'partner' && !friendEntry && established) {
                    findings.push({ level: 'warning', code: 'samePartnerName', contact, sameAvatar, sameName });
                } else {
                    findings.push({
                        level: 'danger',
                        code: contact.source === 'friend' ? 'impostorFriend' : 'impostorPartner',
                        contact,
                        sameAvatar,
                        sameName
                    });
                }
            } else if (sameAvatar && !trustedFriend) {
                findings.push({ level: 'warning', code: 'sameAvatar', contact });
            } else if (nameMatch !== 'none') {
                findings.push({ level: 'warning', code: 'similarName', contact });
            }

            // an account that used to call itself like someone you know has impersonated them before
            const former = formerNames.find((name) =>
                skeleton(name).length >= 4 && ['identical', 'lookalike'].includes(compareNames(name, contact.name))
            );
            if (former) findings.push({ level: 'warning', code: 'formerlyNamedLike', contact, formerName: former });
        }

        if (hasDirectionControls(profile.name)) {
            findings.push({ level: 'warning', code: 'directionTrick' });
        }

        // a name can't be trusted to carry an ID: "Kiro · SteamID64: 7656..." is just text
        if (/7656119\d{10}/.test(profile.name || '')) {
            findings.push({ level: 'warning', code: 'nameHasSteamId' });
        }

        if (impersonatesStaff(profile.name)) {
            findings.push({ level: 'danger', code: 'staffImpersonation' });
        }

        if (profile.tradeBan && profile.tradeBan !== 'None') {
            findings.push({ level: 'danger', code: 'tradeBan', value: profile.tradeBan });
        }

        // an estimate can be off by a few months, so it needs a stricter threshold before warning
        if (!ageEstimated && ageDays < 180) {
            findings.push({ level: 'warning', code: 'newAccount', value: ageDays });
        } else if (ageEstimated && ageDays < 120) {
            findings.push({ level: 'warning', code: 'newAccountEstimated', value: ageDays });
        }

        if (profile.privacy === 'private' || profile.privacy === 'friendsonly') {
            findings.push({ level: 'warning', code: 'privateProfile' });
        }

        if (profile.limited) {
            findings.push({ level: 'warning', code: 'limited' });
        }

        if (rename) findings.push(rename);

        return { findings, ageDays, ageEstimated };
    }

    // ----- items: Name Tags and Description Tags -----

    // Steam's item hover page embeds the item as BuildHover( 'id', {...} );
    function parseItemHover(html) {
        const text = String(html || '');
        const call = text.indexOf('BuildHover(');
        const open = call < 0 ? -1 : text.indexOf('{', call);
        if (open < 0) return null;

        // walk to the matching brace, skipping braces inside JSON strings
        let depth = 0;
        let inString = false;

        for (let i = open; i < text.length; i++) {
            const code = text.charCodeAt(i);

            if (inString) {
                if (code === 92) i += 1; // backslash: skip the escaped character
                else if (code === 34) inString = false;
            } else if (code === 34) {
                inString = true;
            } else if (code === 123) {
                depth += 1;
            } else if (code === 125 && --depth === 0) {
                try {
                    return JSON.parse(text.slice(open, i + 1));
                } catch {
                    return null;
                }
            }
        }

        return null;
    }

    // TF2 shows player-written text (Name Tag, Description Tag) between doubled apostrophes
    const CUSTOM_TEXT = /^''([\s\S]*)''$/;

    // what makes an item worth far more than a plain one. A Name or Description Tag that claims
    // one of these on an item that doesn't have it is the "fake unusual" scam.
    const VALUE_WORDS = [
        'unusual', 'effect', 'australium', 'strange', 'genuine', 'vintage', 'haunted', "collector's", 'decorated',
        'killstreak', 'specialized', 'professional', 'festivized', 'spelled', 'halloween spell', 'key', 'earbuds',
        'golden frying pan', 'burning flames', 'scorching flames', 'sunbeams', 'green energy', 'purple energy',
        'cloud 9', 'hearts', 'team captain', 'max\'s severed head'
    ];

    function hasWord(text, word) {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
    }

    // description: an item as Steam describes it (name, market_hash_name, descriptions, fraudwarnings)
    // returns null for an item without player-written text
    function itemCustomization(description) {
        if (!description) return null;

        const warnings = (description.fraudwarnings || []).map(String);
        const descriptions = (description.descriptions || []).map((d) => String((d && d.value) || '').trim());
        const renamed = warnings.find((w) => /renamed/i.test(w));
        const nameMatch = String(description.name || '').match(CUSTOM_TEXT);
        const descriptionMatch = descriptions.map((value) => value.match(CUSTOM_TEXT)).find(Boolean);

        const customName = nameMatch ? nameMatch[1] : renamed ? String(description.name || '') : null;
        const customDescription = descriptionMatch ? descriptionMatch[1] : null;
        if (customName === null && customDescription === null && !warnings.length) return null;

        const originalName = renamed ? (renamed.match(/Original name:\s*"([\s\S]*)"/) || [])[1] || null : null;
        const realName = description.market_hash_name || description.market_name || originalName || '';

        // only words the item doesn't already earn from its real name and Steam's own lines
        const steamLines = descriptions.filter((value) => !CUSTOM_TEXT.test(value));
        const genuine = baseNormalize([realName, originalName, ...steamLines].join(' '));
        const custom = baseNormalize([customName, customDescription].filter(Boolean).join(' '));
        const claims = VALUE_WORDS.filter((word) => hasWord(custom, word) && !hasWord(genuine, word));

        return { realName, customName, customDescription, claims, warnings };
    }

    // descriptions: the items you'd receive
    function itemFindings(descriptions) {
        const customized = descriptions.map(itemCustomization).filter(Boolean);
        const fake = customized.filter((item) => item.claims.length);
        const other = customized.filter((item) => !item.claims.length);
        const findings = [];

        if (fake.length) findings.push({ level: 'danger', code: 'fakeValueItem', items: fake });
        if (other.length) findings.push({ level: 'warning', code: 'customizedItems', items: other });

        return findings;
    }

    // ----- messages and comments: phishing links, scam lines, fake staff -----

    // [domain, brand]: the brand is what a lookalike domain copies (null when it isn't a target)
    const KNOWN_SITES = [
        ['steamcommunity.com', 'steamcommunity'], ['steampowered.com', 'steampowered'], ['steamstatic.com', null],
        ['steam-chat.com', null], ['akamaihd.net', null], ['valvesoftware.com', 'valvesoftware'],
        ['teamfortress.com', 'teamfortress'], ['teamfortress.tv', null], ['backpack.tf', 'backpacktf'],
        ['scrap.tf', 'scraptf'], ['marketplace.tf', 'marketplacetf'], ['stntrading.eu', 'stntrading'],
        ['mannco.store', 'mannco'], ['quicksell.store', 'quicksell'], ['rep.tf', null]
    ].map(([domain, brand]) => ({ domain, brand: brand && skeleton(brand) }));

    // top-level domains a bare "word.word" must end in to count as a link, so "e.g." or "1.33 ref" don't
    const LINK_TLDS = new Set(('com net org ru su ua by kz tf eu store gg io xyz top site online shop info me co cc uk us ' +
        'de pl fr nl br ar cl pro link click fun trade market app dev vip live icu cyou cfd sbs monster ws tk ml ga ' +
        'cf gq to pw biz in cn tv gift buzz club best lol').split(' '));

    function registrableDomain(host) {
        const labels = host.split('.').filter(Boolean);
        const secondLevel = labels.length >= 3 && labels[labels.length - 1].length === 2 &&
            ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'].includes(labels[labels.length - 2]);

        return labels.slice(secondLevel ? -3 : -2).join('.');
    }

    // Steam wraps links in comments and messages as /linkfilter/?u=<real link>
    function unwrapLink(href) {
        try {
            const url = new URL(href, 'https://steamcommunity.com/');
            if (url.hostname === 'steamcommunity.com' && url.pathname.startsWith('/linkfilter')) {
                return url.searchParams.get('u') || url.searchParams.get('url') || '';
            }
            return url.href;
        } catch {
            return '';
        }
    }

    // returns [{ host, disguised }] as written, so homoglyphs survive for the lookalike check
    function extractLinks(text, hrefs = []) {
        const sources = [String(text || ''), ...hrefs.map(unwrapLink)];
        const links = new Map();
        const add = (host, disguised) => {
            const clean = host.replace(/^www\./i, '').replace(/\.+$/, '').toLowerCase();
            if (clean.includes('.') && !(links.get(clean) || {}).disguised) links.set(clean, { host: clean, disguised });
        };

        for (const source of sources) {
            // explicit links: "https://steamcommunity.com@evil.example" really goes to evil.example
            for (const m of source.matchAll(/(?:https?:\/\/|www\.)([^\s/?#<>"']+)/giu)) {
                const authority = m[1];
                add(authority.split('@').pop().split(':')[0], authority.includes('@'));
            }

            for (const m of source.matchAll(/(?<![\p{L}\p{N}@.\/-])((?:[\p{L}\p{N}-]+\.)+(\p{L}{2,}))(?![\p{L}\p{N}-])/gu)) {
                if (LINK_TLDS.has(m[2].toLowerCase())) add(m[1], false);
            }
        }

        return [...links.values()];
    }

    // returns the real site a link imitates, '' for a real site, null for an unrelated one
    function imitatedSite(host) {
        // a punycode label ("xn--stamcommunity-r8i") keeps its plain letters before the last hyphen,
        // which is enough to see what it copies without decoding it
        const folded = baseNormalize(host).split('.').map((label) => {
            if (!label.startsWith('xn--')) return label;
            const end = label.lastIndexOf('-');
            return end > 3 ? label.slice(4, end) : '';
        }).join('.');
        const known = KNOWN_SITES.find((site) => site.domain === registrableDomain(folded));

        // a real domain spelled with lookalike letters is a copy of it
        if (known) return folded === host ? '' : known.domain;

        const registrable = registrableDomain(folded);
        const whole = skeleton(folded);
        const candidates = [skeleton(registrable.split('.')[0]), skeleton(registrable)];

        for (const site of KNOWN_SITES) {
            if (!site.brand) continue;
            if (whole.includes(site.brand)) return site.domain;

            const limit = site.brand.length >= 10 ? 2 : 1;
            if (candidates.some((c) => c.length >= 5 && levenshtein(c, site.brand) <= limit)) return site.domain;
        }

        return null;
    }

    // run on text normalized by baseNormalize, so lookalike letters can't dodge them
    const SCAM_LINES = [
        /\bvote for (?:me|my|our)\b/,
        /\bis (?:this|that) (?:you|u)\b/,
        /\bis (?:this|that) (?:your|ur) (?:item|items|inventory|account|acc|skin|stuff)\b/,
        /\b(?:accidentally|accidently|mistakenly|by mistake)\b[^.!?]{0,30}\breport/,
        /\b(?:account|acc|inventory|items?)\b[^.!?]{0,30}\b(?:will|would|is going to|gonna) (?:get |be )?(?:banned|blocked|locked|suspended|deleted|frozen)\b/,
        /\b(?:steam|valve) (?:support|staff|admin|administrator|moderator|security|employee)\b/,
        /\bfree (?:keys?|items?|skins?|unusuals?|hats?)\b/,
        /\bgiveaway\b/,
        /\b(?:log|sign) ?in (?:with|through|via|on) (?:your )?steam\b/,
        /\bverify (?:your|ur) (?:account|acc|inventory|items?|trades?|steam)\b/,
        /\b(?:check|open|click|visit) (?:out )?(?:this|my|the) (?:link|site|website|page)\b/,
        /\b(?:send|trade|give) (?:me )?(?:your|ur|the) items? (?:to|for|so) (?:i can )?(?:check|verify|test|confirm)\b/
    ];

    // options: { unknownLinks } also reports links to unrelated sites
    function analyzeText(text, hrefs = [], options = {}) {
        const findings = [];
        const fakes = [];
        const unknown = [];

        for (const link of extractLinks(text, hrefs)) {
            const imitates = imitatedSite(link.host);

            if (imitates) fakes.push({ host: link.host, imitates });
            else if (link.disguised) fakes.push({ host: link.host, imitates: null });
            else if (imitates === null) unknown.push(link.host);
        }

        if (fakes.length) findings.push({ level: 'danger', code: 'phishingLink', links: fakes });
        if (unknown.length && options.unknownLinks) findings.push({ level: 'warning', code: 'unknownLink', hosts: unknown });

        const normalized = baseNormalize(text);
        const phrases = [...new Set(SCAM_LINES.map((line) => (normalized.match(line) || [])[0]).filter(Boolean))];
        if (phrases.length) findings.push({ level: 'warning', code: 'scamPhrase', phrases });

        return findings;
    }

    const STAFF_ORGS = ['steam', 'valve'].map(skeleton);
    const STAFF_ROLES = ['support', 'admin', 'staff', 'moderator', 'security', 'official', 'employee', 'helpdesk']
        .map(skeleton);

    // Valve staff never trade, and never contact anyone through offers or comments
    function impersonatesStaff(name) {
        const s = skeleton(name);
        return STAFF_ORGS.some((org) => s.includes(org)) && STAFF_ROLES.some((role) => s.includes(role));
    }

    function worstLevel(findings) {
        if (findings.some((f) => f.level === 'danger')) return 'danger';
        if (findings.some((f) => f.level === 'warning')) return 'warning';
        return 'ok';
    }

    return {
        accountIdToSteamId64,
        baseNormalize,
        lookalikeNormalize,
        skeleton,
        levenshtein,
        visualForm,
        hasDirectionControls,
        compareNames,
        avatarHash,
        parseApiKeyPage,
        parseProfileXml,
        steamId64ToAccountId,
        estimateCreationTime,
        estimatedAgeDays,
        memberSinceTime,
        accountAgeDays,
        aliasAgeDays,
        itemsKey,
        findMirroredOffer,
        assessPartner,
        parseItemHover,
        itemCustomization,
        itemFindings,
        extractLinks,
        imitatedSite,
        analyzeText,
        impersonatesStaff,
        worstLevel
    };
})();

// ---------------------------------------------------------------------------
// Page: reads Steam's markup. Takes a document or element, returns plain data.
// ---------------------------------------------------------------------------
const Page = (() => {
    // which guard a page needs; pathname and search as in location
    function route(pathname, search = '') {
        const offerList = pathname.match(/^\/(?:id|profiles)\/[^/]+\/tradeoffers(\/sent)?\/?$/);
        if (offerList) {
            return { kind: 'offerList', isSent: Boolean(offerList[1]), isHistory: new URLSearchParams(search).has('history') };
        }

        const tradeWindow = pathname.match(/^\/tradeoffer\/(new|\d+)\/?$/);
        if (tradeWindow) return { kind: 'tradeWindow', offerId: tradeWindow[1] === 'new' ? null : tradeWindow[1] };

        return { kind: 'other' };
    }

    // forum threads use the same comment markup, but advice like "contact Steam Support" is normal there
    function wantsCommentCheck(pathname) {
        return !pathname.includes('/discussions');
    }

    // the logged-in account and the trade partner, from the page's inline scripts
    function selfSteamId(scriptsText) {
        return (String(scriptsText).match(/g_steamID\s*=\s*"(\d{17})"/) || [])[1] || null;
    }

    function tradePartnerId(scriptsText) {
        return (String(scriptsText).match(/g_ulTradePartnerSteamID\s*=\s*['"](\d{17})['"]/) || [])[1] || null;
    }

    // the name isn't always the block's first text node, so take everything except the status line
    function friendName(block) {
        const content = block.querySelector('.friend_block_content');
        if (!content) return '';

        const copy = content.cloneNode(true);
        copy.querySelectorAll('.friend_small_text').forEach((node) => node.remove());

        return copy.textContent.replace(/\s+/g, ' ').trim();
    }

    // /my/friends/
    function parseFriends(root) {
        return [...root.querySelectorAll('.friend_block_v2[data-steamid]')].map((block) => ({
            steamId: block.getAttribute('data-steamid'),
            name: friendName(block),
            avatarHash: Core.avatarHash(block.querySelector('.player_avatar img')?.getAttribute('src')),
            source: 'friend'
        }));
    }

    // Steam lays offers out differently (a large partner avatar for pending offers, small per-side
    // avatars for accepted or held ones), so take whichever account in the offer isn't the user
    function findPartner(el, selfId) {
        for (const node of el.querySelectorAll('[data-miniprofile]')) {
            const accountId = node.getAttribute('data-miniprofile');
            if (!/^\d+$/.test(accountId || '')) continue;

            const steamId = Core.accountIdToSteamId64(accountId);
            if (steamId !== selfId) return { steamId, avatarSrc: node.querySelector('img')?.getAttribute('src') || null };
        }

        return { steamId: null, avatarSrc: null };
    }

    // works on the live page and on fetched list/history pages, which share the same markup
    function parseOfferList(root, isSent, selfId) {
        return [...root.querySelectorAll('.tradeoffer[id^="tradeofferid_"]')].map((el) => {
            const partner = findPartner(el, selfId);
            const items = (side) => [...el.querySelectorAll(`.tradeoffer_items.${side} .trade_item`)].map((item) =>
                item.getAttribute('data-economy-item') || item.querySelector('img')?.getAttribute('src') || '?'
            );
            const primary = items('primary');
            const secondary = items('secondary');
            const message = el.querySelector('.tradeoffer_message .quote') || el.querySelector('.tradeoffer_message');

            return {
                el,
                offerId: el.id.replace('tradeofferid_', ''),
                partnerId: partner.steamId,
                partnerAvatar: partner.avatarSrc,
                give: isSent ? primary : secondary,
                get: isSent ? secondary : primary,
                message: message ? message.textContent.trim() : '',
                messageLinks: message ? [...message.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) : []
            };
        });
    }

    // the trade window shows items as #item<app>_<context>_<assetid>; null for anything that isn't a
    // TF2 item, so the caller can say it couldn't check it
    function theirTradeAssetIds(root) {
        return [...root.querySelectorAll('#their_slots .item')].map((el) => (el.id.match(/^item440_2_(\d+)$/) || [])[1] || null);
    }

    // a comment on a profile, group or workshop page
    function commentParts(comment) {
        const text = comment.querySelector('.commentthread_comment_text');
        if (!text) return null;

        // one selector at a time: the avatar link comes first in the markup and has no text, so a combined
        // selector ('a, b') would return it instead of the author's name
        const author = comment.querySelector('.commentthread_author_link') ||
            [...comment.querySelectorAll('.commentthread_comment_author a')].find((a) => a.textContent.trim());

        return {
            textEl: text,
            text: text.textContent,
            hrefs: [...text.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
            author: author ? author.textContent.trim() : ''
        };
    }

    return {
        route,
        wantsCommentCheck,
        selfSteamId,
        tradePartnerId,
        friendName,
        parseFriends,
        findPartner,
        parseOfferList,
        theirTradeAssetIds,
        commentParts
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Core, Page };
} else {
    runUserscript();
}

// ---------------------------------------------------------------------------
// Userscript: storage, same-origin fetching and UI
// ---------------------------------------------------------------------------
function runUserscript() {
    // ----- setup: limits, strings, storage, helpers -----

    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const MAX_PROFILES_CACHED = 300;
    const MAX_PARTNERS_REMEMBERED = 500;

    const quoteList = (names) => names.map((name) => `"${name}"`).join(', ');
    const clip = (text) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

    // "Strange Rocket Launcher" renamed ''Unusual Rocket'', with description ''...''
    function describeItems(items) {
        const shown = items.slice(0, 3).map((item) => [
            item.realName ? `"${item.realName}"` : 'an item',
            item.customName !== null ? ` renamed ''${clip(item.customName)}''` : '',
            item.customDescription !== null ? ` with description ''${clip(item.customDescription)}''` : '',
            item.customName === null && item.customDescription === null ? ` (${clip(item.warnings[0] || '')})` : ''
        ].join(''));

        return shown.join('; ') + (items.length > 3 ? `; and ${items.length - 3} more` : '');
    }

    const T = {
        verdict: { ok: 'No alerts', warning: 'Review carefully', danger: 'DANGER: likely scam' },
        checking: 'Checking…',
        profileError: "Couldn't load this account's profile.",
        steamId: 'SteamID64',
        age: (d, estimated) => `${estimated ? '~' : ''}${d >= 365 ? `${Math.floor(d / 365)} year(s)` : `${d} day(s)`} old account${estimated ? ' (estimated from SteamID)' : ''}`,
        what: (f) => (f.sameAvatar && f.sameName ? 'name and avatar' : f.sameAvatar ? 'avatar' : 'name'),
        impostorFriend: (f, what) => `Impersonating your friend "${f.contact.name}": same ${what}, but a DIFFERENT account (the real one is ${f.contact.steamId}).`,
        impostorPartner: (f, what) => `Another account with the same ${what} has traded with you before (${f.contact.steamId}, "${f.contact.name}"). One of them is an impostor.`,
        similarName: (f) => `Name very similar to "${f.contact.name}" (${f.contact.steamId}). Double-check the SteamID64.`,
        recentFriend: 'Became your friend recently. Scammers often ask to be added ("I lost my old account") before impersonating someone you know.',
        samePartnerName: (f, what) => `Same ${what} as another account you traded with (${f.contact.steamId}, "${f.contact.name}"). Trading sites sometimes run several bots with one name, but impostors copy them too: check this SteamID64 on the site's official bot list.`,
        directionTrick:'Their name contains invisible characters that flip how text is displayed, a classic way to disguise a name.',
        nameHasSteamId: 'Their name contains a SteamID64. Names are just text: only trust the SteamID64 shown first in this panel.',
        sameAvatar: (f) => `Same avatar as "${f.contact.name}" (${f.contact.steamId}). Official Steam avatars are shared by many accounts, but double-check the SteamID64.`,
        tradeBan: (f) => `This account is trade banned (${f.value}).`,
        newAccount: (f) => `New account: created ${f.value} day(s) ago.`,
        newAccountEstimated: (f) => `Likely a new account: created about ${f.value} day(s) ago (estimated from its SteamID).`,
        privateProfile: "Private profile: name history is hidden, so recent renames can't be detected, and the account's age is only an estimate.",
        limited: 'Limited account (has never spent money on Steam).',
        isFriend: 'This account is on your friends list.',
        giftOffer: "You're giving items and receiving nothing.",
        friendsUnavailable: "Couldn't load your friends list: this account was not compared against your friends.",
        friendsEmpty: 'Your friends list is empty or unreadable: only past trade partners were compared.',
        unidentified: "Trade Guard couldn't identify the other account. Check its SteamID64 manually before accepting.",
        checkFailed: "Trade Guard couldn't check this offer. Review it manually before accepting.",
        recentRename: (f) => `Changed their name ${f.value === 0 ? 'today' : `${f.value} day(s) ago`}${f.previousNames.length ? ` (previously ${quoteList(f.previousNames)})` : ''}. Impostor accounts usually rename right before a scam.`,
        renamed: (f) => `Previously known as ${quoteList(f.previousNames)}.`,
        sharedIdentity: (f, what) => `Another account you know ("${f.contact.name}", ${f.contact.steamId}) has the same ${what}. This one is on your friends list, but make sure it's the one you mean.`,
        formerlyNamedLike: (f) => `This account used to be called "${f.formerName}", like "${f.contact.name}" (${f.contact.steamId}), someone you know. It may have impersonated them before.`,
        mirrorOffer: (f) => `This offer copies one you had with another account (${f.other.partnerName ? `"${f.other.partnerName}", ` : ''}${f.other.partnerId}): it asks for the exact same items and gives you nothing. This is how API key scams replace a real offer. Do NOT accept.`,
        mirrorCopy: (f) => `Another account (${f.other.partnerName ? `"${f.other.partnerName}", ` : ''}${f.other.partnerId}) recently had an offer with exactly the same items. If you were expecting that offer, this one may be a copy (API key scam): compare the SteamID64s.`,
        mirrorUnavailable: "Couldn't load your offer history: copied-offer detection is incomplete.",
        counts: (give, get) => `You give ${give} item(s) · You get ${get} item(s)`,
        customizedItems: (f) => `${f.items.length} item(s) you receive carry text written by a player (Name Tag or Description Tag): ${describeItems(f.items)}. Go by the real item name, not the custom text.`,
        fakeValueItem: (f) => `An item you receive is named or described to look more valuable than it is: ${describeItems(f.items)}. Do NOT trust its name or description.`,
        itemsUnchecked: "Trade Guard couldn't check every item you receive for fake names or descriptions. Hover over each item and read its real name.",
        phishingLink: (f) => `Link to a FAKE site: ${f.links.map((l) => (l.imitates ? `${l.host} (imitates ${l.imitates})` : `${l.host} (disguised as another address)`)).join(', ')}. Never sign in or enter anything there.`,
        unknownLink: (f) => `The message links to ${f.hosts.join(', ')}. Never sign in through a link someone sent you; type the site's address yourself.`,
        scamPhrase: (f) => `Contains a line common in scams: ${quoteList(f.phrases)}.`,
        staffImpersonation: 'Their name claims to be Steam or Valve staff. Valve staff never trade, and never contact you through offers or comments.',
        staffComment: 'The author claims to be Steam or Valve staff. Valve never contacts anyone through comments.',
        apiBanner: (s) => `⚠\uFE0F A Steam Web API key is registered on your account${s.domain ? ` (domain: ${s.domain})` : ''}${s.keyTail ? `, ending in …${s.keyTail}` : ''}. If you did NOT create it, a scammer can see and replace your trade offers. Revoke it now and change your password. (The domain is just a label typed by whoever created the key; it doesn't mean that site made it.)`,
        apiKeyUnreadable: "Trade Guard can't read this key, so it can't be marked as trusted. Check it on the API key page.",
        apiUnverified: "Trade Guard hasn't been able to verify your API key for over 24 hours. Check it manually.",
        openKeyPage: 'Open the API key page',
        revoke: 'Revoke now',
        trust: "It's mine, trust this key",
        trustPrompt: (expected) => `NO legitimate site or person will ever ask you to press this button.\n\nOnly continue if YOU created this key (e.g. for your own bot). If unsure, cancel and revoke it.\n\nTo confirm, type exactly: ${expected}`,
        trustMismatch: "That doesn't match. The key was NOT marked as trusted."
    };

    // Data about the logged-in account is kept per account, so switching to an alt on the same
    // browser never uses another account's friends, partners or API key state. Public data
    // (profiles, name histories, age anchors) is shared.
    const ACCOUNT_KEYS = new Set(['apikey', 'trustedKeys', 'friends', 'friendsSeen', 'partners']);
    let accountScope = null; // set by main() as soon as the logged-in SteamID is known
    const scopedKey = (key) => (ACCOUNT_KEYS.has(key) ? `${accountScope}:${key}` : key);

    // plain objects, so values stay readable/editable in Tampermonkey's Storage tab
    const store = {
        get: (key, fallback) => {
            const value = GM_getValue(scopedKey(key), fallback);
            if (typeof value !== 'string') return value;

            // 0.1.0 stored JSON strings
            try {
                return JSON.parse(value);
            } catch {
                return fallback;
            }
        },
        set: (key, value) => GM_setValue(scopedKey(key), value)
    };

    const log = (...args) => console.log('[TF2 Trade Guard]', ...args);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function h(tag, props = {}, ...children) {
        const node = document.createElement(tag);

        for (const [key, value] of Object.entries(props)) {
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value);
        }

        // strings become text nodes, so Steam names can never inject markup
        for (const child of children.flat()) {
            if (child !== null && child !== undefined && child !== false) node.append(child);
        }

        return node;
    }

    function pageScriptsText() {
        return [...document.querySelectorAll('script:not([src])')].map((s) => s.textContent).join('\n');
    }

    async function getText(path) {
        const response = await fetch(path, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);

        return { text: await response.text(), url: response.url };
    }

    async function sha256(text) {
        const bytes = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest('SHA-256', bytes);

        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // ----- API key watch -----

    // the cached banner is already on the page, and its text must never be parsed as Steam's
    function pageHtmlWithoutOwnUi() {
        const copy = document.documentElement.cloneNode(true);
        copy.querySelectorAll('#tg-api-banner, .tg-panel').forEach((node) => node.remove());

        return copy.outerHTML;
    }

    async function checkApiKey(force) {
        const previous = store.get('apikey', null);
        const maxAge = force ? 2 * MINUTE : 15 * MINUTE;
        const onKeyPage = location.pathname.startsWith('/dev/apikey');

        // on the key page itself the answer is already on screen, so never trust the cache
        if (!onKeyPage && previous && Date.now() - previous.checkedAt < maxAge) return previous;

        const page = onKeyPage
            ? { text: pageHtmlWithoutOwnUi(), url: location.href }
            : await getText('/dev/apikey');
        const parsed = Core.parseApiKeyPage(page.text, page.url);

        // never let an unreadable page clear a previous alert
        if (parsed.state === 'logged_out' || parsed.state === 'unknown') return previous;

        // only a hash and the last 4 characters are kept, never the key itself
        const status = {
            state: parsed.state,
            checkedAt: Date.now(),
            domain: parsed.domain || null,
            keyTail: parsed.key ? parsed.key.slice(-4) : null,
            fingerprint: parsed.state === 'key' ? await sha256(parsed.key || `domain:${parsed.domain}`) : null
        };

        store.set('apikey', status);

        return status;
    }

    // afterCheck: a check was just attempted, so a missing or stale status means it failed
    function showApiBanner(status, afterCheck = false) {
        document.getElementById('tg-api-banner')?.remove();

        if (afterCheck && (!status || Date.now() - status.checkedAt > DAY)) {
            document.body.prepend(h('div', { id: 'tg-api-banner', class: 'tg-unverified' },
                h('span', { text: T.apiUnverified }),
                h('a', { class: 'tg-btn', href: 'https://steamcommunity.com/dev/apikey', text: T.openKeyPage })
            ));
            return;
        }

        if (!status || status.state !== 'key') return;
        if (store.get('trustedKeys', []).includes(status.fingerprint)) return;

        const onKeyPage = location.pathname.startsWith('/dev/apikey');
        const revoke = h('a', { class: 'tg-btn tg-btn-danger', href: 'https://steamcommunity.com/dev/apikey', text: T.revoke });

        if (onKeyPage) {
            revoke.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelector('form[action*="revokekey"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }

        const trust = h('button', {
            class: 'tg-btn',
            text: T.trust,
            onclick: () => {
                // typing it out forces a deliberate decision a phishing page can't click through
                const expected = status.domain || status.keyTail || 'CONFIRM';
                const typed = prompt(T.trustPrompt(expected));
                if (typed === null) return;

                if (typed.trim().toLowerCase() !== expected.toLowerCase()) {
                    alert(T.trustMismatch);
                    return;
                }

                store.set('trustedKeys', [...store.get('trustedKeys', []), status.fingerprint]);
                document.getElementById('tg-api-banner')?.remove();
            }
        });

        // without the key itself, a "trusted" fingerprint could only be its domain, which anyone can reuse
        const canTrust = Boolean(status.keyTail);

        document.body.prepend(h('div', { id: 'tg-api-banner' },
            h('span', { text: T.apiBanner(status) + (canTrust ? '' : ` ${T.apiKeyUnreadable}`) }),
            revoke,
            canTrust ? trust : null
        ));
    }

    // ----- contacts: friends + previously seen trade partners -----

    // bump when Page.friendName() changes, so lists parsed the old way are fetched again
    const FRIENDS_PARSER_VERSION = 2;

    async function getFriends() {
        const cached = store.get('friends', null);
        const fresh = cached && cached.parser === FRIENDS_PARSER_VERSION && Date.now() - cached.fetchedAt < 6 * HOUR;
        if (fresh) return cached.list;

        const { text } = await getText('/my/friends/');
        const list = Page.parseFriends(new DOMParser().parseFromString(text, 'text/html'));

        // an empty result may mean Steam changed the page, so don't let it stick for hours
        if (list.length) store.set('friends', { list, parser: FRIENDS_PARSER_VERSION, fetchedAt: Date.now() });

        return list;
    }

    // friendsStatus: 'ok' | 'empty' | 'error'
    async function buildContacts() {
        let friends = [];
        let friendsStatus = 'ok';

        try {
            friends = await getFriends();
            if (!friends.length) friendsStatus = 'empty';
        } catch (error) {
            friendsStatus = 'error';
            log('could not load friends list', error);
        }

        const friendIds = new Set(friends.map((f) => f.steamId));
        const partners = Object.entries(store.get('partners', {}))
            .filter(([steamId]) => !friendIds.has(steamId))
            .map(([steamId, p]) => ({ steamId, name: p.name, avatarHash: p.avatarHash, source: 'partner' }));

        return { contacts: markRecentFriends(friends).concat(partners), friendsStatus };
    }

    // Remembers when each friend first appeared. The first list ever seen is the baseline, so only
    // friends added after Trade Guard was installed can count as recent.
    function markRecentFriends(friends) {
        if (!friends.length) return friends;

        const now = Date.now();
        const seen = store.get('friendsSeen', null);

        if (!seen) {
            store.set('friendsSeen', { baselineAt: now, firstSeen: Object.fromEntries(friends.map((f) => [f.steamId, now])) });
            return friends;
        }

        const newcomers = friends.filter((f) => !(f.steamId in seen.firstSeen));
        if (newcomers.length) {
            newcomers.forEach((f) => { seen.firstSeen[f.steamId] = now; });
            store.set('friendsSeen', seen);
        }

        return friends.map((friend) => {
            const firstSeen = seen.firstSeen[friend.steamId];
            return { ...friend, recentFriend: firstSeen > seen.baselineAt && now - firstSeen < 30 * DAY };
        });
    }

    function friendsFindings(friendsStatus) {
        if (friendsStatus === 'error') return [{ level: 'warning', code: 'friendsUnavailable' }];
        if (friendsStatus === 'empty') return [{ level: 'info', code: 'friendsEmpty' }];
        return [];
    }

    function rememberPartner(profile) {
        const partners = store.get('partners', {});

        partners[profile.steamId] = { name: profile.name, avatarHash: profile.avatarHash, seenAt: Date.now() };

        const kept = Object.entries(partners)
            .filter(([, p]) => Date.now() - p.seenAt < 90 * DAY)
            .sort((a, b) => b[1].seenAt - a[1].seenAt)
            .slice(0, MAX_PARTNERS_REMEMBERED);

        store.set('partners', Object.fromEntries(kept));
    }

    // ----- profiles, name history and learned age anchors -----

    function keepNewest(cache, max) {
        return Object.fromEntries(
            Object.entries(cache)
                .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
                .slice(0, max)
        );
    }

    async function getProfile(steamId) {
        const cache = store.get('profiles', {});
        const hit = cache[steamId];

        if (hit && Date.now() - hit.fetchedAt < 6 * HOUR) return hit.profile;

        const { text } = await getText(`/profiles/${steamId}/?xml=1&l=english`);
        const profile = Core.parseProfileXml(text);

        if (profile) {
            cache[steamId] = { profile, fetchedAt: Date.now() };
            store.set('profiles', keepNewest(cache, MAX_PROFILES_CACHED));
            learnAgeAnchor(profile);
        }

        return profile;
    }

    // every public profile with a full creation date sharpens the SteamID → age estimate, locally
    function learnAgeAnchor(profile) {
        const time = Core.memberSinceTime(profile.memberSince);
        if (time === null) return;

        const accountId = Core.steamId64ToAccountId(profile.steamId);
        const anchors = store.get('idAnchors', []).filter(([id]) => id !== accountId);

        anchors.push([accountId, time]);
        store.set('idAnchors', anchors.slice(-MAX_PROFILES_CACHED));
    }

    // the "previous names" list on Steam profiles
    async function getAliases(steamId) {
        const cache = store.get('aliases', {});
        const hit = cache[steamId];

        if (hit && Date.now() - hit.fetchedAt < 6 * HOUR) return hit.aliases;

        const response = await fetch(`/profiles/${steamId}/ajaxaliases/?l=english`, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status} for aliases of ${steamId}`);

        const data = await response.json();
        const aliases = (Array.isArray(data) ? data : [])
            .filter((alias) => alias && typeof alias.newname === 'string')
            .slice(0, 10)
            .map((alias) => ({ newname: alias.newname, timechanged: String(alias.timechanged || '') }));

        cache[steamId] = { aliases, fetchedAt: Date.now() };
        store.set('aliases', keepNewest(cache, MAX_PROFILES_CACHED));

        return aliases;
    }

    // ----- copied-offer detection -----

    // History still lists offers that were canceled seconds after arriving, which the user may
    // never have seen — exactly the offers an API-key scam replaces. It's never cached across page
    // loads: a copy usually arrives seconds after the original is canceled, and a history read even
    // a minute earlier would not contain that cancellation yet.
    let recentOffersLoad = null;

    function getRecentOffers(selfId) {
        if (!recentOffersLoad) recentOffersLoad = loadRecentOffers(selfId);
        return recentOffersLoad;
    }

    async function loadRecentOffers(selfId) {
        const sources = [
            [`/profiles/${selfId}/tradeoffers/?history=1`, false],
            [`/profiles/${selfId}/tradeoffers/sent/`, true],
            [`/profiles/${selfId}/tradeoffers/sent/?history=1`, true]
        ];
        const offers = [];
        let loaded = 0;

        for (const [path, isSent] of sources) {
            try {
                const { text } = await getText(path);
                const doc = new DOMParser().parseFromString(text, 'text/html');

                offers.push(...Page.parseOfferList(doc, isSent, selfId).slice(0, 30).map(({ el, ...offer }) => offer));
                loaded += 1;
            } catch (error) {
                log('could not load offers from', path, error);
            }
        }

        return { offers, complete: loaded === sources.length };
    }

    // siblings: the other offers currently listed alongside this one
    function mirrorFindings(offer, recent, siblings) {
        const findings = [];
        if (!recent.complete) findings.push({ level: 'warning', code: 'mirrorUnavailable' });

        const match = Core.findMirroredOffer(offer, recent.offers.concat(siblings));
        if (!match) return findings;

        const known = store.get('profiles', {})[match.partnerId];
        const other = { partnerId: match.partnerId, partnerName: known ? known.profile.name : '' };

        // asking for the same items while giving nothing back is the scam itself;
        // the same deal on both sides could also be two buyers offering the same price
        findings.push(offer.get.length === 0
            ? { level: 'danger', code: 'mirrorOffer', other }
            : { level: 'warning', code: 'mirrorCopy', other });

        return findings;
    }

    // ----- items you'd receive: Name Tags and Description Tags -----

    const MAX_ITEMS_CHECKED = 40;
    const itemDescriptions = new Map(); // per page load: economy key → Promise<description>

    // offer lists tag items as data-economy-item="classinfo/<app>/<class>/<instance>"
    function getItemDescription(key) {
        if (!itemDescriptions.has(key)) {
            const m = String(key).match(/^classinfo\/(\d+)\/(\d+)(?:\/(\d+))?/);
            const load = m
                ? getText(`/economy/itemclasshover/${m[1]}/${m[2]}/${m[3] || 0}?content_only=1&l=english`)
                    .then(({ text }) => Core.parseItemHover(text))
                : Promise.resolve(null);
            itemDescriptions.set(key, load);
        }

        return itemDescriptions.get(key);
    }

    // keys: data-economy-item values of the items you'd receive
    async function receivedItemFindings(keys) {
        const unique = [...new Set(keys)];
        const descriptions = [];
        let incomplete = unique.length > MAX_ITEMS_CHECKED;

        for (const key of unique.slice(0, MAX_ITEMS_CHECKED)) {
            // spaced out so a long offer list doesn't hit Steam's rate limit
            if (!itemDescriptions.has(key)) await sleep(100);

            try {
                const description = await getItemDescription(key);
                if (description) descriptions.push(description);
                else incomplete = true;
            } catch (error) {
                log('item lookup failed', key, error);
                incomplete = true;
            }
        }

        const findings = Core.itemFindings(descriptions);
        if (incomplete) findings.push({ level: 'warning', code: 'itemsUnchecked' });
        return findings;
    }

    // The trade window shows items as #item<app>_<context>_<assetid> without their descriptions,
    // so the partner's public inventory is read once to look them up.
    let partnerInventoryLoad = null;

    function getPartnerInventory(partnerId) {
        if (!partnerInventoryLoad) {
            partnerInventoryLoad = loadPartnerInventory(partnerId).catch((error) => {
                partnerInventoryLoad = null; // try again on the next change
                throw error;
            });
        }
        return partnerInventoryLoad;
    }

    async function loadPartnerInventory(partnerId) {
        const byAsset = new Map();
        let start = '';

        for (let page = 0; page < 5; page++) {
            const { text } = await getText(`/inventory/${partnerId}/440/2?l=english&count=2000${start ? `&start_assetid=${start}` : ''}`);
            const data = JSON.parse(text);
            if (!data || !data.success) throw new Error('inventory unavailable');

            const byClass = new Map((data.descriptions || []).map((d) => [`${d.classid}_${d.instanceid}`, d]));
            for (const asset of data.assets || []) byAsset.set(String(asset.assetid), byClass.get(`${asset.classid}_${asset.instanceid}`));

            if (!data.more_items || !data.last_assetid) break;
            start = data.last_assetid;
            await sleep(500);
        }

        return byAsset;
    }

    async function tradeWindowItemFindings(partnerId) {
        const ids = Page.theirTradeAssetIds(document);
        if (!ids.length) return [];

        try {
            const inventory = await getPartnerInventory(partnerId);
            const descriptions = ids.map((id) => id && inventory.get(id));
            const findings = Core.itemFindings(descriptions.filter(Boolean));

            if (descriptions.some((d) => !d)) findings.push({ level: 'warning', code: 'itemsUnchecked' });
            return findings;
        } catch (error) {
            log('partner inventory unavailable', error);
            return [{ level: 'warning', code: 'itemsUnchecked' }];
        }
    }

    // ----- trade offer panels -----

    function findingText(finding) {
        const entry = T[finding.code];
        if (typeof entry !== 'function') return entry;

        return entry(finding, T.what(finding));
    }

    function setPanelLevel(panel, level) {
        panel.classList.remove('tg-ok', 'tg-warning', 'tg-danger');
        panel.classList.add(`tg-${level}`);
    }

    // shown instead of a verdict whenever the check couldn't run, so silence never looks like "all clear"
    function renderNotice(panel, code) {
        setPanelLevel(panel, 'warning');
        panel.replaceChildren(
            h('div', { class: 'tg-head' }, h('strong', { text: '🛡\uFE0F Trade Guard · ' }), T.verdict.warning),
            h('ul', {}, h('li', { class: 'tg-warning', text: T[code] }))
        );
    }

    // the list is capped, so the most serious findings must come first
    function sortBySeverity(findings) {
        const rank = { danger: 0, warning: 1, info: 2 };
        return [...findings].sort((a, b) => rank[a.level] - rank[b.level]);
    }

    function findingItems(findings, max = Infinity) {
        return sortBySeverity(findings)
            .slice(0, max)
            .map((finding) => h('li', { class: `tg-${finding.level}`, text: findingText(finding) }));
    }

    function renderPanel(panel, profile, findings, ageDays, ageEstimated) {
        const level = Core.worstLevel(findings);
        const id = profile.steamId;

        setPanelLevel(panel, level);
        panel.dataset.level = level;
        panel.replaceChildren(
            h('div', { class: 'tg-head' }, h('strong', { text: '🛡\uFE0F Trade Guard · ' }), h('span', { class: 'tg-verdict', text: T.verdict[level] })),
            // the real SteamID64 comes first and the name is quoted, so a name that imitates
            // this line ("Kiro · SteamID64: 7656...") can't pass for it
            h('div', { class: 'tg-info' },
                `${T.steamId}: `,
                h('code', { text: id }),
                profile.name ? ' · ' : null,
                profile.name ? h('span', { class: 'tg-name', text: `"${profile.name}"` }) : null,
                ageDays !== null ? ` · ${T.age(ageDays, ageEstimated)}` : null,
                ' · ',
                h('a', { href: `https://rep.tf/${id}`, target: '_blank', rel: 'noopener noreferrer', text: 'rep.tf' }),
                ' · ',
                h('a', { href: `https://backpack.tf/profiles/${id}`, target: '_blank', rel: 'noopener noreferrer', text: 'backpack.tf' })
            ),
            findings.length
                ? h('ul', {}, findingItems(findings, 6))
                : null
        );
    }

    function profileFallback(steamId, avatarSrc) {
        return {
            steamId,
            name: '',
            avatarHash: Core.avatarHash(avatarSrc),
            privacy: 'unknown',
            tradeBan: 'None',
            limited: false,
            memberSince: null
        };
    }

    async function assessAndRender(panel, steamId, avatarSrc, contacts, selfId, extraFindings = []) {
        let profile = null;

        try {
            profile = await getProfile(steamId);
        } catch (error) {
            log('profile fetch failed', steamId, error);
        }

        // name history is an extra signal; without it the other checks still stand
        let aliases = [];
        if (profile) {
            try {
                aliases = await getAliases(steamId);
            } catch (error) {
                log('name history fetch failed', steamId, error);
            }
        }

        const usable = profile || profileFallback(steamId, avatarSrc);
        const anchors = store.get('idAnchors', []);
        const { findings, ageDays, ageEstimated } = Core.assessPartner(usable, contacts, { selfId, aliases, anchors });

        if (!profile) findings.push({ level: 'warning', code: 'profileError' });

        renderPanel(panel, usable, findings.concat(extraFindings), ageDays, ageEstimated);

        if (profile) rememberPartner(profile);

        return usable;
    }

    // ----- trade offer list -----

    // /id/<name>/tradeoffers/ and /tradeoffers/sent/ (plus their ?history=1 views)
    async function guardOfferList(selfId, { isSent, isHistory }) {
        const offers = Page.parseOfferList(document, isSent, selfId);
        if (!offers.length) return;

        // copies only matter for offers you can still accept, and history would flag the originals
        const { contacts, friendsStatus } = await buildContacts();
        const recent = !isSent && !isHistory ? await getRecentOffers(selfId) : null;

        for (const offer of offers) {
            const panel = h('div', { class: 'tg-panel' }, T.checking);
            const anchor = offer.el.querySelector('.tradeoffer_items_ctn');
            if (anchor) anchor.before(panel);
            else offer.el.append(panel);

            // one broken offer must not leave the rest of the list unchecked
            try {
                if (!offer.partnerId) {
                    renderNotice(panel, 'unidentified');
                    continue;
                }

                const extra = friendsFindings(friendsStatus);
                if (offer.give.length > 0 && offer.get.length === 0) extra.push({ level: 'warning', code: 'giftOffer' });
                if (recent) extra.push(...mirrorFindings(offer, recent, offers));

                // offers you can still act on: even an offer you sent may include a fake item you picked
                if (!isHistory) extra.push(...await receivedItemFindings(offer.get));

                // your own message isn't evidence of anything
                if (!isSent) extra.push(...Core.analyzeText(offer.message, offer.messageLinks, { unknownLinks: true }));

                const profile = await assessAndRender(
                    panel, offer.partnerId, offer.partnerAvatar, contacts, selfId, extra
                );

                // later offers in this same list are compared against this partner too
                if (!contacts.some((c) => c.steamId === profile.steamId)) {
                    const { steamId, name, avatarHash } = profile;
                    contacts.push({ steamId, name, avatarHash, source: 'partner' });
                }
            } catch (error) {
                log('offer check failed', error);
                renderNotice(panel, 'checkFailed');
            }

            await sleep(250);
        }
    }

    // the trade window doesn't expose item identities, so read this offer from the incoming list
    async function receivedOfferFindings(selfId, offerId) {
        let incoming;

        try {
            const { text } = await getText(`/profiles/${selfId}/tradeoffers/`);
            incoming = Page.parseOfferList(new DOMParser().parseFromString(text, 'text/html'), false, selfId);
        } catch (error) {
            log('incoming offers unavailable', error);
            return [{ level: 'warning', code: 'mirrorUnavailable' }, { level: 'warning', code: 'itemsUnchecked' }];
        }

        const offer = incoming.find((o) => o.offerId === offerId);

        // not an incoming offer (e.g. one you sent), nothing to compare
        if (!offer) return [];

        return [
            ...mirrorFindings(offer, await getRecentOffers(selfId), incoming),
            ...await receivedItemFindings(offer.get),
            ...Core.analyzeText(offer.message, offer.messageLinks, { unknownLinks: true })
        ];
    }

    // ----- trade window -----

    // /tradeoffer/new/ and /tradeoffer/<id>/
    async function guardTradeWindow(selfId, { offerId }) {
        const partnerId = Page.tradePartnerId(pageScriptsText());
        const hasTradeUi = Boolean(document.querySelector('#your_slots, #their_slots, .trade_area'));

        // expired or invalid offers render an error page with neither
        if (!partnerId && !hasTradeUi) return;

        const panel = h('div', { class: 'tg-panel tg-window' }, T.checking);
        const anchor = document.querySelector('.trade_area') || document.querySelector('#mainContent');
        if (anchor) anchor.before(panel);
        else document.body.prepend(panel);

        if (!partnerId) {
            renderNotice(panel, 'unidentified');
            return;
        }

        try {
            const { contacts, friendsStatus } = await buildContacts();
            const extra = friendsFindings(friendsStatus);

            // a received offer opened directly (e.g. from a notification) gets the same checks as the list
            if (offerId) extra.push(...await receivedOfferFindings(selfId, offerId));

            await assessAndRender(panel, partnerId, null, contacts, selfId, extra);
        } catch (error) {
            log('trade window check failed', error);
            renderNotice(panel, 'checkFailed');
            return;
        }

        // item counts change while the offer is being built, so keep them live
        const counter = h('div', { class: 'tg-counts' });
        const liveItems = h('ul', { class: 'tg-live' });
        panel.append(counter, liveItems);

        const rank = { ok: 0, warning: 1, danger: 2 };
        let giftLevel = 'ok';
        let itemsLevel = 'ok';

        // the verdict was computed before any items were added, so it must follow the live state
        const refreshVerdict = () => {
            const level = [panel.dataset.level || 'ok', giftLevel, itemsLevel]
                .reduce((worst, next) => (rank[next] > rank[worst] ? next : worst));
            setPanelLevel(panel, level);

            const verdict = panel.querySelector('.tg-verdict');
            if (verdict) verdict.textContent = T.verdict[level];
        };

        // only a new offer is built live from the partner's inventory; a received offer's items
        // were already checked above
        const buildingOffer = !offerId;
        let itemCheck = 0;

        const updateItems = async () => {
            const ticket = ++itemCheck;
            const findings = await tradeWindowItemFindings(partnerId);
            if (ticket !== itemCheck) return; // a newer change already started another check

            itemsLevel = Core.worstLevel(findings);
            liveItems.replaceChildren(...findingItems(findings));
            refreshVerdict();
        };

        let theirItems = '';

        const updateCounts = () => {
            const give = document.querySelectorAll('#your_slots .item').length;
            const get = document.querySelectorAll('#their_slots .item').length;
            const gift = give > 0 && get === 0;

            counter.className = `tg-counts${gift ? ' tg-warning' : ''}`;
            counter.textContent = T.counts(give, get) + (gift ? ` — ${T.giftOffer}` : '');
            giftLevel = gift ? 'warning' : 'ok';
            refreshVerdict();

            const current = [...document.querySelectorAll('#their_slots .item')].map((el) => el.id).join(',');
            if (buildingOffer && current !== theirItems) {
                theirItems = current;
                updateItems().catch((error) => log('item check failed', error));
            }
        };

        updateCounts();

        // react to items being added or removed instead of polling
        const slots = ['#your_slots', '#their_slots'].map((selector) => document.querySelector(selector)).filter(Boolean);

        if (slots.length === 2) {
            let scheduled = false;
            const observer = new MutationObserver(() => {
                if (scheduled) return;

                scheduled = true;
                requestAnimationFrame(() => {
                    scheduled = false;
                    updateCounts();
                });
            });

            slots.forEach((slot) => observer.observe(slot, { childList: true, subtree: true }));
        } else {
            setInterval(updateCounts, 1500);
        }
    }

    // ----- comments (profiles, groups, workshop): phishing links and fake staff -----

    // only suspicious comments get a note; links to unrelated sites are too common there to flag
    function checkComment(comment) {
        comment.dataset.tgChecked = '1';

        const parts = Page.commentParts(comment);
        if (!parts) return;

        const findings = Core.analyzeText(parts.text, parts.hrefs);
        if (Core.impersonatesStaff(parts.author)) findings.push({ level: 'danger', code: 'staffComment' });
        if (!findings.length) return;

        const level = Core.worstLevel(findings);
        parts.textEl.after(h('div', { class: `tg-comment tg-${level}` },
            h('strong', { text: 'Trade Guard: ' }),
            sortBySeverity(findings).map(findingText).join(' ')
        ));
    }

    function guardComments() {
        const scan = () => {
            for (const comment of document.querySelectorAll('.commentthread_comment:not([data-tg-checked])')) {
                try {
                    checkComment(comment);
                } catch (error) {
                    log('comment check failed', error);
                }
            }
        };

        scan();

        // comment pages load and re-render through AJAX
        const areas = document.querySelectorAll('.commentthread_area');
        if (!areas.length) return;

        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;

            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                scan();
            });
        });

        areas.forEach((area) => observer.observe(area, { childList: true, subtree: true }));
    }

    // ----- styles -----

    function injectStyles() {
        GM_addStyle(`
            #tg-api-banner { position: sticky; top: 0; z-index: 99999; display: flex; flex-wrap: wrap; gap: 10px;
                align-items: center; padding: 12px 16px; background: #b3261e; color: #fff;
                font: 600 14px/1.4 "Motiva Sans", Arial, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.5); }
            #tg-api-banner.tg-unverified { background: #7a5c00; }
            #tg-api-banner span { flex: 1 1 400px; }
            .tg-btn { padding: 6px 12px; border: 1px solid rgba(255,255,255,.7); border-radius: 3px;
                background: transparent; color: #fff !important; font: inherit; cursor: pointer;
                text-decoration: none !important; }
            .tg-btn-danger { background: #fff; color: #b3261e !important; }
            .tg-panel { margin: 6px 0 8px; padding: 8px 12px; border-left: 4px solid #6b8aaa; border-radius: 3px;
                background: rgba(0,0,0,.35); color: #c6d4df; font: 13px/1.5 "Motiva Sans", Arial, sans-serif; }
            .tg-panel.tg-ok { border-left-color: #5c9e31; }
            .tg-panel.tg-warning { border-left-color: #e0a800; }
            .tg-panel.tg-danger { border-left-color: #e53935; background: rgba(120,20,20,.45); }
            .tg-panel.tg-window { margin: 0 0 12px; }
            .tg-head { font-size: 14px; color: #fff; }
            .tg-panel.tg-danger .tg-head { color: #ff8a80; }
            .tg-info code { color: #fff; user-select: all; }
            .tg-info a { color: #66c0f4; }
            .tg-name { color: #fff; }
            .tg-panel ul { margin: 4px 0 0; padding-left: 18px; }
            .tg-panel li.tg-danger { color: #ff8a80; font-weight: 600; }
            .tg-panel li.tg-warning { color: #ffd54f; }
            .tg-panel li.tg-info { color: #a5d6a7; }
            .tg-counts { margin-top: 4px; }
            .tg-counts.tg-warning { color: #ffd54f; font-weight: 600; }
            .tg-panel ul.tg-live:empty { display: none; }
            .tg-comment { margin: 4px 0; padding: 4px 8px; border-left: 3px solid #e0a800; background: rgba(0,0,0,.35);
                color: #ffd54f; font: 12px/1.4 "Motiva Sans", Arial, sans-serif; }
            .tg-comment.tg-danger { border-left-color: #e53935; color: #ff8a80; background: rgba(120,20,20,.45); }
        `);
    }

    // ----- startup -----

    async function main() {
        const selfId = Page.selfSteamId(pageScriptsText());
        if (!selfId) return; // logged out

        accountScope = selfId;

        const path = location.pathname;
        const page = Page.route(path, location.search);
        const onTradePage = /\/tradeoffers?(\/|$)/.test(path);

        injectStyles();
        showApiBanner(store.get('apikey', null));

        checkApiKey(onTradePage || path.startsWith('/dev/apikey'))
            .then((status) => showApiBanner(status, true))
            .catch((error) => {
                log('API key check failed', error);
                showApiBanner(store.get('apikey', null), true);
            });

        if (Page.wantsCommentCheck(path)) guardComments();

        if (page.kind === 'offerList') await guardOfferList(selfId, page);
        else if (page.kind === 'tradeWindow') await guardTradeWindow(selfId, page);
    }

    main().catch((error) => log('error', error));
}
