'use strict';

// A dependency-free style check, so the code style is enforced without adding a linter to the
// project's dependencies. It covers what matters for reviewing a single-file userscript: one line
// ending style (the release hash depends on it), no invisible whitespace differences, and lines
// short enough to read side by side in a diff.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectFiles } = require('./helpers/files');

const MAX_CODE_LINE = 120;

// Like ESLint's max-len with ignoreStrings/ignoreTemplateLiterals/ignoreRegExpLiterals: a long
// user-facing message reads better on one line than split into concatenated pieces, so only the
// code around literals counts towards the limit.
function codeLength(line) {
    return line
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``')
        .replace(/\/(?![/*])(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, '//')
        .length;
}

for (const file of projectFiles()) {
    const text = fs.readFileSync(file.absolute, 'utf8');
    const lines = text.split('\n');

    test(`${file.relative}: LF line endings, no tabs or trailing spaces, final newline`, () => {
        const problems = [];

        if (text.includes('\r')) problems.push('contains CR (Windows line endings)');
        if (!text.endsWith('\n')) problems.push('missing final newline');

        lines.forEach((line, index) => {
            if (/\t/.test(line)) problems.push(`line ${index + 1}: tab`);
            if (/[ \t]+$/.test(line)) problems.push(`line ${index + 1}: trailing whitespace`);
        });

        assert.deepEqual(problems, []);
    });

    if (path.extname(file.relative) === '.js') {
        test(`${file.relative}: code lines are at most ${MAX_CODE_LINE} characters`, () => {
            const long = lines
                .map((line, index) => ({ line: index + 1, length: codeLength(line) }))
                .filter((entry) => entry.length > MAX_CODE_LINE)
                .map((entry) => `line ${entry.line}: ${entry.length}`);

            assert.deepEqual(long, []);
        });
    }
}
