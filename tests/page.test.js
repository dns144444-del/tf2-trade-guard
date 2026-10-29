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

// Routing

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

// Inline scripts

test('reads the logged-in account and the trade partner from inline scripts', () => {
    const scripts = [...load('trade-window.html').querySelectorAll('script')].map((s) => s.textContent).join('\n');

    assert.equal(Page.selfSteamId(scripts), SELF);
    assert.equal(Page.tradePartnerId(scripts), KIRO);
    assert.equal(Page.selfSteamId('g_steamID = false;'), null); // logged out
    assert.equal(Page.tradePartnerId(''), null);
});

// Friends

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

// Offer lists

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

// Trade window

test('theirTradeItems lists the partner side only, with each item\'s game and context', () => {
    assert.deepEqual(Page.theirTradeItems(load('trade-window.html')), [
        { appid: '440', contextid: '2', assetid: '9000000002' },
        { appid: '440', contextid: '2', assetid: '9000000003' },
        { appid: '730', contextid: '2', assetid: '9000000004' }
    ]);
});

test('escrowDays reads the trade hold of each side', () => {
    const scripts = [...load('trade-window.html').querySelectorAll('script')].map((s) => s.textContent).join('\n');

    assert.deepEqual(Page.escrowDays(scripts), { mine: 0, theirs: 0 });
    assert.deepEqual(Page.escrowDays('var g_daysMyEscrow = 0;\nvar g_daysTheirEscrow = 15;'), { mine: 0, theirs: 15 });
    assert.equal(Page.escrowDays('var g_daysMyEscrow = 0;'), null); // half the answer is no answer
});

// Signing in through Steam

test('route reads the site of a sign-in, signed in or at the password form', () => {
    const query = '?openid.realm=https%3A%2F%2Fbackpack.tf%2F&openid.return_to=https%3A%2F%2Fbackpack.tf%2Flogin%2F';
    const expected = { kind: 'login', realm: 'https://backpack.tf/', returnTo: 'https://backpack.tf/login/', ambiguous: false };

    assert.deepEqual(Page.route('/openid/login', query), expected);
    // signed out, Steam moves the whole request into ?goto= (this shape is copied from a real redirect)
    assert.deepEqual(Page.route('/openid/loginform/', `?goto=${encodeURIComponent(`/openid/login${query}`)}`), expected);
    assert.deepEqual(Page.route('/openid/loginform/'), { kind: 'login', realm: null, returnTo: null, ambiguous: false });
});

test('route marks a sign-in request that could be read two ways as ambiguous', () => {
    const ok = '?openid.realm=https%3A%2F%2Fbackpack.tf%2F&openid.return_to=https%3A%2F%2Fbackpack.tf%2Flogin%2F';
    const ambiguous = (pathname, search) => Page.route(pathname, search).ambiguous;

    // PHP reads a repeated parameter as its last value, and "openid_return_to" as "openid.return_to"
    assert.equal(ambiguous('/openid/login', `${ok}&openid.return_to=https%3A%2F%2Fevil.example%2F`), true);
    assert.equal(ambiguous('/openid/login', `${ok}&openid.realm=https%3A%2F%2Fevil.example%2F`), true);
    assert.equal(ambiguous('/openid/login', `${ok}&openid_return_to=https%3A%2F%2Fevil.example%2F`), true);

    // the password form only ever forwards to Steam's own sign-in step, and only once
    const goto = (target) => `?goto=${encodeURIComponent(target)}`;
    assert.equal(ambiguous('/openid/loginform/', goto(`https://evil.example/openid/login${ok}`)), true);
    assert.equal(ambiguous('/openid/loginform/', goto('/somewhere/else')), true);
    assert.equal(ambiguous('/openid/loginform/', `${goto(`/openid/login${ok}`)}&goto=%2Fx`), true);
    assert.equal(ambiguous('/openid/login', ok), false);
});

test('route only asks for the report guide on a profile, with a nonce', () => {
    const nonce = '0123456789abcdef0123456789abcdef';

    assert.deepEqual(Page.route('/profiles/76561198000000301/', '', `#tradeguard-report-${nonce}`).reportGuide,
        { steamId: '76561198000000301', nonce });
    assert.equal(Page.route('/profiles/76561198000000301/', '', '#tradeguard-report').reportGuide, null);
    assert.equal(Page.route('/id/someone/', '', `#tradeguard-report-${nonce}`).reportGuide, null);
    assert.equal(Page.route('/groups/x', '', `#tradeguard-report-${nonce}`).reportGuide, null);
});

test('escrowDays only trusts Steam\'s own variable lines, not text that looks like them', () => {
    const forged = 'g_strTradePartnerPersonaName = "STN Bot g_daysTheirEscrow=0";\n    var g_daysMyEscrow = 0;\n' +
        '    var g_daysTheirEscrow = 15;';

    assert.deepEqual(Page.escrowDays(forged), { mine: 0, theirs: 15 });
});

test('economyItem reads the item tags offer lists use', () => {
    assert.deepEqual(Page.economyItem('classinfo/440/101785959/11040578'), { appid: '440', classid: '101785959', instanceid: '11040578' });
    assert.deepEqual(Page.economyItem('classinfo/730/5'), { appid: '730', classid: '5', instanceid: '0' });
    assert.equal(Page.economyItem('https://community.fastly.steamstatic.com/economy/image/x'), null);
});

// Comments

test('commentParts takes the author name, not the avatar link that comes first', () => {
    const [phish] = load('comments.html').querySelectorAll('.commentthread_comment');
    const parts = Page.commentParts(phish);

    assert.equal(parts.author, 'Steam Support');
    assert.equal(Core.impersonatesStaff(parts.author), true);
    assert.deepEqual(parts.hrefs, ['https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fsteamcommunlty.com%2Flogin']);
    assert.equal(Core.analyzeText(parts.text, parts.hrefs)[0].code, 'phishingLink');
});

test('commentParts knows who wrote each comment', () => {
    const [phish, normal] = load('comments.html').querySelectorAll('.commentthread_comment');

    assert.equal(Page.commentParts(phish).authorId, '76561198000000401');
    assert.equal(Page.commentParts(normal).authorId, KIRO);
});

test('commentWall reads a public comment area and recognizes a hidden one', () => {
    const wall = Page.commentWall(parseHTML(`<div class="commentthread_area">${fixture('comments.html')}</div>`).document);

    assert.equal(wall.hidden, false);
    assert.deepEqual(wall.comments.map((c) => c.authorId), ['76561198000000401', KIRO]);

    // a private profile's /allcomments page has no comment area at all
    const hidden = Page.commentWall(parseHTML('<div class="profile_private_info">This profile is private.</div>').document);
    assert.deepEqual(hidden, { hidden: true, comments: [] });
});

test('commentParts leaves ordinary comments unflagged and skips deleted ones', () => {
    const [, normal, deleted] = load('comments.html').querySelectorAll('.commentthread_comment');
    const parts = Page.commentParts(normal);

    assert.equal(parts.author, 'Kiro');
    assert.equal(Core.impersonatesStaff(parts.author), false);
    assert.deepEqual(Core.analyzeText(parts.text, parts.hrefs), []);
    assert.equal(Page.commentParts(deleted), null);
});
