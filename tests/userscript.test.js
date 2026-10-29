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

const KIRO = '76561198000000301';

// the partner's public profile, as Steam's ?xml=1 returns it
const profileXml = (name) => `<?xml version="1.0" encoding="UTF-8"?>
<profile>
  <steamID64>${KIRO}</steamID64>
  <steamID><![CDATA[${name}]]></steamID>
  <privacyState>public</privacyState>
  <tradeBanState>None</tradeBanState>
  <isLimitedAccount>0</isLimitedAccount>
  <memberSince>March 3, 2015</memberSince>
  <avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_full.jpg]]></avatarFull>
</profile>`;

// Kiro's public inventory: a hat renamed to look Unusual, and refined metal
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

// what each same-origin request gets; anything else fails, like a Steam error would
function steamResponses(apiKeyPage, profileName) {
    return [
        [/^\/dev\/apikey/, apiKeyPage],
        [/^\/my\/friends\//, fixture('friends.html')],
        [/^\/profiles\/\d+\/\?xml=1/, profileXml(profileName)],
        [/^\/profiles\/\d+\/ajaxaliases\//, '[]'],
        [/^\/inventory\/76561198000000301\/440\/2/, INVENTORY]
    ];
}

// a logged-in page with nothing for Trade Guard to check besides the API key
const PLAIN_PAGE = '<html><head><script>g_steamID = "76561198000000001";</script></head><body></body></html>';

// page: a fixture name or raw HTML
// options: the page's pathname and search, what Steam answers, values already stored, when to stop waiting
async function runOn(page, options) {
    const { pathname, search = '', hash = '', apiKeyPage = NO_KEY_PAGE, profileName = 'Kiro', stored = {} } = options;
    const { until, settle = 0 } = options;
    const { window, document } = parseHTML(page.endsWith('.html') ? fixture(page) : page);
    const responses = steamResponses(apiKeyPage, profileName);
    const requests = [];
    const storage = new Map(Object.entries(stored));
    const clipboard = [];
    const menu = [];
    const opened = [];

    window.open = (url) => opened.push(url);

    const context = {
        window,
        document,
        location: { pathname, search, hash, href: `https://steamcommunity.com${pathname}${search}${hash}` },
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
        GM_getValue: (key, fallback) => (storage.has(key) ? storage.get(key) : fallback),
        GM_setValue: (key, value) => storage.set(key, value),
        GM_listValues: () => [...storage.keys()],
        GM_deleteValue: (key) => storage.delete(key),
        GM_addStyle: () => {},
        GM_registerMenuCommand: (name, action) => menu.push({ name, action }),
        GM_setClipboard: (text) => clipboard.push(text),
        history: { replaceState() {} },
        fetch: async (url) => {
            const target = String(url);
            requests.push(target);
            const match = responses.find(([pattern]) => pattern.test(target));
            if (!match) return { ok: false, status: 404, url: target, text: async () => '' };
            return { ok: true, status: 200, url: `https://steamcommunity.com${target}`, text: async () => match[1] };
        }
    };

    vm.runInNewContext(SCRIPT, context);

    // the checks run asynchronously; wait until the expected result shows up
    for (let i = 0; i < 100 && until && !document.querySelector(until); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, settle));

    return { document, requests, storage, clipboard, menu, opened };
}

test('the trade window gets a panel for the partner, and only same-origin requests are made', async () => {
    const { document, requests } = await runOn('trade-window.html', {
        pathname: '/tradeoffer/new/',
        until: '.tg-panel[data-level]'
    });
    const panel = document.querySelector('.tg-panel');

    assert.ok(panel, 'no panel rendered');
    assert.match(panel.textContent, /SteamID64: 76561198000000301/);
    assert.match(panel.textContent, /"Kiro"/);
    assert.match(panel.textContent, /on your friends list/);

    // relative paths only: every request goes to the page's own origin, steamcommunity.com
    assert.ok(requests.length > 0);
    assert.deepEqual(requests.filter((url) => !url.startsWith('/')), []);
});

test('the trade window counts items and flags a fake Unusual the partner adds', async () => {
    const { document } = await runOn('trade-window.html', { pathname: '/tradeoffer/new/', until: '.tg-live li' });
    const panel = document.querySelector('.tg-panel');
    const live = [...document.querySelectorAll('.tg-live li')].map((li) => li.textContent);

    assert.match(document.querySelector('.tg-counts').textContent, /^You give 1 item\(s\) . You get 3 item\(s\)$/);
    assert.match(live[0], /named or described to look more valuable/);
    assert.match(live[0], /"Team Captain" renamed ''Unusual Burning Flames Team Captain''/);
    assert.match(live[1], /couldn't check every item/); // the CS2 item isn't in the TF2 inventory
    assert.ok(panel.classList.contains('tg-danger'));
    assert.equal(panel.querySelector('.tg-verdict').textContent, 'DANGER: likely scam');
});

test('a registered API key puts a banner on the page', async () => {
    const { document, storage } = await runOn(PLAIN_PAGE, {
        pathname: '/id/someone/',
        apiKeyPage: KEY_PAGE,
        until: '#tg-api-banner'
    });
    const banner = document.querySelector('#tg-api-banner');

    assert.ok(banner, 'no banner');
    assert.match(banner.textContent, /domain: scam-site\.example/);
    assert.match(banner.textContent, /ending in \u2026CDEF/);

    // only a fingerprint and the last 4 characters are kept, never the key itself
    const saved = JSON.stringify([...storage.values()]);
    assert.equal(saved.includes('0123456789ABCDEF0123456789ABCDEF'), false);
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

// ----- 0.8: trade holds, reports, secret phrase, sign-in guard, menu -----

// the trade window of a "bot" whose items would be held: its owner has no mobile authenticator
const HELD_BOT_WINDOW = fixture('trade-window.html').replace('g_daysTheirEscrow = 0', 'g_daysTheirEscrow = 15');

test('a "bot" whose items would be held is flagged, with buttons to report it', async () => {
    const { document, clipboard, opened } = await runOn(HELD_BOT_WINDOW, {
        pathname: '/tradeoffer/new/',
        profileName: 'STN Trading Bot #3',
        until: '.tg-report'
    });
    const panel = document.querySelector('.tg-panel');

    assert.equal(panel.dataset.level, 'danger');
    assert.match(panel.textContent, /Calls itself a bot, but this trade would be held 15 day\(s\)/);

    const buttons = [...panel.querySelectorAll('.tg-report button')];
    assert.deepEqual(buttons.map((b) => b.textContent), ['Copy report', 'Steam', 'backpack.tf']);

    buttons[0].click();
    assert.match(clipboard[0], /^Scam attempt report/);
    assert.match(clipboard[0], /Scammer: "STN Trading Bot #3" \(SteamID64 76561198000000301\)/);
    assert.match(clipboard[0], /- Calls itself a bot/);
    assert.equal(buttons[0].textContent, 'Report copied');

    // the Steam button copies too, then opens the profile where the report guide shows
    buttons[1].click();
    assert.equal(clipboard.length, 2);
    assert.deepEqual(opened, ['https://steamcommunity.com/profiles/76561198000000301/#tradeguard-report']);
});

test('a panel never shows "null" where an optional part is missing', async () => {
    const { document } = await runOn('trade-window.html', { pathname: '/tradeoffer/new/', until: '.tg-panel[data-level]' });
    const panel = document.querySelector('.tg-panel');

    assert.equal(panel.dataset.level, 'ok'); // no report row on a safe partner
    assert.doesNotMatch(panel.textContent, /null|undefined/);
});

test('the trade window tells what the Steam confirmation must show', async () => {
    const { document } = await runOn('trade-window.html', { pathname: '/tradeoffer/new/', until: '.tg-confirm' });

    assert.match(document.querySelector('.tg-confirm').textContent,
        /the confirmation must show "Kiro" and an account that's 11 year\(s\) old/);
    assert.equal(document.querySelector('.tg-report'), null); // nothing to report on a friend
});

test('the secret phrase shows on every panel', async () => {
    const { document } = await runOn('trade-window.html', {
        pathname: '/tradeoffer/new/',
        stored: { secretPhrase: 'blue falcon 42' },
        until: '.tg-panel[data-level]'
    });

    assert.equal(document.querySelector('.tg-panel .tg-phrase').textContent, 'blue falcon 42');
});

test('the sign-in page names the site, warns about a fake one, and shows the phrase while signed out', async () => {
    const signedOut = '<html><head><script>g_steamID = false;</script></head><body></body></html>';
    const fake = `/openid/login?openid.realm=${encodeURIComponent('https://backpack-tf.com/')}` +
        `&openid.return_to=${encodeURIComponent('https://backpack-tf.com/login')}`;

    const { document } = await runOn(signedOut, {
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
        search: '?openid.realm=https%3A%2F%2Fbackpack.tf%2F&openid.return_to=https%3A%2F%2Fbackpack.tf%2Flogin%2F',
        until: '#tg-login-banner'
    });
    const banner = document.querySelector('#tg-login-banner');

    assert.ok(banner.classList.contains('tg-ok'));
    assert.match(banner.textContent, /A well-known trading site/);
    assert.match(banner.textContent, /set a secret phrase/);
});

test('a profile opened from a report button explains how to report on Steam', async () => {
    const { document } = await runOn(PLAIN_PAGE, {
        pathname: '/profiles/76561198000000301/',
        hash: '#tradeguard-report',
        until: '#tg-report-guide'
    });
    const guide = document.querySelector('#tg-report-guide');

    assert.match(guide.textContent, /choose "Report Player", then "Attempted Trade Scam"/);
    guide.querySelector('button').click();
    assert.equal(document.querySelector('#tg-report-guide'), null);

    // without the marker, profiles are left alone
    const plain = await runOn(PLAIN_PAGE, { pathname: '/profiles/76561198000000301/', settle: 50 });
    assert.equal(plain.document.querySelector('#tg-report-guide'), null);
});

test('the menu offers the checkup only when signed in', async () => {
    const signedIn = await runOn(PLAIN_PAGE, { pathname: '/id/someone/', settle: 50 });
    assert.deepEqual(signedIn.menu.map((m) => m.name),
        ['Security checkup', 'Set secret phrase', 'Verified bots', 'Check for updates']);

    const signedOut = await runOn('<html><body></body></html>', { pathname: '/id/someone/', settle: 50 });
    assert.deepEqual(signedOut.menu.map((m) => m.name), ['Set secret phrase', 'Verified bots', 'Check for updates']);
});

test('verified bots added from the menu catch a copy on first contact', async () => {
    const run = await runOn(PLAIN_PAGE, { pathname: '/id/someone/', settle: 50 });
    run.menu.find((m) => m.name === 'Verified bots').action();

    const dialog = run.document.querySelector('#tg-dialog');
    dialog.querySelector('textarea').value = '76561198000000302 STN Trading Bot #2';
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Add').click();

    const saved = run.storage.get('verifiedBots');
    // values from the script's own realm are compared as JSON
    assert.equal(JSON.stringify(saved.map((b) => [b.steamId, b.name])), JSON.stringify([['76561198000000302', 'STN Trading Bot #2']]));
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
