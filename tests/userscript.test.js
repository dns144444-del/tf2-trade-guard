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

const PROFILE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<profile>
  <steamID64>${KIRO}</steamID64>
  <steamID><![CDATA[Kiro]]></steamID>
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
function steamResponses(apiKeyPage) {
    return [
        [/^\/dev\/apikey/, apiKeyPage],
        [/^\/my\/friends\//, fixture('friends.html')],
        [/^\/profiles\/\d+\/\?xml=1/, PROFILE_XML],
        [/^\/profiles\/\d+\/ajaxaliases\//, '[]'],
        [/^\/inventory\/76561198000000301\/440\/2/, INVENTORY]
    ];
}

// a logged-in page with nothing for Trade Guard to check besides the API key
const PLAIN_PAGE = '<html><head><script>g_steamID = "76561198000000001";</script></head><body></body></html>';

// page: a fixture name or raw HTML
async function runOn(page, { pathname, search = '', apiKeyPage = NO_KEY_PAGE, until, settle = 0 }) {
    const { window, document } = parseHTML(page.endsWith('.html') ? fixture(page) : page);
    const responses = steamResponses(apiKeyPage);
    const requests = [];
    const storage = new Map();

    const context = {
        window,
        document,
        location: { pathname, search, href: `https://steamcommunity.com${pathname}${search}` },
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
        GM_addStyle: () => {},
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

    return { document, requests, storage };
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
