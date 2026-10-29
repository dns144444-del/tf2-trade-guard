// ==UserScript==
// @name         TF2 Trade Guard
// @namespace    https://github.com/dns144444-del/tf2-trade-guard
// @version      0.8.0
// @description  Warns about Steam API key scams, impostors, fake items and phishing. Talks only to steamcommunity.com.
// @author       dns144444-del
// @license      MIT
// @homepageURL  https://github.com/dns144444-del/tf2-trade-guard
// @supportURL   https://github.com/dns144444-del/tf2-trade-guard/issues
// @downloadURL  none
// @match        https://steamcommunity.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-end
// @noframes
// ==/UserScript==

'use strict';

// Four parts, from most to least testable:
//   Core           detection logic, no DOM or network (tests/core.test.js)
//   Page           reads Steam's markup into plain data (tests/page.test.js, on HTML fixtures)
//   Strings        every text the user reads (tests/strings.test.js)
//   runUserscript  storage, same-origin requests and the UI (tests/userscript.test.js)

// Core: pure detection logic. No DOM, no network.
const Core = (() => {
    const STEAMID64_BASE = 76561197960265728n;
    const DEFAULT_AVATAR_HASH = 'fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb';
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Names: lookalike letters, hidden characters, comparison

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

    // Steam responses read as text: API key page, profile XML

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

    // Account age: profile dates and SteamID estimates

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

    // [accountId, creation date] from public profiles, IDs rounded to 100,000 so none points at a real account.
    // IDs are handed out in order but at an uneven pace (the 2017 PUBG boom alone added ~400M), hence many anchors.
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

    // Copied offers

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

    // Partner assessment

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

    // One entry per account, however the user knows it: a bot can be a friend, a partner and listed at once.
    // friends: [{ steamId, name, avatarHash, recent }]; partners: same without recent; bots: [{ steamId, name }]
    function mergeContacts({ friends = [], partners = [], bots = [] }) {
        const byId = new Map();
        const entry = (steamId) => {
            if (!byId.has(steamId)) {
                byId.set(steamId, {
                    steamId, avatarHash: null, friend: null, partner: false, verified: false,
                    friendName: '', partnerName: '', listedName: ''
                });
            }
            return byId.get(steamId);
        };

        for (const friend of friends) {
            const contact = entry(friend.steamId);
            contact.friend = { recent: Boolean(friend.recent) };
            contact.friendName = friend.name || '';
            contact.avatarHash = friend.avatarHash || contact.avatarHash;
        }
        for (const partner of partners) {
            const contact = entry(partner.steamId);
            contact.partner = true;
            contact.partnerName = partner.name || '';
            contact.avatarHash = contact.avatarHash || partner.avatarHash || null;
        }
        for (const bot of bots) {
            const contact = entry(bot.steamId);
            contact.verified = true;
            contact.listedName = bot.name || '';
        }

        // the name the user knows best: a friend's current name, then a past partner's, then the listing
        return [...byId.values()].map((contact) => ({
            ...contact,
            name: contact.friendName || contact.partnerName || contact.listedName,
            names: [contact.friendName, contact.partnerName, contact.listedName].filter(Boolean)
        }));
    }

    function bestMatch(name, names) {
        return names.map((other) => compareNames(name, other))
            .reduce((best, match) => (MATCH_RANK[match] > MATCH_RANK[best] ? match : best), 'none');
    }

    // How the partner relates to one account the user knows: nothing, similarities, or an impersonation.
    // context: { trustedFriend, partnerIsFriend, partnerVerified, established, formerNames }
    function contactFindings(profile, contact, context) {
        const nameMatch = bestMatch(profile.name, contact.names);
        const sameAvatar = Boolean(profile.avatarHash && profile.avatarHash === contact.avatarHash);
        const sameName = nameMatch === 'identical' || nameMatch === 'lookalike';
        const as = (name) => ({ steamId: contact.steamId, name });
        const facts = { contact: as(contact.name), sameAvatar, sameName };
        const findings = [];

        // A name like "A" proves nothing alone, and neither does an official avatar thousands of accounts share.
        const impostor = (sameName && skeleton(profile.name).length >= 3) || (sameAvatar && nameMatch !== 'none');

        if (!impostor) {
            if (sameAvatar && !context.trustedFriend) findings.push({ level: 'warning', code: 'sameAvatar', ...facts });
            else if (nameMatch !== 'none') findings.push({ level: 'warning', code: 'similarName', ...facts });
        } else if (contact.verified) {
            // the verified list is the user's own: even a friend suddenly named like a listed bot is suspect
            const listed = { ...facts, contact: as(contact.listedName || contact.name) };
            findings.push({ level: 'danger', code: 'impostorVerifiedBot', impersonates: true, ...listed });
        } else if (context.trustedFriend) {
            // two real friends can share a common name, and the user chose to friend this one
            findings.push({ level: 'warning', code: 'sharedIdentity', ...facts });
        } else if (!contact.friend && !context.partnerIsFriend && (context.established || context.partnerVerified)) {
            // sites run several bots under one name; a copy is usually new, private or just renamed, and a bot
            // on the user's own list outranks an unlisted one either way
            findings.push({ level: 'warning', code: 'samePartnerName', ...facts });
        } else {
            findings.push({
                level: 'danger', code: contact.friend ? 'impostorFriend' : 'impostorPartner', impersonates: true, ...facts
            });
        }

        // an account that used to be named like someone you know has impersonated them before
        const former = context.formerNames.find((name) =>
            skeleton(name).length >= 4 && ['identical', 'lookalike'].includes(bestMatch(name, contact.names))
        );
        if (former) findings.push({ level: 'warning', code: 'formerlyNamedLike', contact: facts.contact, formerName: former });

        return findings;
    }

    // what the panel says when a piece of evidence couldn't be read; only a missing profile changes the verdict
    const UNAVAILABLE = {
        profile: { level: 'warning', code: 'profileError' },
        aliases: { level: 'info', code: 'aliasesUnchecked' },
        commentWall: { level: 'info', code: 'commentsUnchecked' },
        escrow: { level: 'info', code: 'escrowUnchecked' }
    };

    // the stand-in judged when a partner's profile can't be read: only its SteamID and avatar are known
    function fallbackProfile(steamId, avatarUrl) {
        return {
            steamId,
            name: '',
            avatarHash: avatarHash(avatarUrl),
            privacy: 'unknown',
            tradeBan: 'None',
            limited: false,
            memberSince: null
        };
    }

    // evidence: { selfId, now, anchors, aliases, escrow, commentWall, unavailable: ['profile' | 'aliases' |
    // 'commentWall' | 'escrow'] }; returns { findings: [{ level, code, ... }], ageDays, ageEstimated }
    function assessPartner(profile, contacts, evidence = {}) {
        const findings = [];
        const now = evidence.now || new Date();
        const exactAge = accountAgeDays(profile.memberSince, now, profile.steamId, evidence.anchors);
        const ageEstimated = exactAge === null;
        const ageDays = ageEstimated ? estimatedAgeDays(profile.steamId, now, evidence.anchors) : exactAge;

        const known = contacts.find((c) => c.steamId === profile.steamId) || null;
        const friend = known && known.friend;
        const verified = Boolean(known && known.verified);

        if (friend) findings.push({ level: 'info', code: 'isFriend' });

        // "I lost my account, add my new one" is a classic opener, so a recent friend gets no benefit of the doubt.
        if (friend && friend.recent) findings.push({ level: 'warning', code: 'recentFriend' });
        const trustedFriend = Boolean(friend && !friend.recent);

        if (verified) {
            findings.push({ level: 'info', code: 'verifiedBot' });
            if (profile.name && known.listedName && bestMatch(profile.name, [known.listedName]) === 'none') {
                findings.push({ level: 'warning', code: 'verifiedBotRenamed', listedName: known.listedName });
            }
        }

        const rename = renameFinding(profile, evidence.aliases, now);
        const context = {
            trustedFriend,
            partnerIsFriend: Boolean(friend),
            partnerVerified: verified,
            established: ageDays >= 365 && profile.privacy === 'public' && !(rename && rename.code === 'recentRename'),
            formerNames: previousNames(profile, evidence.aliases)
        };

        for (const contact of contacts) {
            if (contact.steamId === profile.steamId || contact.steamId === evidence.selfId) continue;

            // A verified bot shares its name with the site's other bots, so only those comparisons are skipped.
            if (verified && contact.verified) continue;

            findings.push(...contactFindings(profile, contact, context));
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

        findings.push(...escrowFindings(evidence.escrow, profile.name));
        findings.push(...commentWallFindings(evidence.commentWall, { ageDays, trusted: trustedFriend || verified }));
        findings.push(...(evidence.unavailable || []).map((what) => ({ ...UNAVAILABLE[what] })));
        if (rename) findings.push(rename);

        return { findings, ageDays, ageEstimated };
    }

    // Offers

    function giftFinding(giving, getting) {
        return giving > 0 && getting === 0 ? [{ level: 'warning', code: 'giftOffer' }] : [];
    }

    // recent: { offers, complete } from the user's offer history; siblings: the other offers listed with this
    // one; nameOf(steamId) gives a known name or ''
    function mirrorFindings(offer, recent, siblings, nameOf = () => '') {
        const findings = recent.complete ? [] : [{ level: 'warning', code: 'mirrorUnavailable' }];
        const match = findMirroredOffer(offer, recent.offers.concat(siblings));
        if (!match) return findings;

        const other = { partnerId: match.partnerId, partnerName: nameOf(match.partnerId) };

        // the same items for nothing back is the scam itself; the same deal both ways may be two buyers
        findings.push(offer.get.length === 0
            ? { level: 'danger', code: 'mirrorOffer', other }
            : { level: 'warning', code: 'mirrorCopy', other });

        return findings;
    }

    // What an offer says about itself. recent: the user's offer history, or null to skip the copy check;
    // items: findings about what the user receives. A sent offer's message is the user's own, not evidence.
    function offerFindings(offer, { isSent = false, recent = null, siblings = [], nameOf, items = [] } = {}) {
        return [
            ...(recent ? mirrorFindings(offer, recent, siblings, nameOf) : []),
            ...items,
            ...(isSent ? [] : analyzeText(offer.message, offer.messageLinks, { unknownLinks: true }))
        ];
    }

    // when the incoming offer list itself couldn't be read
    function unreadableOfferFindings() {
        return [{ level: 'warning', code: 'mirrorUnavailable' }, { level: 'warning', code: 'itemsUnchecked' }];
    }

    function friendsFindings(friendsStatus) {
        if (friendsStatus === 'error') return [{ level: 'warning', code: 'friendsUnavailable' }];
        if (friendsStatus === 'empty') return [{ level: 'info', code: 'friendsEmpty' }];
        return [];
    }

    // parts: { text, hrefs, author } of a comment; links to unrelated sites are too common there to flag
    function commentFindings(parts) {
        const findings = analyzeText(parts.text, parts.hrefs);
        if (impersonatesStaff(parts.author)) findings.push({ level: 'danger', code: 'staffComment' });
        return findings;
    }

    // Items: Name Tags and Description Tags

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

    // Messages and comments: phishing links, scam lines, fake staff

    // [domain, brand, runs trade bots]: the brand is what a lookalike domain copies (null when it isn't a target)
    const KNOWN_SITES = [
        ['steamcommunity.com', 'steamcommunity'], ['steampowered.com', 'steampowered'], ['steamstatic.com', null],
        ['steam-chat.com', null], ['akamaihd.net', null], ['valvesoftware.com', 'valvesoftware'],
        ['teamfortress.com', 'teamfortress'], ['teamfortress.tv', null], ['backpack.tf', 'backpacktf'],
        ['scrap.tf', 'scraptf', true], ['marketplace.tf', 'marketplacetf', true], ['stntrading.eu', 'stntrading', true],
        ['mannco.store', 'mannco', true], ['quicksell.store', 'quicksell', true], ['rep.tf', null]
    ].map(([domain, brand, runsBots = false]) => ({ domain, brand: brand && skeleton(brand), runsBots }));

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

    // "user@host:port" -> host, so "https://steamcommunity.com@evil.example" really goes to evil.example
    function authorityHost(authority) {
        return authority.split('@').pop().split(':')[0];
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
            for (const m of source.matchAll(/(?:https?:\/\/|www\.)([^\s/?#<>"']+)/giu)) {
                add(authorityHost(m[1]), m[1].includes('@'));
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

    // Trade holds and items from other games

    const TRADING_BRANDS = KNOWN_SITES.filter((site) => site.runsBots).map((site) => site.brand);

    // the names trading sites give their bots: "STN Trading Bot #12", "Scrap.TF Bot", "B0T"
    function looksLikeBot(name) {
        return /(^|[^\p{L}])bots?([^\p{L}]|$)/u.test(lookalikeNormalize(name)) ||
            TRADING_BRANDS.some((brand) => skeleton(name).includes(brand));
    }

    // escrow: { mine, theirs }, the days a trade would be held. A hold on their side means no Steam Guard
    // Mobile Authenticator, which every real trading bot has. With a hold on yours, the two can't be told apart.
    function escrowFindings(escrow, partnerName) {
        if (!escrow || escrow.mine !== 0 || !(escrow.theirs > 0)) return [];

        return [looksLikeBot(partnerName)
            ? { level: 'danger', code: 'botWithHold', value: escrow.theirs }
            : { level: 'warning', code: 'partnerHold', value: escrow.theirs }];
    }

    const APP_NAMES = { 440: 'Team Fortress 2', 570: 'Dota 2', 730: 'Counter-Strike 2', 753: 'Steam', 252490: 'Rust' };

    // words only TF2 items carry: on an item from another game they're a disguise
    const TF2_ONLY_WORDS = [
        'mann co', 'supply crate key', 'refined metal', 'reclaimed metal', 'scrap metal', 'australium',
        'strangifier', 'killstreak kit', 'team captain', "bill's hat", 'earbuds'
    ];

    // items: [{ appid, description }]. Trading across games is normal; an item from another game named
    // like a TF2 key or metal is a swap meant to pass for the real thing.
    function otherGameFindings(items) {
        const foreign = items.filter((item) => item.appid && String(item.appid) !== '440');
        if (!foreign.length) return [];

        const disguised = foreign.filter((item) => {
            const d = item.description || {};
            const name = baseNormalize(`${d.name || ''} ${d.market_hash_name || ''}`);
            return TF2_ONLY_WORDS.some((word) => hasWord(name, word));
        });
        const appsOf = (list) => [...new Set(list.map((item) => APP_NAMES[item.appid] || `app ${item.appid}`))];

        return disguised.length
            ? [{
                level: 'danger',
                code: 'disguisedItem',
                apps: appsOf(disguised),
                names: disguised.map((item) => item.description.name || item.description.market_hash_name)
            }]
            : [{ level: 'info', code: 'otherGameItems', apps: appsOf(foreign), value: foreign.length }];
    }

    // items: [{ appid, description | null }] the user would receive; truncated: the list was cut short.
    // An item that couldn't be described is reported, so a gap never reads as "all clear".
    function receivedItemFindings(items, { truncated = false } = {}) {
        const findings = [
            ...itemFindings(items.map((item) => item.description).filter(Boolean)),
            ...otherGameFindings(items)
        ];

        if (truncated || items.some((item) => !item.description)) findings.push({ level: 'warning', code: 'itemsUnchecked' });
        return findings;
    }

    // The partner's comment wall

    const SCAM_REPORT = new RegExp([
        String.raw`\b(?:scam(?:s|my|mer|mers|med|ming)?|fraud|thief|stole|impost[eo]r|impersonat\w*|phish\w*)\b`,
        String.raw`\b(?:api scam|fake (?:bot|account|middleman)|avoid (?:him|this|trading))\b`,
        String.raw`\b(?:do ?n'?t|do not|never) trade\b`,
        String.raw`(?:^|\s)-\s?rep\b`
    ].join('|'));

    // "not a scammer" or "never scammed me" is praise; "do not trade" is still a warning
    const NEGATED_ACCUSATION = /\b(?:not|no|never|isn'?t|wasn'?t|ain'?t)\s+(?:an?\s+)?(?:scam|fraud|thie|stole|impost|fake|phish)\S*/g;

    const CURLY_APOSTROPHE = String.fromCodePoint(0x2019);

    function isScamReport(text) {
        const normalized = baseNormalize(text).split(CURLY_APOSTROPHE).join("'");
        if (/\+\s?rep\b/.test(normalized) && !/(?:^|\s)-\s?rep\b/.test(normalized)) return false;

        return SCAM_REPORT.test(normalized.replace(NEGATED_ACCUSATION, ' '));
    }

    // A profile's comments reduced to what Trade Guard keeps: whether they're hidden, and the warnings
    // other people left. wall: { hidden, comments: [{ authorId, text }] } as Page.commentWall reads it.
    function scamReports(wall, partnerId) {
        if (wall.hidden) return { hidden: true, reports: [] };

        const reports = wall.comments
            .filter((comment) => comment.authorId && comment.authorId !== partnerId && isScamReport(comment.text))
            .slice(0, 10)
            .map((comment) => ({
                authorId: comment.authorId,
                text: comment.text.replace(/\s+/g, ' ').trim().slice(0, 200)
            }));

        return { hidden: false, reports };
    }

    // summary: from scamReports; options: { ageDays, trusted }. Several people calling a long-standing
    // friend or a verified bot a scammer is worth a look, not a red verdict.
    function commentWallFindings(summary, options = {}) {
        if (!summary) return [];

        if (summary.hidden) {
            const young = typeof options.ageDays === 'number' && options.ageDays < 180;
            return young ? [{ level: 'warning', code: 'commentsHidden' }] : [];
        }
        if (!summary.reports.length) return [];

        // friends joke about scamming each other; several different people saying it is what counts
        const authors = new Set(summary.reports.map((report) => report.authorId)).size;

        return [{
            level: authors >= 3 && !options.trusted ? 'danger' : 'warning',
            code: 'scamReports',
            value: authors,
            excerpts: summary.reports.slice(0, 2).map((report) => report.text.slice(0, 80))
        }];
    }

    // Signing in through Steam (OpenID)

    // URL() rejects some malformed punycode a phishing link may still use, so read the authority by hand then
    function hostOf(url) {
        try {
            return new URL(url).hostname.toLowerCase();
        } catch {
            const authority = (String(url || '').match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i) || [])[1];
            return authority ? authorityHost(authority).toLowerCase() : null;
        }
    }

    // request: { realm, returnTo, ambiguous } as Page.route reads it. Returns the site the sign-in is for
    // and how far to trust it, or null when the page isn't a sign-in request.
    function loginCheck({ realm, returnTo, ambiguous = false }) {
        if (!realm && !returnTo && !ambiguous) return null;

        const host = hostOf(returnTo) || hostOf(realm);

        // no real site sends a request Steam could read two ways, so any doubt fails closed
        if (ambiguous || !hostOf(returnTo)) return { host, level: 'danger', code: 'loginAmbiguous' };

        const realmHost = hostOf(realm);
        if (realmHost && registrableDomain(realmHost) !== registrableDomain(host)) {
            return { host, level: 'danger', code: 'loginMismatch', realmHost };
        }

        const imitates = imitatedSite(host);
        if (imitates) return { host, level: 'danger', code: 'loginLookalike', imitates };
        if (imitates === '') return { host, level: 'ok', code: 'loginKnown' };

        return { host, level: 'warning', code: 'loginUnknown' };
    }

    // Verified bots, the secret phrase and scam reports

    // What people paste: an exported list (JSON), profile links, or SteamID64s with a name after each.
    function parseBotList(text) {
        const source = String(text || '').trim();
        let entries = null;

        // only an object or a list is an export: a bare SteamID would parse as a rounded number
        if (/^[[{]/.test(source)) {
            try {
                const data = JSON.parse(source);
                const list = Array.isArray(data) ? data : Array.isArray(data.bots) ? data.bots : [data];

                // a numeric ID has already lost precision, so only string IDs are kept
                entries = list.map((bot) => ({
                    steamId: bot && typeof bot.steamId === 'string' ? bot.steamId : '',
                    name: bot && typeof bot.name === 'string' ? bot.name : ''
                }));
            } catch {
                entries = null;
            }
        }

        if (!entries) {
            entries = source.split('\n').map((line) => {
                const match = line.match(/7656119\d{10}/);
                if (!match) return null;

                const rest = line.slice(match.index + match[0].length).replace(/^[\s/,;:|-]+/, '');
                return { steamId: match[0], name: rest };
            }).filter(Boolean);
        }

        const seen = new Set();
        return entries
            .filter((bot) => /^7656119\d{10}$/.test(bot.steamId) && !seen.has(bot.steamId) && seen.add(bot.steamId))
            .map((bot) => ({ steamId: bot.steamId, name: bot.name.trim().slice(0, 64) }));
    }

    // existing: the stored list; returns { list, added } with the new bots stamped with `now`
    function mergeBotList(existing, text, now) {
        const known = new Set(existing.map((bot) => bot.steamId));
        const added = parseBotList(text)
            .filter((bot) => !known.has(bot.steamId))
            .map((bot) => ({ ...bot, addedAt: now }));

        return { list: existing.concat(added), added: added.length };
    }

    // invisible and control characters would let two different phrases look the same
    function cleanPhrase(value) {
        return String(value || '').replace(/\s+/g, ' ').replace(/\p{C}/gu, '').trim().slice(0, 40);
    }

    const SEVERITY = { danger: 0, warning: 1, info: 2 };

    // the panel's list is capped, so the most serious findings must come first
    function sortBySeverity(findings) {
        return [...findings].sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]);
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
        mergeContacts,
        fallbackProfile,
        giftFinding,
        mirrorFindings,
        offerFindings,
        unreadableOfferFindings,
        friendsFindings,
        commentFindings,
        looksLikeBot,
        escrowFindings,
        otherGameFindings,
        receivedItemFindings,
        isScamReport,
        scamReports,
        commentWallFindings,
        loginCheck,
        parseBotList,
        mergeBotList,
        cleanPhrase,
        sortBySeverity,
        worstLevel
    };
})();

// Page: reads Steam's markup. Takes a document or element, returns plain data.
const Page = (() => {
    // which guard a page needs; pathname, search and hash as in location
    function route(pathname, search = '', hash = '') {
        const offerList = pathname.match(/^\/(?:id|profiles)\/[^/]+\/tradeoffers(\/sent)?\/?$/);
        if (offerList) {
            return { kind: 'offerList', isSent: Boolean(offerList[1]), isHistory: new URLSearchParams(search).has('history') };
        }

        const tradeWindow = pathname.match(/^\/tradeoffer\/(new|\d+)\/?$/);
        if (tradeWindow) return { kind: 'tradeWindow', offerId: tradeWindow[1] === 'new' ? null : tradeWindow[1] };

        if (/^\/openid\/(?:login|loginform)\/?$/.test(pathname)) return { kind: 'login', ...openIdTarget(pathname, search) };

        const guide = reportGuideTarget(pathname, hash);
        return guide ? { kind: 'reportGuide', ...guide } : { kind: 'other' };
    }

    // A report button opens /profiles/<id>/#tradeguard-report-<nonce>. Anyone can type that address,
    // so it's only a request: the guide shows when the nonce matches one Trade Guard stored.
    function reportGuideTarget(pathname, hash) {
        const profile = pathname.match(/^\/profiles\/(\d{17})\/?$/);
        const nonce = String(hash).match(/^#tradeguard-report-([0-9a-f]{16,64})$/);

        return profile && nonce ? { steamId: profile[1], nonce: nonce[1] } : null;
    }

    // How PHP files a query key in $_GET: leading spaces dropped, cut at a NUL, and ' ', '.' and '[' become '_'.
    // Steam reads the query that way, so two keys PHP files under one name could mean two different sites.
    const NUL = String.fromCharCode(0);
    const phpName = (key) => key.replace(/^ +/, '').split(NUL)[0].replace(/[ .[]/g, '_');

    function collides(params, prefix) {
        const names = [...params.keys()].map(phpName).filter((name) => name.startsWith(prefix));
        return new Set(names).size !== names.length;
    }

    // /openid/login?openid.realm=...&openid.return_to=..., or /openid/loginform/?goto=<that address> when signed out.
    // ambiguous: Steam could read the request differently from what Trade Guard shows.
    function openIdTarget(pathname, search) {
        let params = new URLSearchParams(search);
        let ambiguous = false;

        if (pathname.startsWith('/openid/loginform')) {
            const gotoKeys = [...params.keys()].filter((key) => phpName(key) === 'goto');
            if (!gotoKeys.length) return { realm: null, returnTo: null, ambiguous: false };

            try {
                const target = new URL(params.get(gotoKeys[0]), 'https://steamcommunity.com');
                const toSignIn = target.origin === 'https://steamcommunity.com' && /^\/openid\/login\/?$/.test(target.pathname);
                ambiguous = gotoKeys.length > 1 || !toSignIn;
                params = target.searchParams;
            } catch {
                return { realm: null, returnTo: null, ambiguous: true };
            }
        }

        return {
            realm: params.get('openid.realm'),
            returnTo: params.get('openid.return_to'),
            ambiguous: ambiguous || collides(params, 'openid_')
        };
    }

    // How many days the trade would be held for each side. Only Steam's own `var` lines count, so a
    // partner's name that contains "g_daysTheirEscrow=0" can't answer for them.
    function escrowDays(scriptsText) {
        const days = (name) => {
            const match = String(scriptsText).match(new RegExp(`^\\s*var\\s+${name}\\s*=\\s*(-?\\d+)\\s*;`, 'm'));
            return match ? Number(match[1]) : null;
        };
        const mine = days('g_daysMyEscrow');
        const theirs = days('g_daysTheirEscrow');

        return mine === null || theirs === null ? null : { mine, theirs };
    }

    // data-economy-item="classinfo/<app>/<class>/<instance>" as offer lists tag their items
    function economyItem(key) {
        const match = String(key).match(/^classinfo\/(\d+)\/(\d+)(?:\/(\d+))?/);
        return match ? { appid: match[1], classid: match[2], instanceid: match[3] || '0' } : null;
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
            avatarHash: Core.avatarHash(block.querySelector('.player_avatar img')?.getAttribute('src'))
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

    // the trade window shows items as #item<app>_<context>_<assetid>; null for one it can't read, so
    // the caller can say it couldn't check it
    function theirTradeItems(root) {
        return [...root.querySelectorAll('#their_slots .item')].map((el) => {
            const match = el.id.match(/^item(\d+)_(\d+)_(\d+)$/);
            return match ? { appid: match[1], contextid: match[2], assetid: match[3] } : null;
        });
    }

    // a comment on a profile, group or workshop page
    function commentParts(comment) {
        const text = comment.querySelector('.commentthread_comment_text');
        if (!text) return null;

        // one selector at a time: the avatar link comes first in the markup and has no text, so a combined
        // selector ('a, b') would return it instead of the author's name
        const author = comment.querySelector('.commentthread_author_link') ||
            [...comment.querySelectorAll('.commentthread_comment_author a')].find((a) => a.textContent.trim());

        const authorAccount = author && author.getAttribute('data-miniprofile');

        return {
            textEl: text,
            text: text.textContent,
            hrefs: [...text.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
            author: author ? author.textContent.trim() : '',
            authorId: /^\d+$/.test(authorAccount || '') ? Core.accountIdToSteamId64(authorAccount) : null
        };
    }

    // a profile's /allcomments page; a private profile has no comment area at all
    function commentWall(root) {
        if (!root.querySelector('.commentthread_area')) return { hidden: true, comments: [] };

        const comments = [...root.querySelectorAll('.commentthread_comment')]
            .map(commentParts)
            .filter(Boolean)
            .map(({ authorId, text }) => ({ authorId, text }));

        return { hidden: false, comments };
    }

    return {
        route,
        wantsCommentCheck,
        selfSteamId,
        tradePartnerId,
        escrowDays,
        economyItem,
        friendName,
        parseFriends,
        findPartner,
        parseOfferList,
        theirTradeItems,
        commentParts,
        commentWall
    };
})();

// Strings: every text the user reads. Pure, so the wording can be tested without a page.
const Strings = (() => {
    const WARNING = String.fromCodePoint(0x26A0, 0xFE0F);

    const quoteList = (names) => names.map((name) => `"${name}"`).join(', ');
    const clip = (text) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);
    const duration = (days) => (days >= 365 ? `${Math.floor(days / 365)} year(s)` : `${days} day(s)`);

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

    function confirmReminder(name, age) {
        const prefix = 'Before confirming in the Steam app or email: the confirmation must show';
        const suffix = 'If anything differs, cancel it.';

        if (name) return `${prefix} "${name}"${age ? ` and an account that's ${age}` : ''}. ${suffix}`;
        if (age) return `${prefix} an account that's ${age}. ${suffix}`;
        return `Before confirming in the Steam app or email, check the account and the items it shows. ${suffix}`;
    }

    const T = {
        verdict: { ok: 'No alerts', warning: 'Review carefully', danger: 'DANGER: likely scam' },
        checking: 'Checking…',
        profileError: "Couldn't load this account's profile.",
        steamId: 'SteamID64',
        age: (d, estimated) => `${estimated ? '~' : ''}${duration(d)} old account${estimated ? ' (estimated from SteamID)' : ''}`,
        ageShort: (d, estimated) => `${estimated ? 'about ' : ''}${duration(d)} old`,
        what: (f) => (f.sameAvatar && f.sameName ? 'name and avatar' : f.sameAvatar ? 'avatar' : 'name'),

        // who the partner is
        impostorFriend: (f, what) => `Impersonating your friend "${f.contact.name}": same ${what}, but a DIFFERENT account (the real one is ${f.contact.steamId}).`,
        impostorPartner: (f, what) => `Another account with the same ${what} has traded with you before (${f.contact.steamId}, "${f.contact.name}"). One of them is an impostor.`,
        impostorVerifiedBot: (f, what) => `Impersonating the verified bot "${f.contact.name}" (${f.contact.steamId}): same ${what}, but a DIFFERENT account. Do NOT trade.`,
        similarName: (f) => `Name very similar to "${f.contact.name}" (${f.contact.steamId}). Double-check the SteamID64.`,
        recentFriend: 'Became your friend recently. Scammers often ask to be added ("I lost my old account") before impersonating someone you know.',
        samePartnerName: (f, what) => `Same ${what} as another account you traded with (${f.contact.steamId}, "${f.contact.name}"). Trading sites sometimes run several bots with one name, but impostors copy them too: check this SteamID64 on the site's official bot list.`,
        sharedIdentity: (f, what) => `Another account you know ("${f.contact.name}", ${f.contact.steamId}) has the same ${what}. This one is on your friends list, but make sure it's the one you mean.`,
        formerlyNamedLike: (f) => `This account used to be called "${f.formerName}", like "${f.contact.name}" (${f.contact.steamId}), someone you know. It may have impersonated them before.`,
        sameAvatar: (f) => `Same avatar as "${f.contact.name}" (${f.contact.steamId}). Official Steam avatars are shared by many accounts, but double-check the SteamID64.`,
        directionTrick: 'Their name contains invisible characters that flip how text is displayed, a classic way to disguise a name.',
        nameHasSteamId: 'Their name contains a SteamID64. Names are just text: only trust the SteamID64 shown first in this panel.',
        staffImpersonation: 'Their name claims to be Steam or Valve staff. Valve staff never trade, and never contact you through offers or comments.',
        isFriend: 'This account is on your friends list.',
        verifiedBot: 'On your verified bots list.',
        verifiedBotRenamed: (f) => `Your verified list calls this bot "${f.listedName}", but it's named differently now. Bots rarely rename: check its SteamID64 on the site's official list.`,
        tradeBan: (f) => `This account is trade banned (${f.value}).`,
        newAccount: (f) => `New account: created ${f.value} day(s) ago.`,
        newAccountEstimated: (f) => `Likely a new account: created about ${f.value} day(s) ago (estimated from its SteamID).`,
        privateProfile: "Private profile: name history is hidden, so recent renames can't be detected, and the account's age is only an estimate.",
        limited: 'Limited account (has never spent money on Steam).',
        recentRename: (f) => `Changed their name ${f.value === 0 ? 'today' : `${f.value} day(s) ago`}${f.previousNames.length ? ` (previously ${quoteList(f.previousNames)})` : ''}. Impostor accounts usually rename right before a scam.`,
        renamed: (f) => `Previously known as ${quoteList(f.previousNames)}.`,
        botWithHold: (f) => `Calls itself a bot, but this trade would be held ${f.value} day(s): its owner has no Steam Guard Mobile Authenticator. Every real trading bot has one, so this is almost certainly an impostor.`,
        partnerHold: (f) => `Their items would be held ${f.value} day(s): this account has no Steam Guard Mobile Authenticator.`,
        scamReports: (f) => `${f.value} other user(s) wrote scam warnings on this profile, e.g. ${quoteList(f.excerpts)}.`,
        commentsHidden: 'New account with its profile comments hidden, so nobody can leave warnings on it.',
        commentsUnchecked: "Couldn't read this profile's comments.",
        aliasesUnchecked: "Couldn't read this account's name history.",
        escrowUnchecked: "Couldn't read this trade's hold times, so a bot without a mobile authenticator can't be spotted.",

        // the offer
        giftOffer: "You're giving items and receiving nothing.",
        mirrorOffer: (f) => `This offer copies one you had with another account (${f.other.partnerName ? `"${f.other.partnerName}", ` : ''}${f.other.partnerId}): it asks for the exact same items and gives you nothing. This is how API key scams replace a real offer. Do NOT accept.`,
        mirrorCopy: (f) => `Another account (${f.other.partnerName ? `"${f.other.partnerName}", ` : ''}${f.other.partnerId}) recently had an offer with exactly the same items. If you were expecting that offer, this one may be a copy (API key scam): compare the SteamID64s.`,
        mirrorUnavailable: "Couldn't load your offer history: copied-offer detection is incomplete.",
        counts: (give, get) => `You give ${give} item(s) · You get ${get} item(s)`,
        customizedItems: (f) => `${f.items.length} item(s) you receive carry text written by a player (Name Tag or Description Tag): ${describeItems(f.items)}. Go by the real item name, not the custom text.`,
        fakeValueItem: (f) => `An item you receive is named or described to look more valuable than it is: ${describeItems(f.items)}. Do NOT trust its name or description.`,
        otherGameItems: (f) => `${f.value} item(s) you receive are from another game (${f.apps.join(', ')}). Make sure that's what you agreed to.`,
        disguisedItem: (f) => `${quoteList(f.names)} is from another game (${f.apps.join(', ')}), named like a TF2 item. It's NOT the TF2 item it pretends to be.`,
        itemsUnchecked: "Trade Guard couldn't check every item you receive for fake names or descriptions. Hover over each item and read its real name.",
        phishingLink: (f) => `Link to a FAKE site: ${f.links.map((l) => (l.imitates ? `${l.host} (imitates ${l.imitates})` : `${l.host} (disguised as another address)`)).join(', ')}. Never sign in or enter anything there.`,
        unknownLink: (f) => `The message links to ${f.hosts.join(', ')}. Never sign in through a link someone sent you; type the site's address yourself.`,
        scamPhrase: (f) => `Contains a line common in scams: ${quoteList(f.phrases)}.`,
        staffComment: 'The author claims to be Steam or Valve staff. Valve never contacts anyone through comments.',
        confirmReminder,

        // when a check couldn't run
        friendsUnavailable: "Couldn't load your friends list: this account was not compared against your friends.",
        friendsEmpty: 'Your friends list is empty or unreadable: only past trade partners were compared.',
        unidentified: "Trade Guard couldn't identify the other account. Check its SteamID64 manually before accepting.",
        checkFailed: "Trade Guard couldn't check this offer. Review it manually before accepting.",

        // API key
        apiBanner: (s) => `${WARNING} A Steam Web API key is registered on your account${s.domain ? ` (domain: ${s.domain})` : ''}${s.keyTail ? `, ending in …${s.keyTail}` : ''}. If you did NOT create it, a scammer can see and replace your trade offers. Revoke it now and change your password. (The domain is just a label typed by whoever created the key; it doesn't mean that site made it.)`,
        apiKeyUnreadable: "Trade Guard can't read this key, so it can't be marked as trusted. Check it on the API key page.",
        apiUnverified: "Trade Guard hasn't been able to verify your API key for over 24 hours. Check it manually.",
        openKeyPage: 'Open the API key page',
        revoke: 'Revoke now',
        trust: "It's mine, trust this key",
        trustPrompt: (expected) => `NO legitimate site or person will ever ask you to press this button.\n\nOnly continue if YOU created this key (e.g. for your own bot). If unsure, cancel and revoke it.\n\nTo confirm, type exactly: ${expected}`,
        trustMismatch: "That doesn't match. The key was NOT marked as trusted.",

        // reporting
        reportLabel: 'Report this account:',
        reportCopy: 'Copy report',
        reportCopied: 'Report copied',
        reportSteam: 'Steam',
        reportBptf: 'backpack.tf',
        reportHint: (named) => `Each button copies the report. Read it before posting${named ? ': it names the account they copied' : ''}.`,
        reportGuide: 'Trade Guard copied a report for this account. To report it on Steam: open the "…" menu next to the profile buttons, choose "Report Player", then "Attempted Trade Scam" (or impersonation), and paste the report.',
        reportGuideClose: 'Done',

        // signing in through Steam
        loginHead: (host) => (host ? `You're signing in to ${host} with your Steam account.` : "This sign-in doesn't say clearly which site it's for."),
        loginKnown: 'A well-known trading site.',
        loginUnknown: "Trade Guard doesn't know this site. Only continue if you opened it yourself.",
        loginLookalike: (f) => `FAKE SITE: this imitates ${f.imitates}. Close this page and do NOT sign in.`,
        loginMismatch: (f) => `FAKE SIGN-IN: it claims to be ${f.realmHost} but sends you back to a different site. Close this page.`,
        loginAmbiguous: 'FAKE OR BROKEN SIGN-IN: this request could send you to a different site than the one it shows. Close this page.',
        loginTip: 'Steam only tells this site your SteamID. Only type your password on steamcommunity.com, and only when this bar shows your secret phrase.',
        loginNoPhrase: 'Tip: set a secret phrase in the Tampermonkey menu, so you can tell this bar from a fake one.',

        // menu and dialogs
        menuCheckup: 'Security checkup',
        menuPhrase: 'Set secret phrase',
        menuBots: 'Verified bots',
        menuUpdates: 'Check for updates',
        phrasePrompt: "Choose a secret phrase (up to 40 characters). Trade Guard shows it on every warning and on the Steam sign-in page, so a fake panel or a fake login window can't pass for the real one. Keep it out of screenshots you share.\n\nLeave it empty to remove it.",
        phraseSaved: 'Secret phrase saved.',
        close: 'Close',
        botsTitle: 'Verified bots',
        botsHelp: "Paste SteamID64s or profile links from a trading site's OFFICIAL bot list (one per line, a name after each), or a list exported from Trade Guard. Accounts copying these bots are flagged red, even on first contact.",
        botsAdd: 'Add',
        botsAdded: (n) => `${n} bot(s) added.`,
        botsNone: 'No verified bots yet.',
        botsRemove: 'Remove',
        botsExport: 'Copy list as JSON',
        checkupTitle: 'Security checkup',
        checkupApiKey: (s) => (!s ? 'API key: not checked yet.' : s.state === 'key'
            ? `API key: a key IS registered${s.domain ? ` (domain: ${s.domain})` : ''}. Revoke it unless you made it.`
            : 'API key: none registered. Good.'),
        checkupApiNow: 'Check now',
        checkupPhrase: (set) => (set ? 'Secret phrase: set.' : 'Secret phrase: not set. It helps you tell real warnings from fakes.'),
        checkupBots: (n) => `Verified bots: ${n}.`,
        checkupData: (d) => `Stored on this browser: ${d.friends} friend(s), ${d.partners} past partner(s), ${d.profiles} cached profile(s) with their name history and comment warnings.`,
        checkupForget: 'Forget everything',
        forgetConfirm: 'Delete everything Trade Guard has stored in this browser: friends, past partners, caches, trusted keys, verified bots and your secret phrase?\n\nWhen each friend was first seen is kept, so a friend added recently still counts as recent.',
        forgotten: 'Everything was deleted.',
        checkupSecurity: 'Report a vulnerability'
    };

    function findingText(finding) {
        const entry = T[finding.code];
        return typeof entry === 'function' ? entry(finding, T.what(finding)) : entry;
    }

    // A report is public, so a finding goes in only once it has wording here: in the third person, and never
    // saying who the user's friends are. panelText: the panel's own wording already reads that way.
    const panelText = (f) => findingText(f);
    const REPORT_WORDING = {
        impostorFriend: (f, what) => `Uses the same ${what} as another account: "${f.contact.name}" (${f.contact.steamId}).`,
        impostorPartner: (f, what) => `Uses the same ${what} as another account: "${f.contact.name}" (${f.contact.steamId}).`,
        impostorVerifiedBot: (f, what) => `Uses the same ${what} as the trading bot "${f.contact.name}" (${f.contact.steamId}).`,
        mirrorOffer: () => 'Sent an exact copy of an offer the victim had with another account, giving nothing back: the API key scam pattern.',
        mirrorCopy: () => 'Sent an offer identical to one the victim recently had with another account.',
        botWithHold: panelText,
        partnerHold: (f) => `Its items would be held ${f.value} day(s): the account has no Steam Guard Mobile Authenticator.`,
        fakeValueItem: (f) => `Offered an item named or described to look more valuable than it is: ${describeItems(f.items)}.`,
        customizedItems: (f) => `Offered ${f.items.length} item(s) carrying player-written names or descriptions: ${describeItems(f.items)}.`,
        disguisedItem: panelText,
        phishingLink: (f) => `Sent links to fake sites: ${f.links.map((l) => (l.imitates ? `${l.host} (imitates ${l.imitates})` : l.host)).join(', ')}.`,
        unknownLink: (f) => `Sent links to ${f.hosts.join(', ')}.`,
        scamPhrase: panelText,
        staffImpersonation: () => 'Its name claims to be Steam or Valve staff.',
        nameHasSteamId: () => 'Its name contains a SteamID64, to pass for another account.',
        directionTrick: () => 'Its name contains invisible characters that flip how text is displayed.',
        tradeBan: panelText,
        newAccount: panelText,
        newAccountEstimated: panelText,
        recentRename: panelText,
        privateProfile: () => 'Private profile.',
        limited: panelText,
        scamReports: panelText,
        commentsHidden: panelText
    };

    // findings: already sorted by severity
    function reportEvidence(findings) {
        return findings.filter((f) => REPORT_WORDING[f.code]).map((f) => REPORT_WORDING[f.code](f, T.what(f)));
    }

    // the ready-to-paste report: the scammer, who they copied, and what was detected
    function reportText({ scammer, impersonated, evidence, offerId, when }) {
        const profile = (steamId) => `https://steamcommunity.com/profiles/${steamId}`;

        return [
            'Scam attempt report',
            `Scammer: "${scammer.name}" (SteamID64 ${scammer.steamId}) ${profile(scammer.steamId)}`,
            impersonated
                ? `Impersonating: "${impersonated.name}" (SteamID64 ${impersonated.steamId}) ${profile(impersonated.steamId)}`
                : null,
            offerId ? `Trade offer: ${offerId}` : null,
            `Date: ${when.toISOString().slice(0, 10)}`,
            '',
            'What was detected:',
            ...evidence.map((line) => `- ${line}`),
            '',
            'Detected with TF2 Trade Guard: https://github.com/dns144444-del/tf2-trade-guard'
        ].filter((line) => line !== null).join('\n');
    }

    return { T, findingText, reportEvidence, reportText };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Core, Page, Strings };
} else {
    runUserscript();
}

// The browser layer: storage, same-origin requests to Steam, and everything drawn on the page. It reads in
// order: limits and storage, Steam requests, contacts, items, UI helpers, guards, menu, startup.
function runUserscript() {
    const { T, findingText } = Strings;

    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const MAX_PROFILES_CACHED = 300;
    const MAX_PARTNERS_REMEMBERED = 500;
    const MAX_ITEMS_CHECKED = 40;
    const REPO_URL = 'https://github.com/dns144444-del/tf2-trade-guard';
    const SHIELD = String.fromCodePoint(0x1F6E1, 0xFE0F);

    const log = (...args) => console.log('[TF2 Trade Guard]', ...args);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Storage

    // Every key Trade Guard stores, and what reading it gives when nothing is stored. 'account' keys are kept
    // per Steam account, so alts on one browser never mix; `keep` survives Forget everything.
    const KEYS = {
        apikey: { scope: 'account', empty: null },
        trustedKeys: { scope: 'account', empty: [] },
        friends: { scope: 'account', empty: null },
        friendsSeen: { scope: 'account', empty: null, keep: true },
        partners: { scope: 'account', empty: {} },
        profiles: { scope: 'browser', empty: {} },
        aliases: { scope: 'browser', empty: {} },
        commentWalls: { scope: 'browser', empty: {} },
        idAnchors: { scope: 'browser', empty: [] },
        verifiedBots: { scope: 'browser', empty: [] },
        pendingReport: { scope: 'browser', empty: null },
        secretPhrase: { scope: 'browser', empty: '', text: true }
    };

    let accountScope = null; // the signed-in SteamID, set by main()

    function storageKey(key) {
        const spec = KEYS[key];
        if (!spec) throw new Error(`unknown storage key: ${key}`);
        if (spec.scope === 'browser') return key;

        // signed out, an account key would be shared by every account on this browser
        if (!accountScope) throw new Error(`${key} needs a signed-in account`);
        return `${accountScope}:${key}`;
    }

    const store = {
        get(key) {
            // a fresh copy, so a caller that edits the empty value can't change it for the next one
            const empty = () => JSON.parse(JSON.stringify(KEYS[key].empty));
            const value = GM_getValue(storageKey(key), undefined);
            if (value === undefined) return empty();

            // 0.1.0 stored JSON strings
            if (KEYS[key].text || typeof value !== 'string') return value;

            try {
                return JSON.parse(value);
            } catch {
                return empty();
            }
        },
        set: (key, value) => GM_setValue(storageKey(key), value),
        remove: (key) => GM_deleteValue(storageKey(key))
    };

    const secretPhrase = () => store.get('secretPhrase');
    const verifiedBots = () => store.get('verifiedBots');

    // Keeps when each friend was first seen: otherwise a scammer added last week would count as a
    // long-standing friend after a reset, and "your Trade Guard is broken, reset it" is an easy ask.
    function forgetAll() {
        for (const key of GM_listValues()) {
            const spec = KEYS[key.split(':').pop()];
            if (!(spec && spec.keep)) GM_deleteValue(key);
        }
    }

    function storedCounts() {
        const friends = store.get('friends');
        const count = (key) => Object.keys(store.get(key)).length;

        return {
            friends: friends && Array.isArray(friends.list) ? friends.list.length : 0,
            partners: count('partners'),
            profiles: count('profiles')
        };
    }

    // Steam requests (same origin only)

    function pageScriptsText() {
        return [...document.querySelectorAll('script:not([src])')].map((s) => s.textContent).join('\n');
    }

    async function getText(path) {
        const response = await fetch(path, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);

        return { text: await response.text(), url: response.url };
    }

    const parseHtml = (text) => new DOMParser().parseFromString(text, 'text/html');

    async function sha256(text) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function keepNewest(cache, max) {
        return Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, max));
    }

    // a cached profile, name history or comment wall as { value, fetchedAt }, or null
    function cachedEntry(key, steamId) {
        const hit = store.get(key)[steamId];
        return hit && 'value' in hit ? hit : null;
    }

    // profiles, name histories and comment walls: cached per account for 6 hours, newest 300 kept
    async function cachedPerProfile(key, steamId, load) {
        const hit = cachedEntry(key, steamId);
        if (hit && Date.now() - hit.fetchedAt < 6 * HOUR) return hit.value;

        const value = await load();
        const cache = store.get(key);
        cache[steamId] = { value, fetchedAt: Date.now() };
        store.set(key, keepNewest(cache, MAX_PROFILES_CACHED));

        return value;
    }

    function getProfile(steamId) {
        return cachedPerProfile('profiles', steamId, async () => {
            const profile = Core.parseProfileXml((await getText(`/profiles/${steamId}/?xml=1&l=english`)).text);
            if (!profile) throw new Error(`unreadable profile ${steamId}`);

            learnAgeAnchor(profile);
            return profile;
        });
    }

    // the name an account had when last checked, to say which account an offer was copied from
    const knownName = (steamId) => cachedEntry('profiles', steamId)?.value.name || '';

    // every public profile with a full creation date sharpens the SteamID -> age estimate, locally
    function learnAgeAnchor(profile) {
        const time = Core.memberSinceTime(profile.memberSince);
        if (time === null) return;

        const accountId = Core.steamId64ToAccountId(profile.steamId);
        const anchors = store.get('idAnchors').filter(([id]) => id !== accountId);

        anchors.push([accountId, time]);
        store.set('idAnchors', anchors.slice(-MAX_PROFILES_CACHED));
    }

    // the "previous names" list on Steam profiles
    function getAliases(steamId) {
        return cachedPerProfile('aliases', steamId, async () => {
            const data = JSON.parse((await getText(`/profiles/${steamId}/ajaxaliases/?l=english`)).text);

            return (Array.isArray(data) ? data : [])
                .filter((alias) => alias && typeof alias.newname === 'string')
                .slice(0, 10)
                .map((alias) => ({ newname: alias.newname, timechanged: String(alias.timechanged || '') }));
        });
    }

    // only the summary is stored: whether the comments are hidden, and other people's warnings
    function getCommentWall(steamId) {
        return cachedPerProfile('commentWalls', steamId, async () => {
            const { text } = await getText(`/profiles/${steamId}/allcomments?l=english`);
            return Core.scamReports(Page.commentWall(parseHtml(text)), steamId);
        });
    }

    // everything read about a partner, as Core.assessPartner takes it; what couldn't be read goes in `unavailable`
    async function gatherPartner(steamId, avatarSrc) {
        const unavailable = [];
        const optional = async (what, load) => {
            try {
                return await load();
            } catch (error) {
                log(`${what} unavailable`, steamId, error);
                unavailable.push(what);
                return null;
            }
        };

        const profile = await optional('profile', () => getProfile(steamId));
        if (!profile) {
            return { profile: Core.fallbackProfile(steamId, avatarSrc), loaded: false, evidence: { unavailable } };
        }

        const [aliases, commentWall] = await Promise.all([
            optional('aliases', () => getAliases(steamId)),
            optional('commentWall', () => getCommentWall(steamId))
        ]);

        return { profile, loaded: true, evidence: { aliases, commentWall, unavailable } };
    }

    // History still lists offers canceled seconds after arriving, which the user may never have seen:
    // exactly the offers an API key scam replaces. Read fresh on every page load for that reason.
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
                const listed = Page.parseOfferList(parseHtml(text), isSent, selfId).slice(0, 30);
                offers.push(...listed.map(({ el, ...offer }) => offer));
                loaded += 1;
            } catch (error) {
                log('could not load offers from', path, error);
            }
        }

        return { offers, complete: loaded === sources.length };
    }

    // Contacts: everyone the partner could be impersonating

    // bump when Page.friendName() changes, so lists parsed the old way are fetched again
    const FRIENDS_PARSER_VERSION = 2;

    async function getFriends() {
        const cached = store.get('friends');
        const fresh = cached && cached.parser === FRIENDS_PARSER_VERSION && Date.now() - cached.fetchedAt < 6 * HOUR;
        if (fresh) return cached.list;

        const list = Page.parseFriends(parseHtml((await getText('/my/friends/')).text));

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

        const partners = Object.entries(store.get('partners'))
            .map(([steamId, p]) => ({ steamId, name: p.name, avatarHash: p.avatarHash }));
        const contacts = Core.mergeContacts({ friends: markRecentFriends(friends), partners, bots: verifiedBots() });

        return { contacts, friendsStatus };
    }

    // The first friends list ever seen is the baseline, so only friends added after Trade Guard was
    // installed can count as recent.
    function markRecentFriends(friends) {
        if (!friends.length) return friends;

        const now = Date.now();
        const seen = store.get('friendsSeen');

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
            return { ...friend, recent: firstSeen > seen.baselineAt && now - firstSeen < 30 * DAY };
        });
    }

    function rememberPartner(profile) {
        const partners = store.get('partners');
        partners[profile.steamId] = { name: profile.name, avatarHash: profile.avatarHash, seenAt: Date.now() };

        const kept = Object.entries(partners)
            .filter(([, p]) => Date.now() - p.seenAt < 90 * DAY)
            .sort((a, b) => b[1].seenAt - a[1].seenAt)
            .slice(0, MAX_PARTNERS_REMEMBERED);

        store.set('partners', Object.fromEntries(kept));
    }

    // Items the user would receive

    const itemDescriptions = new Map(); // per page load: economy key -> Promise<description | null>

    function describeOfferItem(key) {
        if (!itemDescriptions.has(key)) {
            const item = Page.economyItem(key);
            const path = item && `/economy/itemclasshover/${item.appid}/${item.classid}/${item.instanceid}?content_only=1&l=english`;

            itemDescriptions.set(key, !item ? Promise.resolve(null) : getText(path).then(
                ({ text }) => Core.parseItemHover(text),
                (error) => {
                    log('item lookup failed', key, error);
                    return null;
                }
            ));
        }

        return itemDescriptions.get(key);
    }

    // keys: the data-economy-item values of what the user would receive
    async function offerItemFindings(keys) {
        const unique = [...new Set(keys)];
        const items = [];

        for (const key of unique.slice(0, MAX_ITEMS_CHECKED)) {
            // spaced out so a long offer list doesn't hit Steam's rate limit
            if (!itemDescriptions.has(key)) await sleep(100);
            const item = Page.economyItem(key);
            items.push({ appid: item ? item.appid : null, description: await describeOfferItem(key) });
        }

        return Core.receivedItemFindings(items, { truncated: unique.length > MAX_ITEMS_CHECKED });
    }

    // One load per game, shared by every item from it. A failed load is kept for a minute, so a private
    // inventory isn't requested again for each item the partner adds.
    const partnerInventories = new Map(); // `${appid}_${contextid}` -> { load, failedAt }

    function getPartnerInventory(partnerId, appid, contextid) {
        const key = `${appid}_${contextid}`;
        const cached = partnerInventories.get(key);
        if (cached && !(cached.failedAt && Date.now() - cached.failedAt > MINUTE)) return cached.load;

        const entry = { load: loadPartnerInventory(partnerId, appid, contextid), failedAt: 0 };
        entry.load.catch((error) => {
            entry.failedAt = Date.now();
            log('partner inventory unavailable', key, error);
        });
        partnerInventories.set(key, entry);

        return entry.load;
    }

    async function loadPartnerInventory(partnerId, appid, contextid) {
        const byAsset = new Map();
        let start = '';

        for (let page = 0; page < 5; page++) {
            const path = `/inventory/${partnerId}/${appid}/${contextid}?l=english&count=2000`;
            const data = JSON.parse((await getText(start ? `${path}&start_assetid=${start}` : path)).text);
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
        const slots = Page.theirTradeItems(document);
        if (!slots.length) return [];

        const items = await Promise.all(slots.map(async (slot) => {
            if (!slot) return { appid: null, description: null };

            try {
                const inventory = await getPartnerInventory(partnerId, slot.appid, slot.contextid);
                return { appid: slot.appid, description: inventory.get(slot.assetid) || null };
            } catch {
                return { appid: slot.appid, description: null };
            }
        }));

        return Core.receivedItemFindings(items);
    }

    // UI helpers

    // Strings become text nodes, so text from Steam can never inject markup; empty parts are skipped.
    function fill(node, ...children) {
        const parts = children.flat().filter((child) => child !== null && child !== undefined && child !== false);
        node.replaceChildren(...parts);
        return node;
    }

    function h(tag, props = {}, ...children) {
        const node = document.createElement(tag);

        for (const [key, value] of Object.entries(props)) {
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value);
        }

        // replaceChildren() with nothing would wipe a `text` prop
        return children.length ? fill(node, ...children) : node;
    }

    function button(label, onclick, { small = false } = {}) {
        return h('button', { class: small ? 'tg-btn tg-btn-small' : 'tg-btn', type: 'button', text: label, onclick });
    }

    function externalLink(href, text) {
        return h('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
    }

    function openTab(url) {
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    // "Trade Guard" and the user's secret phrase, on everything Trade Guard draws: a fake panel in an
    // offer message, or a fake login window on a phishing site, can't know the phrase.
    function brand() {
        const phrase = secretPhrase();
        return h('span', { class: 'tg-brand' },
            h('strong', { text: `${SHIELD} Trade Guard` }),
            phrase ? h('span', { class: 'tg-phrase', text: phrase }) : null
        );
    }

    function setPanelLevel(panel, level) {
        panel.classList.remove('tg-ok', 'tg-warning', 'tg-danger');
        panel.classList.add(`tg-${level}`);
    }

    // shown instead of a verdict whenever a check couldn't run, so silence never looks like "all clear"
    function renderNotice(panel, code) {
        setPanelLevel(panel, 'warning');
        fill(panel,
            h('div', { class: 'tg-head' }, brand(), ' · ', T.verdict.warning),
            h('ul', {}, h('li', { class: 'tg-warning', text: T[code] }))
        );
    }

    function findingItems(findings, max = Infinity) {
        return Core.sortBySeverity(findings)
            .slice(0, max)
            .map((finding) => h('li', { class: `tg-${finding.level}`, text: findingText(finding) }));
    }

    function randomHex(bytes) {
        return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Each button copies a ready-to-paste report first; the user pastes and sends it. The Steam button
    // leaves a one-time nonce, so only this click can show the guide on the scammer's profile.
    function reportRow(assessment) {
        const { profile, findings, offerId } = assessment;
        const impersonation = findings.find((f) => f.impersonates);
        const text = Strings.reportText({
            scammer: { steamId: profile.steamId, name: profile.name },
            impersonated: impersonation ? impersonation.contact : null,
            evidence: Strings.reportEvidence(Core.sortBySeverity(findings)),
            offerId: offerId || null,
            when: new Date()
        });
        const copy = () => GM_setClipboard(text, 'text');

        const copyButton = button(T.reportCopy, () => {
            copy();
            copyButton.textContent = T.reportCopied;
        }, { small: true });

        const reportOnSteam = () => {
            copy();
            const nonce = randomHex(16);
            store.set('pendingReport', { steamId: profile.steamId, nonce, at: Date.now() });
            openTab(`https://steamcommunity.com/profiles/${profile.steamId}/#tradeguard-report-${nonce}`);
        };

        return h('div', { class: 'tg-report' },
            h('span', { text: T.reportLabel }),
            copyButton,
            button(T.reportSteam, reportOnSteam, { small: true }),
            button(T.reportBptf, () => {
                copy();
                openTab('https://backpack.tf/issues');
            }, { small: true }),
            h('span', { class: 'tg-report-hint', text: T.reportHint(Boolean(impersonation)) })
        );
    }

    // assessment: { profile, findings, ageDays, ageEstimated, offerId }; footer: lines under the findings
    function renderPanel(panel, assessment, footer = []) {
        const { profile, findings, ageDays, ageEstimated } = assessment;
        const level = Core.worstLevel(findings);
        const id = profile.steamId;

        setPanelLevel(panel, level);
        panel.dataset.level = level;
        fill(panel,
            h('div', { class: 'tg-head' }, brand(), ' · ', h('span', { class: 'tg-verdict', text: T.verdict[level] })),
            // the real SteamID64 comes first and the name is quoted, so a name that imitates this line
            // ("Kiro · SteamID64: 7656...") can't pass for it
            h('div', { class: 'tg-info' },
                `${T.steamId}: `,
                h('code', { text: id }),
                profile.name ? ' · ' : null,
                profile.name ? h('span', { class: 'tg-name', text: `"${profile.name}"` }) : null,
                ageDays !== null ? ` · ${T.age(ageDays, ageEstimated)}` : null,
                ' · ',
                externalLink(`https://rep.tf/${id}`, 'rep.tf'),
                ' · ',
                externalLink(`https://backpack.tf/profiles/${id}`, 'backpack.tf')
            ),
            findings.length ? h('ul', {}, findingItems(findings, 6)) : null,
            footer,
            level === 'danger' ? reportRow(assessment) : null
        );
    }

    let stylesInjected = false;

    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;

        GM_addStyle(`
            #tg-api-banner, #tg-report-guide { position: sticky; top: 0; z-index: 99999; display: flex; flex-wrap: wrap;
                gap: 10px; align-items: center; padding: 12px 16px; background: #b3261e; color: #fff;
                font: 600 14px/1.4 "Motiva Sans", Arial, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.5); }
            #tg-api-banner.tg-unverified { background: #7a5c00; }
            #tg-report-guide { background: #1a4f7a; }
            #tg-api-banner .tg-banner-text, #tg-report-guide .tg-banner-text { flex: 1 1 400px; }
            .tg-phrase { margin-left: 6px; padding: 0 6px; border-radius: 3px; background: #2a475e; color: #fff;
                font-weight: 600; }
            .tg-btn { padding: 6px 12px; border: 1px solid rgba(255,255,255,.7); border-radius: 3px;
                background: transparent; color: #fff !important; font: inherit; cursor: pointer;
                text-decoration: none !important; }
            .tg-btn-small { padding: 2px 8px; font-size: 12px; }
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
            .tg-confirm { margin-top: 4px; color: #c6d4df; font-style: italic; }
            .tg-report { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
            .tg-report-hint { color: #8f98a0; font-size: 12px; }
            .tg-comment { margin: 4px 0; padding: 4px 8px; border-left: 3px solid #e0a800; background: rgba(0,0,0,.35);
                color: #ffd54f; font: 12px/1.4 "Motiva Sans", Arial, sans-serif; }
            .tg-comment.tg-danger { border-left-color: #e53935; color: #ff8a80; background: rgba(120,20,20,.45); }
            #tg-login-banner { position: relative; z-index: 99999; padding: 12px 16px; color: #fff;
                font: 14px/1.5 "Motiva Sans", Arial, sans-serif; border-bottom: 4px solid #5c9e31; background: #1e3a14; }
            #tg-login-banner.tg-warning { border-bottom-color: #e0a800; background: #4a3c00; }
            #tg-login-banner.tg-danger { border-bottom-color: #e53935; background: #6b1414; }
            #tg-login-banner .tg-login-host { font-size: 18px; font-weight: 600; margin: 4px 0; }
            #tg-login-banner .tg-login-tip { color: #d0d8e0; font-size: 12px; margin-top: 4px; }
            #tg-dialog { position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center;
                justify-content: center; background: rgba(0,0,0,.6); }
            .tg-dialog-box { width: min(560px, calc(100vw - 32px)); max-height: 80vh; overflow: auto; padding: 16px;
                border-radius: 4px; background: #1b2838; color: #c6d4df; font: 13px/1.5 "Motiva Sans", Arial, sans-serif;
                box-shadow: 0 8px 24px rgba(0,0,0,.6); }
            .tg-dialog-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
            .tg-textarea { width: 100%; box-sizing: border-box; background: #0e1720; color: #fff;
                border: 1px solid #3a5268; }
            .tg-bot-list, .tg-checkup { padding-left: 18px; }
            .tg-dialog-box a { color: #66c0f4; }
        `);
    }

    // Guard: the API key

    // our own banner is already on the page, and its text must never be parsed as Steam's
    function pageHtmlWithoutOwnUi() {
        const copy = document.documentElement.cloneNode(true);
        copy.querySelectorAll('#tg-api-banner, #tg-report-guide, #tg-login-banner, #tg-dialog, .tg-panel')
            .forEach((node) => node.remove());

        return copy.outerHTML;
    }

    // maxAge: how old a stored answer may be; the key page itself is always read from the screen
    async function checkApiKey(maxAge) {
        const previous = store.get('apikey');
        const onKeyPage = location.pathname.startsWith('/dev/apikey');

        if (!onKeyPage && previous && Date.now() - previous.checkedAt < maxAge) return previous;

        const page = onKeyPage ? { text: pageHtmlWithoutOwnUi(), url: location.href } : await getText('/dev/apikey');
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

    // after a check: no status, or one over a day old, means checks keep failing, and silence would read as "no key"
    function showCheckedApiBanner(status) {
        if (status && Date.now() - status.checkedAt <= DAY) {
            showApiBanner(status);
            return;
        }

        document.getElementById('tg-api-banner')?.remove();
        document.body.prepend(h('div', { id: 'tg-api-banner', class: 'tg-unverified' },
            h('span', { class: 'tg-banner-text' }, brand(), ' ', T.apiUnverified),
            h('a', { class: 'tg-btn', href: 'https://steamcommunity.com/dev/apikey', text: T.openKeyPage })
        ));
    }

    function showApiBanner(status) {
        document.getElementById('tg-api-banner')?.remove();

        if (!status || status.state !== 'key') return;
        if (store.get('trustedKeys').includes(status.fingerprint)) return;

        const revoke = h('a', { class: 'tg-btn tg-btn-danger', href: 'https://steamcommunity.com/dev/apikey', text: T.revoke });

        if (location.pathname.startsWith('/dev/apikey')) {
            revoke.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelector('form[action*="revokekey"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }

        // typing it out forces a deliberate decision a phishing page can't click through
        const trust = button(T.trust, () => {
            const expected = status.domain || status.keyTail || 'CONFIRM';
            const typed = prompt(T.trustPrompt(expected));
            if (typed === null) return;

            if (typed.trim().toLowerCase() !== expected.toLowerCase()) {
                alert(T.trustMismatch);
                return;
            }

            store.set('trustedKeys', [...store.get('trustedKeys'), status.fingerprint]);
            document.getElementById('tg-api-banner')?.remove();
        });

        // without the key itself, a "trusted" fingerprint could only be its domain, which anyone can reuse
        const canTrust = Boolean(status.keyTail);

        document.body.prepend(h('div', { id: 'tg-api-banner' },
            h('span', { class: 'tg-banner-text' }, brand(), ' ', T.apiBanner(status) + (canTrust ? '' : ` ${T.apiKeyUnreadable}`)),
            revoke,
            canTrust ? trust : null
        ));
    }

    function watchApiKey() {
        const path = location.pathname;
        const busyPage = /\/tradeoffers?(\/|$)/.test(path) || path.startsWith('/dev/apikey');

        showApiBanner(store.get('apikey'));
        checkApiKey(busyPage ? 2 * MINUTE : 15 * MINUTE)
            .then(showCheckedApiBanner)
            .catch((error) => {
                log('API key check failed', error);
                showCheckedApiBanner(store.get('apikey'));
            });
    }

    // Guard: partners in offers and the trade window

    // Assesses a partner for its panel. extra: findings about the offer itself; evidence: what the page knows
    // about the partner, such as the trade hold. Returns what renderPanel draws.
    async function checkPartner(partnerRef, contacts, selfId, options = {}) {
        const { extra = [], evidence = {}, offerId = null } = options;
        const partner = await gatherPartner(partnerRef.steamId, partnerRef.avatarSrc);
        const { findings, ageDays, ageEstimated } = Core.assessPartner(partner.profile, contacts, {
            selfId,
            anchors: store.get('idAnchors'),
            ...partner.evidence,
            ...evidence,
            unavailable: partner.evidence.unavailable.concat(evidence.unavailable || [])
        });

        if (partner.loaded) rememberPartner(partner.profile);

        const { profile, loaded } = partner;
        return { profile, loaded, findings: findings.concat(extra), ageDays, ageEstimated, offerId };
    }

    // /id/<name>/tradeoffers/ and /tradeoffers/sent/ (plus their ?history=1 views)
    async function guardOfferList({ isSent, isHistory }, selfId) {
        const offers = Page.parseOfferList(document, isSent, selfId);
        if (!offers.length) return;

        const { contacts, friendsStatus } = await buildContacts();

        // copies only matter for offers you can still accept, and history would flag the originals
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

                const extra = [
                    ...Core.friendsFindings(friendsStatus),
                    ...Core.giftFinding(offer.give.length, offer.get.length),
                    ...Core.offerFindings(offer, {
                        isSent,
                        recent,
                        siblings: offers,
                        nameOf: knownName,
                        // even an offer you sent may include a fake item you picked from their inventory
                        items: isHistory ? [] : await offerItemFindings(offer.get)
                    })
                ];

                const assessment = await checkPartner(
                    { steamId: offer.partnerId, avatarSrc: offer.partnerAvatar }, contacts, selfId,
                    { extra, offerId: offer.offerId }
                );
                renderPanel(panel, assessment);

                // later offers in this same list are compared against this partner too
                if (!contacts.some((c) => c.steamId === offer.partnerId)) {
                    contacts.push(...Core.mergeContacts({ partners: [assessment.profile] }));
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
            incoming = Page.parseOfferList(parseHtml(text), false, selfId);
        } catch (error) {
            log('incoming offers unavailable', error);
            return Core.unreadableOfferFindings();
        }

        const offer = incoming.find((o) => o.offerId === offerId);

        // not an incoming offer (e.g. one you sent), nothing to compare
        if (!offer) return [];

        return Core.offerFindings(offer, {
            recent: await getRecentOffers(selfId),
            siblings: incoming,
            nameOf: knownName,
            items: await offerItemFindings(offer.get)
        });
    }

    // /tradeoffer/new/ and /tradeoffer/<id>/
    async function guardTradeWindow({ offerId }, selfId) {
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

        const assessment = await assessTradePartner(selfId, partnerId, offerId).catch((error) => {
            log('trade window check failed', error);
            renderNotice(panel, 'checkFailed');
            return null;
        });

        if (assessment) watchTradeWindow(panel, partnerId, assessment);
    }

    async function assessTradePartner(selfId, partnerId, offerId) {
        const { contacts, friendsStatus } = await buildContacts();
        const extra = Core.friendsFindings(friendsStatus);

        // a received offer opened directly (e.g. from a notification) gets the same checks as the list
        if (offerId) extra.push(...await receivedOfferFindings(selfId, offerId));

        // an unreadable hold is said out loud: the hold is how a bot without a mobile authenticator shows itself
        const escrow = Page.escrowDays(pageScriptsText());

        return checkPartner({ steamId: partnerId, avatarSrc: null }, contacts, selfId, {
            extra,
            offerId,
            evidence: escrow ? { escrow } : { unavailable: ['escrow'] }
        });
    }

    // Item counts and the partner's items change while an offer is being built, so the panel is redrawn from
    // the partner's findings plus what the offer holds right now.
    function watchTradeWindow(panel, partnerId, assessment) {
        const { profile, loaded, ageDays, ageEstimated, offerId } = assessment;

        // the last step happens in the Steam app or an email, where only the name and account age show
        const age = ageDays !== null ? T.ageShort(ageDays, ageEstimated) : null;
        const reminder = T.confirmReminder(loaded ? profile.name : '', age);

        let counts = { give: 0, get: 0 };
        let itemFindings = [];
        let drawn = '';

        const redraw = () => {
            const live = [...Core.giftFinding(counts.give, counts.get), ...itemFindings];

            // mutations fire for every item moved, so only a real change redraws (and resets the report buttons)
            const state = JSON.stringify([counts, live]);
            if (state === drawn) return;
            drawn = state;

            renderPanel(panel, { ...assessment, findings: assessment.findings.concat(live) }, [
                h('div', { class: 'tg-counts', text: T.counts(counts.give, counts.get) }),
                h('div', { class: 'tg-confirm', text: reminder })
            ]);
        };

        // a received offer's items were already checked from the offer list
        const buildingOffer = !offerId;
        let itemCheck = 0;
        let theirItems = '';

        const updateItems = async () => {
            const ticket = ++itemCheck;
            const found = await tradeWindowItemFindings(partnerId);
            if (ticket !== itemCheck) return; // a newer change already started another check

            itemFindings = found;
            redraw();
        };

        const updateCounts = () => {
            counts = {
                give: document.querySelectorAll('#your_slots .item').length,
                get: document.querySelectorAll('#their_slots .item').length
            };
            redraw();

            const current = [...document.querySelectorAll('#their_slots .item')].map((el) => el.id).join(',');
            if (buildingOffer && current !== theirItems) {
                theirItems = current;
                updateItems().catch((error) => log('item check failed', error));
            }
        };

        updateCounts();

        // react to items being added or removed instead of polling
        const slots = ['#your_slots', '#their_slots'].map((selector) => document.querySelector(selector)).filter(Boolean);

        if (slots.length !== 2) {
            setInterval(updateCounts, 1500);
            return;
        }

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
    }

    // Guard: comments (profiles, groups, workshop)

    // only suspicious comments get a note
    function checkComment(comment) {
        comment.dataset.tgChecked = '1';

        const parts = Page.commentParts(comment);
        if (!parts) return;

        const findings = Core.commentFindings(parts);
        if (!findings.length) return;

        const level = Core.worstLevel(findings);
        parts.textEl.after(h('div', { class: `tg-comment tg-${level}` },
            brand(),
            ': ',
            Core.sortBySeverity(findings).map(findingText).join(' ')
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

    // Guard: signing in through Steam, and the report guide

    // request: { realm, returnTo, ambiguous } as Page.route reads it
    function guardLogin(request) {
        const check = Core.loginCheck(request);
        if (!check) return;

        document.body.prepend(h('div', { id: 'tg-login-banner', class: `tg-${check.level}` },
            h('div', { class: 'tg-head' }, brand()),
            h('div', { class: 'tg-login-host', text: T.loginHead(check.host) }),
            h('div', { class: 'tg-login-verdict', text: findingText(check) }),
            h('div', { class: 'tg-login-tip', text: T.loginTip }),
            secretPhrase() ? null : h('div', { class: 'tg-login-tip', text: T.loginNoPhrase })
        ));
    }

    // Steam has no direct link to its report form, so the profile a report button opened explains the clicks.
    // An address anyone can send must not make Trade Guard vouch for anything, hence the nonce.
    function showReportGuide({ steamId, nonce }) {
        const pending = store.get('pendingReport');
        const answered = pending && pending.nonce === nonce && pending.steamId === steamId;
        if (!answered || Date.now() - pending.at > 2 * MINUTE) return;

        store.remove('pendingReport');

        const guide = h('div', { id: 'tg-report-guide' },
            h('span', { class: 'tg-banner-text' }, brand(), ' ', T.reportGuide),
            button(T.reportGuideClose, () => {
                guide.remove();
                history.replaceState(null, '', location.pathname + location.search);
            })
        );

        document.body.prepend(guide);
    }

    // Menu: secret phrase, verified bots, security checkup

    function closeDialog() {
        document.getElementById('tg-dialog')?.remove();
    }

    function showDialog(title, ...content) {
        // the menu also works on signed-out pages, where nothing else has added the styles
        injectStyles();
        closeDialog();

        const dialog = h('div', {
            id: 'tg-dialog',
            onclick: (event) => {
                if (event.target === dialog) closeDialog();
            }
        }, h('div', { class: 'tg-dialog-box', role: 'dialog' },
            h('div', { class: 'tg-head' }, brand(), ` · ${title}`),
            ...content,
            h('div', { class: 'tg-dialog-actions' }, button(T.close, closeDialog))
        ));

        document.body.append(dialog);
    }

    function setSecretPhrase() {
        const value = prompt(T.phrasePrompt, secretPhrase());
        if (value === null) return;

        store.set('secretPhrase', Core.cleanPhrase(value));

        // everything already drawn shows the new phrase, or loses the old one, right away
        document.querySelectorAll('.tg-brand').forEach((node) => node.replaceWith(brand()));
        alert(T.phraseSaved);
    }

    function showVerifiedBots() {
        const list = h('ul', { class: 'tg-bot-list' });
        const input = h('textarea', { class: 'tg-textarea', rows: '5', placeholder: '76561198... STN Trading Bot #1' });
        const status = h('div', { class: 'tg-dialog-status' });

        const render = () => {
            const bots = verifiedBots();

            fill(list, bots.length ? bots.map((bot) => h('li', {},
                h('code', { text: bot.steamId }),
                bot.name ? ` "${bot.name}" ` : ' ',
                button(T.botsRemove, () => {
                    store.set('verifiedBots', verifiedBots().filter((b) => b.steamId !== bot.steamId));
                    render();
                }, { small: true })
            )) : h('li', { text: T.botsNone }));
        };

        const add = () => {
            const { list: merged, added } = Core.mergeBotList(verifiedBots(), input.value, Date.now());
            store.set('verifiedBots', merged);
            status.textContent = T.botsAdded(added);
            input.value = '';
            render();
        };

        const exportList = () => {
            const bots = verifiedBots().map(({ steamId, name }) => ({ steamId, name }));
            GM_setClipboard(JSON.stringify({ bots }, null, 2), 'text');
        };

        render();
        showDialog(T.botsTitle,
            h('p', { text: T.botsHelp }),
            input,
            h('div', { class: 'tg-dialog-actions' }, button(T.botsAdd, add), button(T.botsExport, exportList)),
            status,
            list
        );
    }

    function showCheckup() {
        const apiLine = h('li', { text: T.checkupApiKey(store.get('apikey')) });
        apiLine.append(' ', button(T.checkupApiNow, async () => {
            try {
                const status = await checkApiKey(0);
                apiLine.firstChild.textContent = T.checkupApiKey(status);
                showCheckedApiBanner(status);
            } catch (error) {
                log('API key check failed', error);
            }
        }, { small: true }));

        const checkupLine = (text, label, action) => h('li', {}, text, ' ', button(label, action, { small: true }));

        const forget = () => {
            if (!confirm(T.forgetConfirm)) return;

            forgetAll();
            document.getElementById('tg-api-banner')?.remove();
            closeDialog();
            alert(T.forgotten);
        };

        showDialog(T.checkupTitle,
            h('ul', { class: 'tg-checkup' },
                apiLine,
                checkupLine(T.checkupPhrase(Boolean(secretPhrase())), T.menuPhrase, setSecretPhrase),
                checkupLine(T.checkupBots(verifiedBots().length), T.menuBots, showVerifiedBots),
                checkupLine(T.checkupData(storedCounts()), T.checkupForget, forget)
            ),
            h('p', {},
                externalLink(`${REPO_URL}/security/policy`, T.checkupSecurity),
                ' · ',
                externalLink(`${REPO_URL}/releases/latest`, T.menuUpdates)
            )
        );
    }

    function registerMenu(signedIn) {
        if (typeof GM_registerMenuCommand !== 'function') return;

        if (signedIn) GM_registerMenuCommand(T.menuCheckup, showCheckup);
        GM_registerMenuCommand(T.menuPhrase, setSecretPhrase);
        GM_registerMenuCommand(T.menuBots, showVerifiedBots);
        GM_registerMenuCommand(T.menuUpdates, () => openTab(`${REPO_URL}/releases/latest`));
    }

    // Startup

    // signedOut: the guard runs without a Steam session too; the password form is where phishing wants you
    const GUARDS = {
        login: { signedOut: true, run: guardLogin },
        offerList: { run: guardOfferList },
        tradeWindow: { run: guardTradeWindow },
        reportGuide: { run: showReportGuide },
        other: { run: () => {} }
    };

    async function main() {
        const page = Page.route(location.pathname, location.search, location.hash);
        const selfId = Page.selfSteamId(pageScriptsText());
        const guard = GUARDS[page.kind];

        accountScope = selfId;
        registerMenu(Boolean(selfId));
        if (!selfId && !guard.signedOut) return;

        injectStyles();

        if (selfId) {
            watchApiKey();
            if (Page.wantsCommentCheck(location.pathname)) guardComments();
        }

        await guard.run(page, selfId);
    }

    main().catch((error) => log('error', error));
}
