'use strict';

// Every text file of the project that the source and style checks should cover, found by walking the
// repository instead of a hand-kept list, so a new file can't slip past them.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const TEXT_FILES = new Set(['.js', '.json', '.md', '.html', '.yml']);

function projectFiles(dir = ROOT) {
    const files = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) files.push(...projectFiles(absolute));
        } else if (TEXT_FILES.has(path.extname(entry.name))) {
            files.push({ absolute, relative: path.relative(ROOT, absolute).split(path.sep).join('/') });
        }
    }

    return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

module.exports = { ROOT, projectFiles };
