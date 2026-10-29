'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Strings } = require('../tf2-trade-guard.user.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'tf2-trade-guard.user.js'), 'utf8');

test('every finding the script can raise has text for the panel', () => {
    const codes = new Set([...SOURCE.matchAll(/\bcode: '([A-Za-z]+)'/g)].map((m) => m[1]));
    const missing = [...codes].filter((code) => !(code in Strings.T));

    assert.ok(codes.size > 40, `only found ${codes.size} codes`);
    assert.deepEqual(missing, []);
});

test('a report speaks in the third person and leaves the user\'s contacts out', () => {
    const friend = { steamId: '76561198000000301', name: 'Kiro' };
    const evidence = Strings.reportEvidence([
        { level: 'danger', code: 'impostorFriend', contact: friend, impersonates: friend, sameName: true, sameAvatar: true },
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

test('the confirmation reminder never invents a name', () => {
    assert.match(Strings.T.confirmReminder('Kiro', '2 year(s) old'), /must show "Kiro" and an account that's 2 year\(s\) old/);
    assert.match(Strings.T.confirmReminder('', 'about 2 year(s) old'), /must show an account that's about 2 year\(s\) old/);
    assert.doesNotMatch(Strings.T.confirmReminder('', null), /must show "/);
});
