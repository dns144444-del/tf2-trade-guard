'use strict';

// Page reads Steam's markup. These tests run it on HTML fixtures (tests/fixtures/) through a small
// DOM implementation, so a change to a selector shows up here instead of on a live trade.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const { Core, Page } = require('../tf2-trade-guard.user.js');

const SELF = '76561198000000001';
const KIRO = '76561198000000301';
const BOT = '76561198000000302';

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function load(name) {
    return parseHTML(fixture(name)).document;
}

const cp = (...codes) => String.fromCodePoint(...codes);

// ----- routing -----

test('route recognizes offer lists, their sent and history views', () => {
    assert.deepEqual(Page.route('/id/someone/tradeoffers/'), { kind: 'offerList', isSent: false, isHistory: false });
    assert.deepEqual(Page.route('/profiles/76561198000000001/tradeoffers/sent/'),
        { kind: 'offerList', isSent: true, isHistory: false });
    assert.deepEqual(Page.route('/id/someone/tradeoffers/', '?history=1'),
        { kind: 'offerList', isSent: false, isHistory: true });
    assert.deepEqual(Page.route('/id/someone/tradeoffers'), { kind: 'offerList', isSent: false, isHistory: false });
});

test('route recognizes new and received offers in the trade window', () => {
    assert.deepEqual(Page.route('/tradeoffer/new/', '?partner=39734573&token=abc'), { kind: 'tradeWindow', offerId: null });
    assert.deepEqual(Page.route('/tradeoffer/5001/'), { kind: 'tradeWindow', offerId: '5001' });
});

test('route leaves other pages alone', () => {
    for (const pathname of ['/', '/id/someone/', '/id/someone/tradeoffers/privacy', '/tradeoffer/new/send', '/market/']) {
        assert.equal(Page.route(pathname).kind, 'other', pathname);
    }
});

test('comments are checked everywhere except forum threads', () => {
    assert.equal(Page.wantsCommentCheck('/id/someone/'), true);
    assert.equal(Page.wantsCommentCheck('/groups/somegroup'), true);
    assert.equal(Page.wantsCommentCheck('/app/440/discussions/0/123/'), false);
});

// ----- inline scripts -----

test('reads the logged-in account and the trade partner from inline scripts', () => {
    const scripts = [...load('trade-window.html').querySelectorAll('script')].map((s) => s.textContent).join('\n');

    assert.equal(Page.selfSteamId(scripts), SELF);
    assert.equal(Page.tradePartnerId(scripts), KIRO);
    assert.equal(Page.selfSteamId('g_steamID = false;'), null); // logged out
    assert.equal(Page.tradePartnerId(''), null);
});

// ----- friends -----

test('parseFriends reads SteamIDs, names without the status line, and avatars', () => {
    const friends = Page.parseFriends(load('friends.html'));

    assert.deepEqual(friends.map((f) => f.steamId), [KIRO, BOT, '76561198000000303']);
    assert.deepEqual(friends.map((f) => f.name), ['Kiro', 'Mann Co. Bot #2', `Pyr${cp(0x043E)}cat & co`]);
    assert.equal(friends[0].avatarHash, 'a'.repeat(40));
    assert.equal(friends[1].avatarHash, null); // Steam's default avatar proves nothing
    assert.ok(friends.every((f) => f.source === 'friend'));
});

test('parseFriends keeps lookalike letters for the impostor checks to find', () => {
    const [, , pyrocat] = Page.parseFriends(load('friends.html'));

    assert.equal(Core.compareNames(pyrocat.name, 'Pyrocat & co'), 'lookalike');
});

// ----- offer lists -----

test('parseOfferList reads a pending offer: partner, items per side, message', () => {
    const [offer] = Page.parseOfferList(load('offers.html'), false, SELF);

    assert.equal(offer.offerId, '5001');
    assert.equal(offer.partnerId, KIRO);
    assert.match(offer.partnerAvatar, /a{40}_medium\.jpg$/);
    assert.deepEqual(offer.get, ['classinfo/440/8092858113/74041787', 'classinfo/440/101785959/11040578']);
    assert.deepEqual(offer.give, ['classinfo/440/2674/0']);
    assert.equal(offer.message.replace(/\s+/g, ' '), 'is this your item? check backpack.tf');
    assert.deepEqual(offer.messageLinks, ['https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fbackpack-tf.com%2Fitem']);
});

test('parseOfferList swaps the sides for sent offers', () => {
    const [offer] = Page.parseOfferList(load('offers.html'), true, SELF);

    assert.deepEqual(offer.give, ['classinfo/440/8092858113/74041787', 'classinfo/440/101785959/11040578']);
    assert.deepEqual(offer.get, ['classinfo/440/2674/0']);
});

test('parseOfferList finds the partner of a held offer even when the user is listed first', () => {
    const [, held] = Page.parseOfferList(load('offers.html'), false, SELF);

    assert.equal(held.partnerId, BOT);
    assert.match(held.partnerAvatar, /e{40}\.jpg$/);
    assert.deepEqual(held.get, ['https://community.fastly.steamstatic.com/economy/image/scrap/96fx96f']); // no item tag
    assert.equal(held.message, '');
});

test('parseOfferList reports an unidentified partner instead of guessing', () => {
    const [, , unknown] = Page.parseOfferList(load('offers.html'), false, SELF);

    assert.equal(unknown.partnerId, null);
    assert.deepEqual(unknown.get, []);
});

test('a parsed offer message feeds the phishing checks', () => {
    const [offer] = Page.parseOfferList(load('offers.html'), false, SELF);
    const findings = Core.analyzeText(offer.message, offer.messageLinks, { unknownLinks: true });

    assert.deepEqual(findings.map((f) => f.code), ['phishingLink', 'scamPhrase']);
    assert.equal(findings[0].links[0].imitates, 'backpack.tf');
});

// ----- trade window -----

test('theirTradeAssetIds lists the partner side only, with null for other games', () => {
    assert.deepEqual(Page.theirTradeAssetIds(load('trade-window.html')), ['9000000002', '9000000003', null]);
});

// ----- comments -----

test('commentParts takes the author name, not the avatar link that comes first', () => {
    const [phish] = load('comments.html').querySelectorAll('.commentthread_comment');
    const parts = Page.commentParts(phish);

    assert.equal(parts.author, 'Steam Support');
    assert.equal(Core.impersonatesStaff(parts.author), true);
    assert.deepEqual(parts.hrefs, ['https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fsteamcommunlty.com%2Flogin']);
    assert.equal(Core.analyzeText(parts.text, parts.hrefs)[0].code, 'phishingLink');
});

test('commentParts leaves ordinary comments unflagged and skips deleted ones', () => {
    const [, normal, deleted] = load('comments.html').querySelectorAll('.commentthread_comment');
    const parts = Page.commentParts(normal);

    assert.equal(parts.author, 'Kiro');
    assert.equal(Core.impersonatesStaff(parts.author), false);
    assert.deepEqual(Core.analyzeText(parts.text, parts.hrefs), []);
    assert.equal(Page.commentParts(deleted), null);
});
