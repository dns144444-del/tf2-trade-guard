'use strict';

// Runs the whole userscript, as Tampermonkey would, on a fixture page with Steam's responses served
// from fixtures. It catches what unit tests can't: a broken reference in the browser layer, a
// request to the wrong place, or a panel that never renders.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML, DOMParser } = require('linkedom');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'tf2-trade-guard.user.js'), 'utf8');
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const SELF = '76561198000000001';
const KIRO = '76561198000000301';
const NONCE = '0123456789abcdef0123456789abcdef';

// a partner's public profile, as Steam's ?xml=1 returns it
const profileXml = (name, steamId) => `<?xml version="1.0" encoding="UTF-8"?>
<profile>
  <steamID64>${steamId}</steamID64>
  <steamID><![CDATA[${name}]]></steamID>
  <privacyState>public</privacyState>
  <tradeBanState>None</tradeBanState>
  <isLimitedAccount>0</isLimitedAccount>
  <memberSince>March 3, 2015</memberSince>
  <avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_full.jpg]]></avatarFull>
</profile>`;

// Kiro's public TF2 inventory: a hat renamed to look Unusual, and refined metal
const INVENTORY = JSON.stringify({
    success: 1,
    assets: [
        { assetid: '9000000002', classid: '1', instanceid: '0' },
        { assetid: '9000000003', classid: '2', instanceid: '0' }
    ],
    descriptions: [
        {
            classid: '1',
            instanceid: '0',
            name: "''Unusual Burning Flames Team Captain''",
            market_hash_name: 'Team Captain',
            fraudwarnings: ['This item has been renamed.']
        },
        { classid: '2', instanceid: '0', name: 'Refined Metal', market_hash_name: 'Refined Metal' }
    ]
});

const NO_KEY_PAGE = '<form action="https://steamcommunity.com/dev/registerkey"><input id="domain"></form>';
const KEY_PAGE = '<p>Key: 0123456789ABCDEF0123456789ABCDEF</p><p>Domain Name: scam-site.example</p>' +
    '<form action="https://steamcommunity.com/dev/revokekey"></form>';

// a logged-in page with nothing for Trade Guard to check besides the API key, and a signed-out one
const PLAIN_PAGE = `<html><head><script>g_steamID = "${SELF}";</script></head><body></body></html>`;
const SIGNED_OUT_PAGE = '<html><head><script>g_steamID = false;</script></head><body></body></html>';

// the trade window of a "bot" whose items would be held: its owner has no mobile authenticator
const HELD_BOT_WINDOW = fixture('trade-window.html').replace('g_daysTheirEscrow = 0', 'g_daysTheirEscrow = 15');

// the incoming offers, signed in: Kiro's pending offer with a fake link, a held offer, and one with no partner
const OFFERS_PAGE = `<html><head><script>g_steamID = "${SELF}";</script></head><body>${fixture('offers.html')}</body></html>`;

// an offer in the user's history from an account they don't know, with exactly the items of Kiro's offer
const COPIED_OFFER = `<div class="tradeoffer" id="tradeofferid_4001">
  <div class="tradeoffer_partner"><div class="playerAvatar" data-miniprofile="39734576">
    <a href="https://steamcommunity.com/profiles/76561198000000304"><img src="x_medium.jpg"></a>
  </div></div>
  <div class="tradeoffer_items_ctn inactive">
    <div class="tradeoffer_items primary"><div class="tradeoffer_item_list">
      <div class="trade_item" data-economy-item="classinfo/440/8092858113/74041787"></div>
      <div class="trade_item" data-economy-item="classinfo/440/101785959/11040578"></div>
    </div></div>
    <div class="tradeoffer_items secondary"><div class="tradeoffer_item_list">
      <div class="trade_item" data-economy-item="classinfo/440/2674/0"></div>
    </div></div>
  </div>
</div>`;

// What each same-origin request gets; anything else fails, like a Steam error would.
// profileName: null makes the partner's profile fail to load; offerHistory: the user's past received offers.
function steamResponses({ apiKeyPage, profileName, offerHistory }) {
    return [
        [/^\/dev\/apikey/, apiKeyPage],
        [/^\/my\/friends\//, fixture('friends.html')],
        [/^\/profiles\/\d+\/\?xml=1/, profileName === null ? null : (url) => profileXml(profileName, url.split('/')[2])],
        [/^\/profiles\/\d+\/ajaxaliases\//, '[]'],
        [/^\/profiles\/\d+\/tradeoffers\/\?history=1/, offerHistory],
        [/^\/profiles\/\d+\/tradeoffers\/sent\//, '<div></div>'],
        [/^\/inventory\/76561198000000301\/440\/2/, INVENTORY]
    ].filter(([, body]) => body !== null);
}

// page: a fixture name or raw HTML
// options: { pathname, search, hash } of the page, Steam's answers ({ apiKeyPage, profileName, offerHistory }),
// values already stored, answers to prompt() and confirm(), and `until` (a selector) or `settle` (ms) to wait
async function runOn(page, options) {
    const defaults = {
        search: '', hash: '', apiKeyPage: NO_KEY_PAGE, profileName: 'Kiro', offerHistory: '<div></div>', stored: {}, settle: 0
    };
    const settings = { ...defaults, ...options };
    const { window, document } = parseHTML(page.endsWith('.html') ? fixture(page) : page);
    const responses = steamResponses(settings);
    const storage = new Map(Object.entries(settings.stored));
    const run = { document, requests: [], storage, clipboard: [], menu: [], opened: [] };
    let styles = 0;

    window.open = (url) => run.opened.push(url);

    vm.runInNewContext(SCRIPT, {
        window,
        document,
        location: {
            pathname: settings.pathname,
            search: settings.search,
            hash: settings.hash,
            href: `https://steamcommunity.com${settings.pathname}${settings.search}${settings.hash}`
        },
        DOMParser,
        MutationObserver: window.MutationObserver || class { observe() {} },
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        setTimeout,
        setInterval: () => 0,
        console: { log() {} },
        crypto: globalThis.crypto,
        TextEncoder,
        URL,
        URLSearchParams,
        history: { replaceState() {} },
        prompt: () => settings.promptAnswer ?? null,
        confirm: () => settings.confirmAnswer ?? false,
        alert: () => {},
        GM_getValue: (key, fallback) => (run.storage.has(key) ? run.storage.get(key) : fallback),
        GM_setValue: (key, value) => run.storage.set(key, value),
        GM_listValues: () => [...run.storage.keys()],
        GM_deleteValue: (key) => run.storage.delete(key),
        GM_addStyle: () => { styles += 1; },
        GM_registerMenuCommand: (name, action) => run.menu.push({ name, action }),
        GM_setClipboard: (text) => run.clipboard.push(text),
        fetch: async (url) => {
            const target = String(url);
            run.requests.push(target);
            const match = responses.find(([pattern]) => pattern.test(target));
            if (!match) return { ok: false, status: 404, url: target, text: async () => '' };

            const body = typeof match[1] === 'function' ? match[1](target) : match[1];
            return { ok: true, status: 200, url: `https://steamcommunity.com${target}`, text: async () => body };
        }
    });

    // the checks run asynchronously; wait until the expected result shows up
    for (let i = 0; i < 100 && settings.until && !document.querySelector(settings.until); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, settings.settle));

    run.styles = () => styles;
    run.menuAction = (name) => run.menu.find((entry) => entry.name === name).action();
    return run;
}

// values from the script's own realm are compared as JSON
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

// The trade window

test('the trade window gets a panel for the partner, and only same-origin requests are made', async () => {
    const { document, requests } = await runOn('trade-window.html', { pathname: '/tradeoffer/new/', until: '.tg-panel[data-level]' });
    const panel = document.querySelector('.tg-panel');

    assert.match(panel.textContent, /SteamID64: 76561198000000301/);
    assert.match(panel.textContent, /"Kiro"/);
    assert.match(panel.textContent, /on your friends list/);

    // relative paths only: every request goes to the page's own origin, steamcommunity.com
    assert.ok(requests.length > 0);
    assert.deepEqual(requests.filter((url) => !url.startsWith('/')), []);
});

test('the trade window flags a fake Unusual the partner adds, reading each game\'s inventory once', async () => {
    const { document, requests } = await runOn('trade-window.html', { pathname: '/tradeoffer/new/', until: '.tg-report' });
    const panel = document.querySelector('.tg-panel');
    const findings = [...panel.querySelectorAll('li')].map((li) => li.textContent);

    assert.match(document.querySelector('.tg-counts').textContent, /^You give 1 item\(s\) . You get 3 item\(s\)$/);
    assert.match(findings[0], /"Team Captain" renamed ''Unusual Burning Flames Team Captain''/);
    assert.ok(findings.some((text) => /couldn't check every item/.test(text))); // the CS2 inventory isn't served

    // a verdict the items turned red gets the same level, verdict and report buttons as any other
    assert.equal(panel.dataset.level, 'danger');
    assert.ok(panel.classList.contains('tg-danger'));
    assert.equal(panel.querySelector('.tg-verdict').textContent, 'DANGER: likely scam');

    // two TF2 items share one request; the failing CS2 inventory is tried once, not once per item
    const inventories = requests.filter((url) => url.startsWith('/inventory/')).map((url) => url.split('?')[0]);
    assert.deepEqual(inventories.sort(), [`/inventory/${KIRO}/440/2`, `/inventory/${KIRO}/730/2`]);
});

test('a "bot" whose items would be held is flagged, with buttons to report it', async () => {
    const run = await runOn(HELD_BOT_WINDOW, { pathname: '/tradeoffer/new/', profileName: 'STN Trading Bot #3', until: '.tg-report' });
    const panel = run.document.querySelector('.tg-panel');
    const buttons = [...panel.querySelectorAll('.tg-report button')];

    assert.equal(panel.dataset.level, 'danger');
    assert.match(panel.textContent, /Calls itself a bot, but this trade would be held 15 day\(s\)/);
    assert.deepEqual(buttons.map((b) => b.textContent), ['Copy report', 'Steam', 'backpack.tf']);

    buttons[0].click();
    assert.match(run.clipboard[0], /^Scam attempt report/);
    assert.match(run.clipboard[0], /Scammer: "STN Trading Bot #3" \(SteamID64 76561198000000301\)/);
    assert.match(run.clipboard[0], /- Calls itself a bot/);
    assert.doesNotMatch(run.clipboard[0], /friend/i); // a public report never says who the user's friends are
    assert.equal(buttons[0].textContent, 'Report copied');

    // the Steam button copies too, and leaves a one-time nonce for the guide on that profile
    buttons[1].click();
    const pending = run.storage.get('pendingReport');
    assert.equal(run.clipboard.length, 2);
    assert.equal(pending.steamId, KIRO);
    assert.deepEqual(run.opened, [`https://steamcommunity.com/profiles/${KIRO}/#tradeguard-report-${pending.nonce}`]);
});

test('the trade window tells what the Steam confirmation must show, and never prints "null"', async () => {
    const { document } = await runOn('trade-window.html', { pathname: '/tradeoffer/new/', until: '.tg-confirm' });
    const panel = document.querySelector('.tg-panel');

    assert.match(document.querySelector('.tg-confirm').textContent,
        /the confirmation must show "Kiro" and an account that's 11 year\(s\) old/);
    assert.doesNotMatch(panel.textContent, /null|undefined/);
});

test('a trade window whose hold times can\'t be read says so', async () => {
    const page = fixture('trade-window.html').replace('var g_daysTheirEscrow = 0;', '');
    const { document } = await runOn(page, { pathname: '/tradeoffer/new/', until: '.tg-confirm' });

    assert.match(document.querySelector('.tg-panel').textContent, /Couldn't read this trade's hold times/);
});

// Offer lists

test('the offer list checks each offer: a copied offer, a fake link, and a partner it can\'t identify', async () => {
    const run = await runOn(OFFERS_PAGE, {
        pathname: `/profiles/${SELF}/tradeoffers/`,
        offerHistory: COPIED_OFFER,
        until: '#tradeofferid_5003 .tg-panel li'
    });
    const panel = (id) => run.document.querySelector(`#tradeofferid_${id} .tg-panel`);

    assert.equal(panel('5001').dataset.level, 'danger');
    assert.match(panel('5001').textContent, /Link to a FAKE site: backpack-tf\.com \(imitates backpack\.tf\)/);
    assert.match(panel('5001').textContent, /Another account \(76561198000000304\) recently had an offer with exactly/);
    assert.ok(panel('5001').querySelector('.tg-report'));
    assert.match(panel('5003').textContent, /couldn't identify the other account/);

    // the history is read once for the whole list, not once per offer
    assert.equal(run.requests.filter((url) => url.endsWith('/tradeoffers/?history=1')).length, 1);
});

test('without a profile, the reminder doesn\'t make up a name', async () => {
    const { document } = await runOn('trade-window.html', { pathname: '/tradeoffer/new/', profileName: null, until: '.tg-confirm' });
    const reminder = document.querySelector('.tg-confirm').textContent;

    assert.doesNotMatch(reminder, /7656/);
    assert.match(reminder, /must show an account that's about \d+ year\(s\) old/);
    assert.match(document.querySelector('.tg-panel').textContent, /Couldn't load this account's profile/);
});

test('verified bots added from the menu catch a copy on first contact', async () => {
    const menu = await runOn(PLAIN_PAGE, { pathname: '/id/someone/', settle: 50 });
    menu.menuAction('Verified bots');

    const dialog = menu.document.querySelector('#tg-dialog');
    dialog.querySelector('textarea').value = '76561198000000302 STN Trading Bot #2';
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Add').click();

    const saved = menu.storage.get('verifiedBots');
    same(saved.map((b) => [b.steamId, b.name]), [['76561198000000302', 'STN Trading Bot #2']]);
    assert.match(dialog.textContent, /1 bot\(s\) added/);

    // another account trading under that name is flagged, even though it's on the friends list:
    // a friend suddenly named like a verified bot is more likely a stolen account
    const copy = await runOn('trade-window.html', {
        pathname: '/tradeoffer/new/',
        profileName: 'STN Trading Bot #2',
        stored: { verifiedBots: saved },
        until: '.tg-panel[data-level]'
    });
    const panel = copy.document.querySelector('.tg-panel');

    assert.equal(panel.dataset.level, 'danger');
    assert.match(panel.textContent, /Impersonating the verified bot "STN Trading Bot #2"/);
});

// The API key

test('a registered API key puts a banner on the page, without storing the key', async () => {
    const { document, storage } = await runOn(PLAIN_PAGE, { pathname: '/id/someone/', apiKeyPage: KEY_PAGE, until: '#tg-api-banner' });
    const banner = document.querySelector('#tg-api-banner');

    assert.match(banner.textContent, /domain: scam-site\.example/);
    assert.match(banner.textContent, /ending in …CDEF/);
    assert.equal(JSON.stringify([...storage.values()]).includes('0123456789ABCDEF0123456789ABCDEF'), false);
});

test('a page without a trade UI and without an API key is left untouched', async () => {
    const { document, requests } = await runOn(PLAIN_PAGE, { pathname: '/id/someone/', settle: 200 });

    assert.ok(requests.includes('/dev/apikey'), 'the API key was not checked');
    assert.equal(document.querySelector('.tg-panel'), null);
    assert.equal(document.querySelector('#tg-api-banner'), null);
});

test('a logged-out page is left alone entirely', async () => {
    const { requests } = await runOn('friends.html', { pathname: '/id/someone/friends/', settle: 100 });

    assert.deepEqual(requests, []);
});

// Signing in through Steam

const signIn = (realm, returnTo) => `?openid.realm=${encodeURIComponent(realm)}&openid.return_to=${encodeURIComponent(returnTo)}`;

test('the sign-in page names the site, warns about a fake one, and shows the phrase while signed out', async () => {
    const fake = `/openid/login${signIn('https://backpack-tf.com/', 'https://backpack-tf.com/login')}`;
    const { document } = await runOn(SIGNED_OUT_PAGE, {
        pathname: '/openid/loginform/',
        search: `?goto=${encodeURIComponent(fake)}`,
        stored: { secretPhrase: 'blue falcon 42' },
        until: '#tg-login-banner'
    });
    const banner = document.querySelector('#tg-login-banner');

    assert.ok(banner.classList.contains('tg-danger'));
    assert.match(banner.textContent, /You're signing in to backpack-tf\.com/);
    assert.match(banner.textContent, /FAKE SITE: this imitates backpack\.tf/);
    assert.equal(banner.querySelector('.tg-phrase').textContent, 'blue falcon 42');
});

test('the sign-in page reassures on a known site and suggests a phrase when there is none', async () => {
    const { document } = await runOn(PLAIN_PAGE, {
        pathname: '/openid/login',
        search: signIn('https://backpack.tf/', 'https://backpack.tf/login/'),
        until: '#tg-login-banner'
    });
    const banner = document.querySelector('#tg-login-banner');

    assert.ok(banner.classList.contains('tg-ok'));
    assert.match(banner.textContent, /A well-known trading site/);
    assert.match(banner.textContent, /set a secret phrase/);
});

test('a sign-in request with a second return address is red, not green', async () => {
    const { document } = await runOn(SIGNED_OUT_PAGE, {
        pathname: '/openid/login',
        search: `${signIn('https://backpack.tf/', 'https://backpack.tf/login/')}&openid.return_to=https%3A%2F%2Fevil.example%2F`,
        until: '#tg-login-banner'
    });

    assert.ok(document.querySelector('#tg-login-banner').classList.contains('tg-danger'));
    assert.match(document.querySelector('#tg-login-banner').textContent, /FAKE OR BROKEN SIGN-IN/);
});

test('signed in, the sign-in page still shows a registered API key', async () => {
    const { document } = await runOn(PLAIN_PAGE, {
        pathname: '/openid/login',
        search: signIn('https://backpack.tf/', 'https://backpack.tf/login/'),
        apiKeyPage: KEY_PAGE,
        until: '#tg-api-banner'
    });

    assert.ok(document.querySelector('#tg-login-banner'));
    assert.ok(document.querySelector('#tg-api-banner'));
});

// The report guide

const reportGuide = (options) => runOn(PLAIN_PAGE, { pathname: `/profiles/${KIRO}/`, settle: 50, ...options });

test('the report guide answers only the report button Trade Guard just clicked', async () => {
    const pending = { steamId: KIRO, nonce: NONCE, at: Date.now() };
    const shown = await reportGuide({ hash: `#tradeguard-report-${NONCE}`, stored: { pendingReport: pending }, until: '#tg-report-guide' });
    const guide = shown.document.querySelector('#tg-report-guide');

    assert.match(guide.textContent, /choose "Report Player", then "Attempted Trade Scam"/);
    assert.equal(shown.storage.has('pendingReport'), false); // one use only
    guide.querySelector('button').click();
    assert.equal(shown.document.querySelector('#tg-report-guide'), null);
});

test('a link anyone can send never shows the report guide', async () => {
    const pending = { steamId: KIRO, nonce: NONCE, at: Date.now() };
    const cases = [
        { hash: `#tradeguard-report-${NONCE}` }, // nothing pending
        { hash: '#tradeguard-report', stored: { pendingReport: pending } }, // no nonce
        { hash: `#tradeguard-report-${'f'.repeat(32)}`, stored: { pendingReport: pending } }, // another nonce
        { hash: `#tradeguard-report-${NONCE}`, stored: { pendingReport: { ...pending, steamId: SELF } } }, // another account
        { hash: `#tradeguard-report-${NONCE}`, stored: { pendingReport: { ...pending, at: Date.now() - 10 * 60 * 1000 } } }
    ];

    for (const options of cases) {
        const { document } = await reportGuide(options);
        assert.equal(document.querySelector('#tg-report-guide'), null, JSON.stringify(options));
    }
});

// The secret phrase

test('the secret phrase shows on every panel, whatever it looks like', async () => {
    for (const phrase of ['blue falcon 42', '[TF2] blue falcon', '{falcon}']) {
        const { document } = await runOn('trade-window.html', {
            pathname: '/tradeoffer/new/',
            stored: { secretPhrase: phrase },
            until: '.tg-panel[data-level]'
        });

        assert.equal(document.querySelector('.tg-panel .tg-phrase').textContent, phrase);
    }
});

test('setting a phrase from the menu updates what is already on the page', async () => {
    const run = await runOn('trade-window.html', { pathname: '/tradeoffer/new/', promptAnswer: '  [TF2]   falcon ', until: '.tg-panel[data-level]' });
    assert.equal(run.document.querySelector('.tg-phrase'), null);

    run.menuAction('Set secret phrase');

    assert.equal(run.storage.get('secretPhrase'), '[TF2] falcon');
    assert.equal(run.document.querySelector('.tg-panel .tg-phrase').textContent, '[TF2] falcon');
});

// Menu and storage

test('the menu offers the checkup only when signed in, and its dialogs are styled either way', async () => {
    const signedIn = await runOn(PLAIN_PAGE, { pathname: '/id/someone/', settle: 50 });
    same(signedIn.menu.map((m) => m.name), ['Security checkup', 'Set secret phrase', 'Verified bots', 'Check for updates']);

    const signedOut = await runOn(SIGNED_OUT_PAGE, { pathname: '/id/someone/', settle: 50 });
    same(signedOut.menu.map((m) => m.name), ['Set secret phrase', 'Verified bots', 'Check for updates']);

    assert.equal(signedOut.styles(), 0);
    signedOut.menuAction('Verified bots');
    assert.equal(signedOut.styles(), 1);
    assert.ok(signedOut.document.querySelector('#tg-dialog'));
});

test('Forget everything keeps only when each friend was first seen', async () => {
    const seen = { baselineAt: 1, firstSeen: { [KIRO]: 1 } };
    const run = await runOn(PLAIN_PAGE, {
        pathname: '/id/someone/',
        confirmAnswer: true,
        stored: { [`${SELF}:friendsSeen`]: seen, [`${SELF}:partners`]: { x: {} }, secretPhrase: 'falcon', verifiedBots: [] },
        settle: 50
    });

    run.menuAction('Security checkup');
    [...run.document.querySelectorAll('#tg-dialog button')].find((b) => b.textContent === 'Forget everything').click();

    same([...run.storage.keys()], [`${SELF}:friendsSeen`]);
});
