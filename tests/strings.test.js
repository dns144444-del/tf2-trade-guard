'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Strings } = require('../tf2-trade-guard.user.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'tf2-trade-guard.user.js'), 'utf8');

test('every finding the script can raise has text for the panel', () => {
    const patterns = [
        /\bcode: '([A-Za-z]+)'/g,
        /\bcode: [^,\n]*\? '([A-Za-z]+)' : '([A-Za-z]+)'/g, // a code picked by a condition
        /renderNotice\([^,]+, '([A-Za-z]+)'\)/g // drawn instead of a verdict
    ];
    const codes = new Set(patterns.flatMap((pattern) => [...SOURCE.matchAll(pattern)].flatMap((m) => m.slice(1))));
    const missing = [...codes].filter((code) => !(code in Strings.T));

    // each pattern must still find what it was written for
    for (const code of ['impostorVerifiedBot', 'impostorPartner', 'unidentified']) assert.ok(codes.has(code), code);
    assert.deepEqual(missing, []);
});

test('a report speaks in the third person and leaves the user\'s contacts out', () => {
    const friend = { steamId: '76561198000000301', name: 'Kiro' };
    const evidence = Strings.reportEvidence([
        { level: 'danger', code: 'impostorFriend', contact: friend, impersonates: true, sameName: true, sameAvatar: true },
        { level: 'warning', code: 'recentFriend' },
        { level: 'warning', code: 'sharedIdentity', contact: { steamId: '2', name: 'Other friend' } },
        { level: 'warning', code: 'newAccount', value: 3 },
        { level: 'info', code: 'isFriend' }
    ]);

    assert.deepEqual(evidence, [
        'Uses the same name and avatar as another account: "Kiro" (76561198000000301).',
        'New account: created 3 day(s) ago.'
    ]);
});

test('a finding stays out of a report until it has public wording', () => {
    const evidence = Strings.reportEvidence([
        { level: 'warning', code: 'verifiedBotRenamed', listedName: 'STN Trading Bot #2' },
        { level: 'warning', code: 'formerlyNamedLike', contact: { steamId: '1', name: 'Kiro' }, formerName: 'Kiro' },
        { level: 'warning', code: 'somethingNew' },
        { level: 'warning', code: 'nameHasSteamId' }
    ]);

    assert.deepEqual(evidence, ['Its name contains a SteamID64, to pass for another account.']);
});

test('reportText lays out who, whom and what for a report form', () => {
    const text = Strings.reportText({
        scammer: { steamId: '76561199950000042', name: 'Kiro' },
        impersonated: { steamId: '76561198000000301', name: 'Kiro' },
        evidence: ['Uses the same name as another account', 'New account'],
        offerId: '7001',
        when: new Date('2026-10-29T12:00:00Z')
    });
    const lines = text.split(String.fromCharCode(10));

    assert.equal(lines[0], 'Scam attempt report');
    assert.ok(lines.includes('Scammer: "Kiro" (SteamID64 76561199950000042) https://steamcommunity.com/profiles/76561199950000042'));
    assert.ok(lines.includes('Impersonating: "Kiro" (SteamID64 76561198000000301) https://steamcommunity.com/profiles/76561198000000301'));
    assert.ok(lines.includes('Trade offer: 7001'));
    assert.ok(lines.includes('Date: 2026-10-29'));
    assert.ok(lines.includes('- New account'));

    const minimal = Strings.reportText({
        scammer: { steamId: '1', name: 'x' }, impersonated: null, evidence: [], when: new Date()
    });
    assert.ok(!minimal.includes('Impersonating') && !minimal.includes('Trade offer'));
});

test('the confirmation reminder never invents a name', () => {
    assert.match(Strings.T.confirmReminder('Kiro', '2 year(s) old'), /must show "Kiro" and an account that's 2 year\(s\) old/);
    assert.match(Strings.T.confirmReminder('', 'about 2 year(s) old'), /must show an account that's about 2 year\(s\) old/);
    assert.doesNotMatch(Strings.T.confirmReminder('', null), /must show "/);
});
