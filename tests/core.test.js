'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Core } = require('../tf2-trade-guard.user.js');

const NOW = new Date('2026-10-29T12:00:00Z');
const AVATAR_A = 'https://avatars.fastly.steamstatic.com/0123456789abcdef0123456789abcdef01234567_full.jpg';
const AVATAR_B = 'https://avatars.fastly.steamstatic.com/89abcdef0123456789abcdef0123456789abcdef_medium.jpg';
const AVATAR_DEFAULT = 'https://avatars.fastly.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';

test('converts 32-bit account IDs to SteamID64', () => {
    assert.equal(Core.accountIdToSteamId64(1), '76561197960265729');
    assert.equal(Core.accountIdToSteamId64('123456789'), '76561198083722517');
});

test('compareNames: exact copies are identical', () => {
    assert.equal(Core.compareNames('Mann Co. Bot', 'Mann Co. Bot'), 'identical');
});

test('compareNames: homoglyph and invisible-character tricks are lookalikes', () => {
    assert.equal(Core.compareNames('Mann Co. Bot', 'M\u0430nn Co. Bot'), 'lookalike'); // Cyrillic \u0430
    assert.equal(Core.compareNames('scrapbanking', 'scrap\u200Bbanking'), 'lookalike'); // zero-width space
    assert.equal(Core.compareNames('Iarry', 'larry'), 'lookalike'); // capital i vs lowercase L
    assert.equal(Core.compareNames('B0B', 'bob'), 'lookalike');
    assert.equal(Core.compareNames('modern', 'modem'), 'lookalike'); // rn vs m
    assert.equal(Core.compareNames('Caf\u00E9', 'Cafe'), 'lookalike');
});

test('compareNames: more homoglyph families are lookalikes', () => {
    assert.equal(Core.compareNames('Bob', 'B\u0585b'), 'lookalike'); // Armenian \u0585
    assert.equal(Core.compareNames('Mann Co', '\u1D0D\u1D00\u0274\u0274 \u1D04\u1D0F'), 'lookalike'); // small capitals
    assert.equal(Core.compareNames('Mann Co', '\u{1D40C}\u{1D41A}\u{1D427}\u{1D427} \u{1D402}\u{1D428}'), 'lookalike'); // math bold, folded by NFKC
    assert.equal(Core.compareNames('Mann Co', '\uFF2D\uFF41\uFF4E\uFF4E \uFF23\uFF4F'), 'lookalike'); // fullwidth
    assert.equal(Core.compareNames('Wolf', 'Wo\u0142f'), 'lookalike');
});

test('compareNames: decorations and punctuation do not hide a copy', () => {
    assert.equal(Core.compareNames('Mann Co. Bot', 'Mann Co. Bot \u2605'), 'lookalike');
    assert.equal(Core.compareNames('Mann Co. Bot', 'Mann.Co.Bot'), 'lookalike');
    assert.equal(Core.compareNames('ScrapTF Bot', 'Scrap TF Bot'), 'lookalike');
    assert.equal(Core.compareNames('Mann Co. Bot', '[TF2] Mann_Co_Bot!!'), 'similar');
    assert.equal(Core.compareNames('Kiro', 'TTV Kiro'), 'none'); // too short to judge by containment
});

test('compareNames: near misses are similar, numbered series are not', () => {
    assert.equal(Core.compareNames('Mann Co. Supply Bot', 'Mann Co. Suply Bot'), 'similar'); // 1 edit
    assert.equal(Core.compareNames('Mann Co Supply Bot', 'Mann Co Suply Bott'), 'similar'); // 2 edits, long name
    assert.equal(Core.compareNames('Alice', 'Alyse'), 'none'); // 2 edits, short name
    assert.equal(Core.compareNames('ScrapTF Bank #2', 'ScrapTF Bank #3'), 'none');
    assert.equal(Core.compareNames('ScrapTF Bank #1', 'ScrapTF Bank #l'), 'lookalike');
});

// built from code points so this file never holds a literal spoofing character
const cp = (...codes) => String.fromCodePoint(...codes);

test('compareNames: capitals that only look Latin before lowercasing', () => {
    assert.equal(Core.compareNames('SCRAP', cp(0x405, 0x421) + 'R' + cp(0x410, 0x420)), 'lookalike'); // Cyrillic S, C, A, P
    assert.equal(Core.compareNames('KIRO', cp(0x39A) + 'IRO'), 'lookalike'); // Greek capital Kappa
    assert.equal(Core.compareNames('MANN CO', cp(0x39C) + 'ANN CO'), 'lookalike'); // Greek capital Mu
    assert.equal(Core.compareNames('HAT BOT', cp(0x397) + 'AT BOT'), 'lookalike'); // Greek capital Eta
    assert.equal(Core.compareNames('YOSHI', cp(0x3A5) + 'OSHI'), 'lookalike'); // Greek capital Upsilon
    assert.equal(Core.compareNames('SAM BOT', cp(0x13DA, 0x13AA, 0x13B7) + ' BOT'), 'lookalike'); // Cherokee
    assert.equal(Core.compareNames('SAM BOT', cp(0xABAA, 0x13AA, 0x13B7) + ' BOT'), 'lookalike'); // Cherokee small S
});

test('compareNames: letters drawn in boxes, circles and flags', () => {
    assert.equal(Core.compareNames('Kiro', cp(0x1F17A, 0x1F178, 0x1F181, 0x1F17E)), 'lookalike'); // negative squared
    assert.equal(Core.compareNames('Kiro', cp(0x1F15A, 0x1F158, 0x1F161, 0x1F15E)), 'lookalike'); // negative circled
    assert.equal(Core.compareNames('Kiro', cp(0x1F1F0, 0x1F1EE, 0x1F1F7, 0x1F1F4)), 'lookalike'); // regional indicators
    assert.equal(Core.compareNames('Kiro', cp(0x24C0, 0x24BE, 0x24C7, 0x24C4)), 'lookalike'); // circled, via NFKC
});

test('compareNames: right-to-left overrides are compared as displayed', () => {
    assert.equal(Core.compareNames('Kiro', cp(0x202E) + 'oriK'), 'identical'); // RLO flips the rest
    assert.equal(Core.compareNames('Mann Co Bot', 'Mann ' + cp(0x2067) + 'oC' + cp(0x2069) + ' Bot'), 'identical'); // RLI ... PDI
    assert.equal(Core.visualForm(cp(0x202E) + 'oriK'), 'Kiro');
    assert.equal(Core.hasDirectionControls(cp(0x202E) + 'oriK'), true);
    assert.equal(Core.hasDirectionControls('Kiro'), false);
});

test('compareNames: blank-looking names, combining marks and Latin look-alikes', () => {
    assert.equal(Core.compareNames(cp(0x3164), cp(0x2800)), 'lookalike'); // two different "invisible" names
    assert.equal(Core.compareNames(cp(0x3164), 'Kiro'), 'none');
    assert.equal(Core.compareNames('Kiro', 'K' + cp(0x301, 0x302) + 'i' + cp(0x1DC0) + 'ro' + cp(0x20D7)), 'lookalike'); // "Zalgo" marks
    assert.equal(Core.compareNames('Kiwi Bot', 'Kivvi Bot'), 'lookalike'); // vv for w
    assert.equal(Core.compareNames('Kiro', 'K!ro'), 'lookalike'); // ! for i
    assert.equal(Core.compareNames('Wolf', 'Vulf'), 'none');
});

test('assessPartner flags names that imitate the panel or flip their text', () => {
    assert.deepEqual(codes(Core.assessPartner(profile({ name: 'Kiro - SteamID64: 76561198000000301' }), [], { now: NOW })), ['nameHasSteamId']);
    assert.deepEqual(codes(Core.assessPartner(profile({ name: cp(0x202E) + 'tob' }), [], { now: NOW })), ['directionTrick']);
});

test('compareNames: names made only of symbols are not matched by skeleton', () => {
    assert.equal(Core.compareNames('\u2605\u2605\u2605', '\u2606\u2606\u2606'), 'none');
});

test('compareNames: unrelated or very short names do not match', () => {
    assert.equal(Core.compareNames('Alice', 'Bob'), 'none');
    assert.equal(Core.compareNames('ab', 'ac'), 'none');
    assert.equal(Core.compareNames('', 'Bob'), 'none');
});

test('avatarHash extracts the hash and ignores the default avatar', () => {
    assert.equal(Core.avatarHash(AVATAR_A), '0123456789abcdef0123456789abcdef01234567');
    assert.equal(Core.avatarHash(AVATAR_DEFAULT), null);
    assert.equal(Core.avatarHash(null), null);
});

test('parseApiKeyPage detects a registered key', () => {
    const html = `<div id="bodyContents_ex"><h2>Your Steam Web API Key</h2>
        <p>Key: 0123456789ABCDEF0123456789ABCDEF</p><p>Domain Name: scam-site.example</p>
        <form action="https://steamcommunity.com/dev/revokekey" method="POST"></form></div>`;

    assert.deepEqual(Core.parseApiKeyPage(html, 'https://steamcommunity.com/dev/apikey'), {
        state: 'key',
        key: '0123456789ABCDEF0123456789ABCDEF',
        domain: 'scam-site.example'
    });
});

test('parseApiKeyPage detects a key from the revoke form alone', () => {
    const html = '<p>Domain Name: x.example</p><form action="/dev/revokekey"></form>';
    assert.deepEqual(Core.parseApiKeyPage(html), { state: 'key', key: null, domain: 'x.example' });
});

test('parseApiKeyPage detects no key and logged-out states', () => {
    const empty = '<form action="https://steamcommunity.com/dev/registerkey"><input id="domain" name="domain"></form>';
    assert.deepEqual(Core.parseApiKeyPage(empty), { state: 'none' });
    assert.deepEqual(Core.parseApiKeyPage('<script>g_steamID = false;</script>'), { state: 'logged_out' });
    assert.deepEqual(Core.parseApiKeyPage('', 'https://steamcommunity.com/login/home/?goto=dev%2Fapikey'), { state: 'logged_out' });
    assert.deepEqual(Core.parseApiKeyPage('<html>maintenance</html>'), { state: 'unknown' });
});

const PROFILE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<profile>
    <steamID64>76561198000000001</steamID64>
    <steamID><![CDATA[Mann Co. Bot]]></steamID>
    <privacyState>public</privacyState>
    <avatarFull><![CDATA[${AVATAR_A}]]></avatarFull>
    <vacBanned>0</vacBanned>
    <tradeBanState>None</tradeBanState>
    <isLimitedAccount>0</isLimitedAccount>
    <memberSince>March 3, 2015</memberSince>
</profile>`;

test('parseProfileXml reads the fields Trade Guard needs', () => {
    assert.deepEqual(Core.parseProfileXml(PROFILE_XML), {
        steamId: '76561198000000001',
        name: 'Mann Co. Bot',
        avatarHash: '0123456789abcdef0123456789abcdef01234567',
        privacy: 'public',
        tradeBan: 'None',
        vacBanned: false,
        limited: false,
        memberSince: 'March 3, 2015'
    });
});

test('parseProfileXml rejects error responses', () => {
    assert.equal(Core.parseProfileXml('<response><error><![CDATA[The specified profile could not be found.]]></error></response>'), null);
    assert.equal(Core.parseProfileXml(''), null);
});

test('aliasAgeDays reads both name-history date styles', () => {
    assert.equal(Core.aliasAgeDays('28 Oct @ 4:41pm', NOW), 1);
    assert.equal(Core.aliasAgeDays('Oct 28 @ 4:41pm', NOW), 1);
    assert.equal(Core.aliasAgeDays('3 Mar, 2015 @ 1:00am', NOW), Core.accountAgeDays('March 3, 2015', NOW));
    assert.equal(Core.aliasAgeDays('Mar 3, 2015 @ 1:00am', NOW), Core.accountAgeDays('March 3, 2015', NOW));
    assert.equal(Core.aliasAgeDays('yesterday', NOW), null);
    assert.equal(Core.aliasAgeDays('', NOW), null);
});

const KEY = 'classinfo/440/101785959/11040578';
const HAT = 'classinfo/440/111/222';
const offer = (offerId, partnerId, give, get) => ({ offerId, partnerId, give, get });

test('findMirroredOffer catches a copy that asks for the same items and gives nothing', () => {
    const original = offer('1', 'BOT', [HAT], [KEY, KEY]);
    const copy = offer('2', 'IMPOSTOR', [HAT], []);

    assert.equal(Core.findMirroredOffer(copy, [original]), original);
});

test('findMirroredOffer catches an identical copy regardless of item order', () => {
    const original = offer('1', 'BOT', [HAT, KEY], [KEY, HAT]);
    const copy = offer('2', 'IMPOSTOR', [KEY, HAT], [HAT, KEY]);

    assert.equal(Core.findMirroredOffer(copy, [original]), original);
});

test('findMirroredOffer ignores the same partner, the same offer and different deals', () => {
    const original = offer('1', 'BOT', [HAT], [KEY]);

    assert.equal(Core.findMirroredOffer(offer('2', 'BOT', [HAT], []), [original]), null); // same partner
    assert.equal(Core.findMirroredOffer(offer('1', 'X', [HAT], []), [original]), null); // same offer id
    assert.equal(Core.findMirroredOffer(offer('2', 'X', [KEY], [HAT]), [original]), null); // different items
    assert.equal(Core.findMirroredOffer(offer('2', 'X', [], [HAT]), [original]), null); // you give nothing
});

test('findMirroredOffer does not flag paying the same keys for different things', () => {
    const boughtHat = offer('1', 'BOT_A', [KEY, KEY], [HAT]);
    const boughtOther = offer('2', 'BOT_B', [KEY, KEY], ['classinfo/440/999/0']);

    assert.equal(Core.findMirroredOffer(boughtOther, [boughtHat]), null);
});

test('assessPartner warns about a name changed in the last week', () => {
    const aliases = [{ newname: 'Mann Co. Bot', timechanged: '28 Oct @ 4:41pm' }, { newname: 'xX_gamer_Xx', timechanged: '1 Jan, 2024 @ 2:00pm' }];
    const result = Core.assessPartner(profile({ name: 'Mann Co. Bot' }), [], { now: NOW, aliases });
    const finding = result.findings.find((f) => f.code === 'recentRename');

    assert.equal(finding.level, 'warning');
    assert.equal(finding.value, 1);
    assert.deepEqual(finding.previousNames, ['xX_gamer_Xx']);
});

// shape and dates copied from a real Steam name history
const EXAMPLE_ALIASES = [
    { newname: 'Kiro', timechanged: '3 Mar, 2021 @ 2:37pm' },
    { newname: 'RocketMan', timechanged: '9 Sep, 2018 @ 11:59pm' },
    { newname: 'Pyrocat', timechanged: '1 Feb, 2015 @ 9:04pm' }
];

test('assessPartner lists up to three previous names for old renames', () => {
    const result = Core.assessPartner(profile({ name: 'Kiro' }), [], { now: NOW, aliases: EXAMPLE_ALIASES });

    assert.deepEqual(result.findings, [{ level: 'info', code: 'renamed', previousNames: ['RocketMan', 'Pyrocat'] }]);
});

test('assessPartner handles name history that does not include the current name', () => {
    const aliases = [{ newname: 'Old Name', timechanged: '28 Oct @ 4:41pm' }];
    const result = Core.assessPartner(profile({}), [], { now: NOW, aliases });

    assert.deepEqual(result.findings, [{ level: 'info', code: 'renamed', previousNames: ['Old Name'] }]);
});

test('assessPartner flags an account that used to be named like a friend', () => {
    const aliases = [{ newname: 'Someone', timechanged: '1 Jan, 2020 @ 2:00pm' }, { newname: 'M\u0430nn Co. Bot', timechanged: '1 Jan, 2019 @ 2:00pm' }];
    const result = Core.assessPartner(profile({}), [FRIEND], { now: NOW, aliases });
    const finding = result.findings.find((f) => f.code === 'formerlyNamedLike');

    assert.equal(finding.level, 'warning');
    assert.equal(finding.formerName, 'M\u0430nn Co. Bot');
    assert.equal(finding.contact.steamId, FRIEND.steamId);
});

test('assessPartner does not call two real friends with the same name impostors', () => {
    const soundA = { steamId: '76561198000000201', name: 'sound', avatarHash: 'a'.repeat(40), source: 'friend' };
    const soundB = { steamId: '76561198000000202', name: 'sound', avatarHash: 'b'.repeat(40), source: 'friend' };
    const partner = profile({ steamId: soundA.steamId, name: 'sound', avatarHash: soundA.avatarHash });
    const result = Core.assessPartner(partner, [soundA, soundB], { now: NOW });

    assert.deepEqual(codes(result), ['isFriend', 'sharedIdentity']);
    assert.equal(Core.worstLevel(result.findings), 'warning');
});

test('assessPartner still flags a stranger copying a friend who shares a name with another friend', () => {
    const soundA = { steamId: '76561198000000201', name: 'sound', avatarHash: 'a'.repeat(40), source: 'friend' };
    const soundB = { steamId: '76561198000000202', name: 'sound', avatarHash: 'b'.repeat(40), source: 'friend' };
    const result = Core.assessPartner(profile({ name: 'sound' }), [soundA, soundB], { now: NOW });

    assert.deepEqual(codes(result), ['impostorFriend', 'impostorFriend']);
});

const DAY = 24 * 60 * 60 * 1000;
const daysSinceUtc = (y, m, d) => Math.floor((NOW.getTime() - Date.UTC(y, m - 1, d)) / DAY);

test('accountAgeDays reads full dates exactly', () => {
    assert.equal(Core.accountAgeDays('October 19, 2026', NOW), 10);
    assert.equal(Core.accountAgeDays('January 28, 2015', NOW), daysSinceUtc(2015, 1, 28));
    assert.equal(Core.accountAgeDays(null, NOW), null);
    assert.equal(Core.accountAgeDays('not a date', NOW), null);
});

test('accountAgeDays never assumes the current year when Steam drops it', () => {
    // a real case: Steam returned "August 7" for an account created in 2017
    assert.equal(Core.accountAgeDays('August 7', NOW, '76561198660265728'), daysSinceUtc(2017, 8, 7));
    // without a SteamID to place it, the age is unknown rather than guessed
    assert.equal(Core.accountAgeDays('August 7', NOW), null);
});

test('estimatedAgeDays matches anchors exactly and interpolates between them', () => {
    assert.equal(Core.estimatedAgeDays('76561198176365728', NOW), daysSinceUtc(2015, 1, 28)); // an anchor itself

    const between = Core.estimatedAgeDays('76561198394265728', NOW); // accountId 434M: Aug 2016 \u2013 Jun 2017
    assert.ok(between < daysSinceUtc(2016, 8, 7) && between > daysSinceUtc(2017, 6, 17));
});

test('estimatedAgeDays extrapolates past the newest anchor and never goes negative', () => {
    const newest = Core.estimatedAgeDays('76561199859965728', NOW); // just below the newest anchor
    const beyond = Core.estimatedAgeDays('76561200060265728', NOW); // accountId 2.1B
    const farBeyond = Core.estimatedAgeDays('76561209960265728', NOW); // accountId 12B

    assert.ok(newest > 500);
    assert.ok(beyond < newest);
    assert.equal(farBeyond, 0);
});

test('estimateCreationTime uses anchors learned at runtime', () => {
    const accountId = 1700000000;
    const steamId = (76561197960265728n + BigInt(accountId)).toString();
    const learnedTime = Date.UTC(2024, 0, 1);

    const learned = Core.estimateCreationTime(steamId, NOW, [[accountId, learnedTime]]);
    assert.equal(learned, learnedTime);

    // an out-of-order anchor (older date than an older account) is ignored
    const bogus = Core.estimateCreationTime(steamId, NOW, [[accountId, Date.UTC(2005, 0, 1)]]);
    assert.notEqual(bogus, Date.UTC(2005, 0, 1));
});

test('estimateCreationTime is not poisoned by one learned anchor dated far too late', () => {
    const steamIdAt = (accountId) => (76561197960265728n + BigInt(accountId)).toString();
    const poison = [[500000000, Date.UTC(2025, 0, 1)]]; // a 2017-era account claiming 2025

    // built-in points after the bad one must still be used
    assert.equal(Core.estimateCreationTime(steamIdAt(940500000), NOW, poison), Date.UTC(2019, 1, 5));
    const bad = steamIdAt(500000000);
    assert.equal(Core.estimateCreationTime(bad, NOW, poison), Core.estimateCreationTime(bad, NOW));
});

function profile(overrides) {
    return {
        steamId: '76561198000000099',
        name: 'Someone',
        avatarHash: null,
        privacy: 'public',
        tradeBan: 'None',
        limited: false,
        memberSince: 'March 3, 2015',
        ...overrides
    };
}

const FRIEND = { steamId: '76561198000000001', name: 'Mann Co. Bot', avatarHash: Core.avatarHash(AVATAR_A), source: 'friend' };
const codes = (result) => result.findings.map((f) => f.code);

test('assessPartner flags a copied avatar with a similar name as an impostor', () => {
    const result = Core.assessPartner(profile({ name: 'Mann Co. Bot Official', avatarHash: FRIEND.avatarHash }), [FRIEND], { now: NOW });
    const finding = result.findings.find((f) => f.code === 'impostorFriend');

    assert.ok(finding);
    assert.equal(finding.level, 'danger');
    assert.equal(finding.sameAvatar, true);
    assert.equal(Core.worstLevel(result.findings), 'danger');
});

test('assessPartner only warns about a shared avatar with an unrelated name', () => {
    // official Steam avatars are used by thousands of unrelated accounts
    const result = Core.assessPartner(profile({ name: 'Totally Different', avatarHash: FRIEND.avatarHash }), [FRIEND], { now: NOW });

    assert.deepEqual(codes(result), ['sameAvatar']);
    assert.equal(Core.worstLevel(result.findings), 'warning');
});

test('assessPartner does not call a generic one-letter name an impostor', () => {
    const friendA = { steamId: '76561198000000203', name: 'A', avatarHash: null, source: 'friend' };
    const result = Core.assessPartner(profile({ name: 'A' }), [friendA], { now: NOW });

    assert.deepEqual(codes(result), ['similarName']);
    assert.equal(Core.worstLevel(result.findings), 'warning');
});

test('assessPartner ignores short former names when looking for past impersonation', () => {
    const friendA = { steamId: '76561198000000203', name: 'A', avatarHash: null, source: 'friend' };
    const aliases = [{ newname: 'Someone', timechanged: '1 Jan, 2020 @ 2:00pm' }, { newname: 'A', timechanged: '1 Jan, 2019 @ 2:00pm' }];
    const result = Core.assessPartner(profile({}), [friendA], { now: NOW, aliases });

    assert.equal(result.findings.some((f) => f.code === 'formerlyNamedLike'), false);
});

test('assessPartner flags a new account copying a past partner\'s name', () => {
    const partner = { ...FRIEND, source: 'partner' };
    const copy = profile({ name: 'M\u0430nn Co. Bot', avatarHash: Core.avatarHash(AVATAR_B), memberSince: 'October 1, 2026' });

    assert.deepEqual(codes(Core.assessPartner(copy, [partner], { now: NOW })).sort(), ['impostorPartner', 'newAccount']);
});

test('assessPartner keeps a private or just-renamed copy of a past partner red', () => {
    const partner = { ...FRIEND, source: 'partner' };
    const privateCopy = profile({ name: 'Mann Co. Bot', memberSince: null, privacy: 'private' });
    const renamedCopy = profile({ name: 'Mann Co. Bot' });
    const aliases = [{ newname: 'Mann Co. Bot', timechanged: '27 Oct @ 9:00pm' }, { newname: 'random guy', timechanged: '1 Jan, 2016 @ 1:00pm' }];

    assert.ok(codes(Core.assessPartner(privateCopy, [partner], { now: NOW })).includes('impostorPartner'));
    assert.ok(codes(Core.assessPartner(renamedCopy, [partner], { now: NOW, aliases })).includes('impostorPartner'));
});

test('assessPartner treats an old, public account with a past partner\'s name as a possible sibling bot', () => {
    const partner = { ...FRIEND, source: 'partner' };
    const siblingBot = profile({ name: 'Mann Co. Bot', avatarHash: FRIEND.avatarHash });
    const result = Core.assessPartner(siblingBot, [partner], { now: NOW });

    assert.deepEqual(codes(result), ['samePartnerName']);
    assert.equal(Core.worstLevel(result.findings), 'warning');
});

test('assessPartner does not give a recently added friend the benefit of the doubt', () => {
    const realKiro = { steamId: '76561198000000301', name: 'Kiro', avatarHash: 'a'.repeat(40), source: 'friend' };
    const newKiro = { steamId: '76561199900000000', name: 'Kiro', avatarHash: 'b'.repeat(40), source: 'friend', recentFriend: true };
    const partner = profile({ steamId: newKiro.steamId, name: 'Kiro' });
    const result = Core.assessPartner(partner, [realKiro, newKiro], { now: NOW });

    assert.deepEqual(codes(result).sort(), ['impostorFriend', 'isFriend', 'recentFriend']);
    assert.equal(Core.worstLevel(result.findings), 'danger');
});

test('assessPartner treats the real friend as safe', () => {
    const partner = profile({ steamId: FRIEND.steamId, name: FRIEND.name, avatarHash: FRIEND.avatarHash });
    const result = Core.assessPartner(partner, [FRIEND], { now: NOW });

    assert.deepEqual(codes(result), ['isFriend']);
    assert.equal(Core.worstLevel(result.findings), 'ok');
});

test('assessPartner ignores the user\'s own account', () => {
    const self = { steamId: '76561198000000555', name: 'Someone', avatarHash: null, source: 'partner' };
    const result = Core.assessPartner(profile({}), [self], { now: NOW, selfId: self.steamId });

    assert.deepEqual(codes(result), []);
});

test('assessPartner reports trade bans, new, private and limited accounts', () => {
    assert.deepEqual(codes(Core.assessPartner(profile({ tradeBan: 'Banned' }), [], { now: NOW })), ['tradeBan']);
    assert.deepEqual(codes(Core.assessPartner(profile({ memberSince: 'October 19, 2026' }), [], { now: NOW })), ['newAccount']);
    assert.deepEqual(codes(Core.assessPartner(profile({ memberSince: null, privacy: 'private' }), [], { now: NOW })), ['privateProfile']);
    assert.deepEqual(codes(Core.assessPartner(profile({ limited: true }), [], { now: NOW })), ['limited']);
});

test('assessPartner estimates the age of private profiles from the SteamID', () => {
    const oldPrivate = Core.assessPartner(profile({ memberSince: null, privacy: 'friendsonly' }), [], { now: NOW });
    assert.equal(oldPrivate.ageEstimated, true);
    assert.ok(oldPrivate.ageDays > 365 * 10);
    assert.deepEqual(codes(oldPrivate), ['privateProfile']);

    const newPrivate = Core.assessPartner(profile({ steamId: '76561200060265728', memberSince: null, privacy: 'private' }), [], { now: NOW });
    assert.deepEqual(codes(newPrivate).sort(), ['newAccountEstimated', 'privateProfile']);
});

test('assessPartner no longer calls an old account with a year-less date new', () => {
    const bot = Core.assessPartner(profile({ steamId: '76561198660265728', memberSince: 'August 7' }), [], { now: NOW });

    assert.equal(bot.ageEstimated, false);
    assert.equal(bot.ageDays, daysSinceUtc(2017, 8, 7));
    assert.deepEqual(codes(bot), []);
});

// ----- items: Name Tags and Description Tags -----

const NL = String.fromCharCode(10);

// a real renamed item from a public TF2 bot inventory, trimmed to the fields that matter
const RENAMED_BOTKILLER = {
    name: "''Gayro Burner''",
    market_hash_name: 'Strange Gold Botkiller Flame Thrower Mk.I',
    fraudwarnings: [`This item has been renamed.${NL}Original name: "Gold Botkiller Flame Thrower Mk.I"`],
    descriptions: [{ value: 'Extinguishing teammates restores 20 health' }]
};

test('parseItemHover reads the item out of Steam hover pages', () => {
    const json = JSON.stringify({ ...RENAMED_BOTKILLER, descriptions: [{ value: 'braces { and "quotes" } inside text' }] });
    const html = `<div>...</div><script>BuildHover( 'economy_item_6ae2e', ${json}, null );</script>`;

    assert.equal(Core.parseItemHover(html).market_hash_name, 'Strange Gold Botkiller Flame Thrower Mk.I');
    assert.equal(Core.parseItemHover('<html>no item</html>'), null);
    assert.equal(Core.parseItemHover('BuildHover( "x", {"broken": }'), null);
});

test('itemCustomization reads real renamed items', () => {
    const item = Core.itemCustomization(RENAMED_BOTKILLER);

    assert.equal(item.customName, 'Gayro Burner');
    assert.equal(item.customDescription, null);
    assert.equal(item.realName, 'Strange Gold Botkiller Flame Thrower Mk.I');
    assert.deepEqual(item.claims, []);
    assert.equal(Core.itemCustomization({ name: 'Refined Metal', market_hash_name: 'Refined Metal', descriptions: [] }), null);
    assert.equal(Core.itemCustomization(null), null);
});

test('itemFindings flags names and descriptions that fake a valuable item', () => {
    const fakeUnusual = {
        name: "''Unusual Burning Flames Team Captain''",
        market_hash_name: 'Team Captain',
        fraudwarnings: [`This item has been renamed.${NL}Original name: "Team Captain"`]
    };
    const fakeEffect = {
        name: 'Team Captain',
        market_hash_name: 'Team Captain',
        descriptions: [{ value: "''Unusual Effect: Sunbeams''" }]
    };
    const fakeKey = { name: "''Mann Co. Supply Crate Key''", market_hash_name: "Bill's Hat", fraudwarnings: ['This item has been renamed.'] };

    assert.deepEqual(Core.itemCustomization(fakeUnusual).claims, ['unusual', 'burning flames']);
    assert.deepEqual(Core.itemCustomization(fakeEffect).claims, ['unusual', 'effect', 'sunbeams']);
    assert.equal(Core.itemCustomization(fakeEffect).customDescription, 'Unusual Effect: Sunbeams');
    assert.deepEqual(Core.itemCustomization(fakeKey).claims, ['key']);

    const findings = Core.itemFindings([fakeUnusual, RENAMED_BOTKILLER, { name: 'Refined Metal', market_hash_name: 'Refined Metal' }]);
    assert.deepEqual(findings.map((f) => [f.level, f.code, f.items.length]), [['danger', 'fakeValueItem', 1], ['warning', 'customizedItems', 1]]);
});

test('itemFindings trusts words the item really has', () => {
    const realUnusual = {
        name: "''My Lucky Hat''",
        market_hash_name: 'Unusual Team Captain',
        fraudwarnings: [`This item has been renamed.${NL}Original name: "Team Captain"`],
        descriptions: [{ value: 'Unusual Effect: Burning Flames' }, { value: "''an unusual hat with burning flames''" }]
    };

    assert.deepEqual(Core.itemCustomization(realUnusual).claims, []);
    assert.deepEqual(Core.itemFindings([realUnusual]).map((f) => f.code), ['customizedItems']);
    assert.deepEqual(Core.itemFindings([]), []);
});

test('itemFindings catches value words written with lookalike letters', () => {
    const smallCapital = { name: `''${cp(0x1D1C)}nusual Hat''`, market_hash_name: 'Hat', fraudwarnings: ['renamed'] };
    const cyrillic = { name: `''Unusu${cp(0x0430)}l Hat''`, market_hash_name: 'Hat', fraudwarnings: ['renamed'] };

    assert.deepEqual(Core.itemCustomization(smallCapital).claims, ['unusual']);
    assert.deepEqual(Core.itemCustomization(cyrillic).claims, ['unusual']);
});

// ----- messages and comments -----

const linkCodes = (text, hrefs = [], options = { unknownLinks: true }) =>
    Core.analyzeText(text, hrefs, options).map((f) => f.code);

test('analyzeText ignores normal trade talk and real trading sites', () => {
    assert.deepEqual(linkCodes('1.33 ref for your hat? Mann Co. Supply Crate Key, Mk.I, e.g. 2 keys'), []);
    assert.deepEqual(linkCodes('prices on backpack.tf/stats, my bot on scrap.tf, https://steamcommunity.com/id/me'), []);
    assert.deepEqual(linkCodes('https://www.backpack.tf/classifieds and stntrading.eu and mannco.store and teamfortress.tv'), []);
    assert.deepEqual(linkCodes('https://help.steampowered.com/en/ and wiki.teamfortress.com'), []);
    assert.deepEqual(linkCodes(''), []);
});

test('analyzeText flags lookalike domains of Steam and trading sites', () => {
    const fake = (text) => Core.analyzeText(text).find((f) => f.code === 'phishingLink').links[0].imitates;

    assert.equal(fake('log in at steamcommunlty.com/tradeoffer'), 'steamcommunity.com');
    assert.equal(fake('stearncommunity.ru'), 'steamcommunity.com'); // rn looks like m
    assert.equal(fake('steamcomminuty.com'), 'steamcommunity.com'); // swapped letters
    assert.equal(fake('steamcommunity.com.verify-login.ru/abc'), 'steamcommunity.com');
    assert.equal(fake('backpack-tf.com'), 'backpack.tf');
    assert.equal(fake('scrap.tf.trade'), 'scrap.tf');
    assert.equal(fake('marketplace-tf.store'), 'marketplace.tf');
    assert.equal(fake(`st${cp(0x0435)}amcommunity.com`), 'steamcommunity.com'); // Cyrillic e
    assert.equal(fake('http://xn--stamcommunity-r8i.com/login'), 'steamcommunity.com'); // punycode
});

test('analyzeText sees through disguised and wrapped links', () => {
    const disguised = Core.analyzeText('https://steamcommunity.com@evil.example/login')[0];
    assert.equal(disguised.code, 'phishingLink');
    assert.deepEqual(disguised.links, [{ host: 'evil.example', imitates: null }]);

    const wrapped = Core.analyzeText('click', ['https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fsteamcomrnunity.com%2Flogin']);
    assert.equal(wrapped[0].links[0].imitates, 'steamcommunity.com');

    // the link text can say anything; the href is where it goes
    assert.deepEqual(linkCodes('steamcommunity.com', ['https://steamcommunity.com/linkfilter/?url=https://backpack-tf.com']), ['phishingLink']);
});

test('analyzeText reports unrelated links only when asked', () => {
    assert.deepEqual(linkCodes('join discord.gg/abc'), ['unknownLink']);
    assert.deepEqual(linkCodes('join discord.gg/abc', [], {}), []);
});

test('analyzeText recognizes common scam lines, even with lookalike letters', () => {
    const phrases = (text) => (Core.analyzeText(text).find((f) => f.code === 'scamPhrase') || { phrases: [] }).phrases;

    assert.deepEqual(phrases('hey is this your item? vote for my team pls'), ['vote for my', 'is this your item']);
    assert.deepEqual(phrases('Your account will be banned, I am Steam Support'), ['account will be banned', 'steam support']);
    assert.deepEqual(phrases('I accidentally reported your account, sorry'), ['accidentally report']);
    assert.deepEqual(phrases('send me your items to verify them'), ['send me your items to verify']);
    assert.deepEqual(phrases(`fr${cp(0x0435)}${cp(0x0435)} keys giveaway`), ['free keys', 'giveaway']);
    assert.deepEqual(phrases('2 keys for your hat? added you'), []);
});

test('impersonatesStaff catches names claiming to be Steam or Valve staff', () => {
    for (const name of ['Steam Support', 'VALVE Admin', 'Valve_Moderator', `St${cp(0x0435)}am S${cp(0x0435)}curity`, 'steam.official']) {
        assert.equal(Core.impersonatesStaff(name), true, name);
    }
    for (const name of ['Steamy', 'Support Bot', 'Mann Co. Bot', 'Valve', 'SteamTrades', 'Steam Trade Service', '']) {
        assert.equal(Core.impersonatesStaff(name), false, name);
    }
});

test('assessPartner flags names claiming to be staff', () => {
    assert.deepEqual(codes(Core.assessPartner(profile({ name: 'Steam Support' }), [], { now: NOW })), ['staffImpersonation']);
});

// ----- trade holds and items from other games -----

test('looksLikeBot recognizes the names trading sites give their bots', () => {
    for (const name of ['STN Trading Bot #12', 'Scrap.TF Bot', 'B0T', 'mannco.store #3', 'Quicksell 7']) {
        assert.equal(Core.looksLikeBot(name), true, name);
    }
    for (const name of ['Robotnik', 'Kiro', 'Abbot Hall', '']) {
        assert.equal(Core.looksLikeBot(name), false, name);
    }
});

test('escrowFindings flags a "bot" whose items would be held', () => {
    assert.deepEqual(Core.escrowFindings({ mine: 0, theirs: 15 }, 'STN Trading Bot #3'),
        [{ level: 'danger', code: 'botWithHold', value: 15 }]);
    assert.deepEqual(Core.escrowFindings({ mine: 0, theirs: 15 }, 'Kiro'),
        [{ level: 'warning', code: 'partnerHold', value: 15 }]);
    assert.deepEqual(Core.escrowFindings({ mine: 0, theirs: 0 }, 'STN Trading Bot #3'), []);
});

test("escrowFindings stays quiet when the hold could come from the user's own side", () => {
    assert.deepEqual(Core.escrowFindings({ mine: 15, theirs: 15 }, 'STN Trading Bot #3'), []);
    assert.deepEqual(Core.escrowFindings(null, 'STN Trading Bot #3'), []);
});

test('otherGameFindings notes items from other games and flags ones posing as TF2 items', () => {
    const key = 'Mann Co. Supply Crate Key';
    const csKey = { appid: '730', description: { name: key, market_hash_name: key } };
    const csSkin = { appid: '730', description: { name: 'AK-47 | Redline' } };
    const card = { appid: '753', description: null };
    const metal = { appid: '440', description: { name: 'Refined Metal' } };

    assert.deepEqual(Core.otherGameFindings([metal]), []);
    assert.deepEqual(Core.otherGameFindings([csSkin, card, metal]),
        [{ level: 'info', code: 'otherGameItems', apps: ['Counter-Strike 2', 'Steam'], value: 2 }]);
    assert.deepEqual(Core.otherGameFindings([csKey, metal]),
        [{ level: 'danger', code: 'disguisedItem', apps: ['Counter-Strike 2'], names: [key] }]);
    assert.equal(Core.otherGameFindings([{ appid: '999', description: { name: 'Thing' } }])[0].apps[0], 'app 999');
});

// ----- comment walls -----

test('isScamReport reads warnings, not praise', () => {
    for (const text of ['SCAMMER!! stole my unusual', '-rep scammed me', 'do not trade, impostor of my friend', 'Fake bot, api scam']) {
        assert.equal(Core.isScamReport(text), true, text);
    }
    for (const text of ['+rep legit trader, not a scammer', '+rep fast trade', 'he is no thief', 'nice profile']) {
        assert.equal(Core.isScamReport(text), false, text);
    }
    assert.equal(Core.isScamReport(`sc${cp(0x0430)}mmer`), true); // lookalike letters don't hide it
});

test('commentWallFindings weighs how many different people wrote a warning', () => {
    const partner = '76561198000000999';
    const wall = [
        { authorId: '1', text: 'scammer' },
        { authorId: '2', text: 'stole my hat' },
        { authorId: partner, text: 'people call me a scammer lol' }, // the partner's own comment
        { authorId: '2', text: 'scammer again' }
    ];

    const two = Core.commentWallFindings(wall, partner);
    assert.deepEqual(two.map((f) => [f.level, f.code, f.value]), [['warning', 'scamReports', 2]]);
    assert.deepEqual(two[0].excerpts, ['scammer', 'stole my hat']);

    const three = Core.commentWallFindings(wall.concat({ authorId: '3', text: 'impostor' }), partner);
    assert.equal(three[0].level, 'danger');
    assert.deepEqual(Core.commentWallFindings([{ authorId: '1', text: '+rep' }], partner), []);
});

test('commentWallFindings flags hidden comments only on new accounts', () => {
    assert.deepEqual(Core.commentWallFindings([], 'x', { hidden: true, ageDays: 20 }),
        [{ level: 'warning', code: 'commentsHidden' }]);
    assert.deepEqual(Core.commentWallFindings([], 'x', { hidden: true, ageDays: 2000 }), []);
    assert.deepEqual(Core.commentWallFindings([], 'x', { hidden: true, ageDays: null }), []);
});

// ----- signing in through Steam -----

test('loginCheck names the site and trusts known trading sites', () => {
    assert.deepEqual(Core.loginCheck('https://backpack.tf/', 'https://backpack.tf/login/'),
        { host: 'backpack.tf', level: 'ok', code: 'loginKnown' });
    assert.deepEqual(Core.loginCheck('https://example.org/', 'https://example.org/auth'),
        { host: 'example.org', level: 'warning', code: 'loginUnknown' });
    assert.equal(Core.loginCheck('', ''), null);
});

test('loginCheck catches lookalike sites, mismatched return addresses and disguised hosts', () => {
    assert.deepEqual(Core.loginCheck('https://backpack-tf.com/', 'https://backpack-tf.com/login'),
        { host: 'backpack-tf.com', level: 'danger', code: 'loginLookalike', imitates: 'backpack.tf' });
    assert.deepEqual(Core.loginCheck('https://backpack.tf/', 'https://evil.example/cb'),
        { host: 'evil.example', level: 'danger', code: 'loginMismatch', realmHost: 'backpack.tf' });
    assert.equal(Core.loginCheck('https://backpack.tf', 'https://backpack.tf@evil.example/').code, 'loginMismatch');

    // malformed punycode that URL() rejects must not slip through
    assert.equal(Core.loginCheck(null, 'https://xn--stamcommunity-r8i.com/x').code, 'loginLookalike');
});

// ----- verified bots and reports -----

test('parseBotList reads pasted lists, profile links and exports', () => {
    const pasted = [
        'https://steamcommunity.com/profiles/76561198000000302/ STN Trading Bot #2',
        '76561198000000303, Scrap.TF Bot',
        'not an id',
        '76561198000000302 duplicate',
        '7656119800000030 too short'
    ].join(String.fromCharCode(10));

    assert.deepEqual(Core.parseBotList(pasted), [
        { steamId: '76561198000000302', name: 'STN Trading Bot #2' },
        { steamId: '76561198000000303', name: 'Scrap.TF Bot' }
    ]);

    const exported = JSON.stringify({ bots: [{ steamId: '76561198000000304', name: 'X' }, { steamId: 'bad' }] });
    assert.deepEqual(Core.parseBotList(exported), [{ steamId: '76561198000000304', name: 'X' }]);
    assert.deepEqual(Core.parseBotList(''), []);
});

const VERIFIED_BOT = { steamId: '76561198000000302', name: 'STN Trading Bot #2', avatarHash: null, source: 'verified' };

test('assessPartner flags a copy of a verified bot even on first contact', () => {
    const copy = Core.assessPartner(profile({ name: 'STN Trading Bot #2' }), [VERIFIED_BOT], { now: NOW });

    assert.deepEqual(codes(copy), ['impostorVerifiedBot']);
    assert.equal(Core.worstLevel(copy.findings), 'danger');
});

test('assessPartner trusts the verified bot itself and its numbered siblings', () => {
    const contacts = [VERIFIED_BOT, { ...VERIFIED_BOT, steamId: '76561198000000303' }];
    const real = Core.assessPartner(profile({ steamId: VERIFIED_BOT.steamId, name: 'STN Trading Bot #2' }), contacts, { now: NOW });
    assert.deepEqual(codes(real), ['verifiedBot']);

    const sibling = Core.assessPartner(profile({ name: 'STN Trading Bot #7' }), [VERIFIED_BOT], { now: NOW });
    assert.deepEqual(codes(sibling), []);
});

test('reportText lays out who, whom and what for a report form', () => {
    const text = Core.reportText({
        scammer: { steamId: '76561199950000042', name: 'Kiro' },
        impersonated: { steamId: '76561198000000301', name: 'Kiro' },
        evidence: ['Impersonating your friend', 'New account'],
        offerId: '7001',
        when: NOW
    });
    const lines = text.split(String.fromCharCode(10));

    assert.equal(lines[0], 'Scam attempt report');
    assert.ok(lines.includes('Scammer: "Kiro" (SteamID64 76561199950000042) https://steamcommunity.com/profiles/76561199950000042'));
    assert.ok(lines.includes('Impersonating: "Kiro" (SteamID64 76561198000000301) https://steamcommunity.com/profiles/76561198000000301'));
    assert.ok(lines.includes('Trade offer: 7001'));
    assert.ok(lines.includes('Date: 2026-10-29'));
    assert.ok(lines.includes('- New account'));

    const minimal = Core.reportText({
        scammer: { steamId: '1', name: 'x' }, impersonated: null, evidence: [], when: NOW
    });
    assert.ok(!minimal.includes('Impersonating') && !minimal.includes('Trade offer'));
});
