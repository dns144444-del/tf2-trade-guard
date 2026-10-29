'use strict';

// Invisible and bidirectional characters in source code can hide what the code really does
// ("Trojan Source"). A security script must stay readable, so they're only allowed as escapes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['tf2-trade-guard.user.js', 'tests/core.test.js', 'tests/source.test.js'];

// [first, last] code points
const FORBIDDEN = [
    [0x00AD, 0x00AD], // soft hyphen
    [0x0300, 0x036F], // combining marks
    [0x034F, 0x034F], [0x061C, 0x061C], [0x115F, 0x1160], [0x17B4, 0x17B5], [0x180B, 0x180E],
    [0x200B, 0x200F], // zero-width characters and direction marks
    [0x202A, 0x202E], // bidi embeddings and overrides
    [0x2060, 0x206F], // word joiner, invisible operators, bidi isolates
    [0x2800, 0x2800], // braille blank
    [0x3164, 0x3164], [0xFE00, 0xFE0F], [0xFEFF, 0xFEFF], [0xFFA0, 0xFFA0]
];

for (const file of FILES) {
    test(`${file} contains no invisible or bidirectional characters`, () => {
        const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
        const found = [];

        lines.forEach((line, index) => {
            for (const ch of line) {
                const code = ch.codePointAt(0);
                if (FORBIDDEN.some(([first, last]) => code >= first && code <= last)) {
                    found.push(`line ${index + 1}: U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
                }
            }
        });

        assert.deepEqual(found, []);
    });
}
