import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IgnoreMatcher, compilePattern, matchPath } from '../src/index.js';

test('blank lines and comments are dropped', () => {
  assert.equal(compilePattern(''), null);
  assert.equal(compilePattern('   '), null);
  assert.equal(compilePattern('# comment'), null);
  const m = new IgnoreMatcher(['', '# comment', '*.log']);
  assert.equal(m.size, 1);
});

test('a bare pattern matches the basename at any depth', () => {
  const m = new IgnoreMatcher(['*.log']);
  assert.equal(m.ignores('app.log'), true);
  assert.equal(m.ignores('deep/nested/app.log'), true);
  assert.equal(m.ignores('app.txt'), false);
});

test('a pattern with a slash is anchored to the root', () => {
  const m = new IgnoreMatcher(['build/out.txt']);
  assert.equal(m.ignores('build/out.txt'), true);
  assert.equal(m.ignores('src/build/out.txt'), false);
});

test('later patterns override earlier ones', () => {
  const m = new IgnoreMatcher(['*.log', '!keep.log']);
  assert.equal(m.ignores('app.log'), true);
  assert.equal(m.ignores('keep.log'), false);
  assert.equal(m.ignores('nested/keep.log'), false);
});

test('re-including a path only works when the negation also matches', () => {
  const m = new IgnoreMatcher(['*.log', '!important/*.log']);
  assert.equal(m.ignores('important/app.log'), false);
  assert.equal(m.ignores('other/app.log'), true);
});

test('directory-only patterns require isDirectory', () => {
  const m = new IgnoreMatcher(['cache/']);
  assert.equal(m.ignores('cache', { isDirectory: true }), true);
  assert.equal(m.ignores('cache', { isDirectory: false }), false);
  assert.equal(m.ignores('cache/file.txt'), false);
});

test('double star matches any number of segments', () => {
  const m = new IgnoreMatcher(['a/**/z.txt']);
  assert.equal(m.ignores('a/z.txt'), true);
  assert.equal(m.ignores('a/b/z.txt'), true);
  assert.equal(m.ignores('a/b/c/z.txt'), true);
  assert.equal(m.ignores('b/z.txt'), false);
});

test('single star does not cross a slash', () => {
  const m = new IgnoreMatcher(['src/*.js']);
  assert.equal(m.ignores('src/main.js'), true);
  assert.equal(m.ignores('src/lib/main.js'), false);
});

test('question mark matches one non-slash character', () => {
  const m = new IgnoreMatcher(['file?.txt']);
  assert.equal(m.ignores('file1.txt'), true);
  assert.equal(m.ignores('file12.txt'), false);
  assert.equal(m.ignores('file/.txt'), false);
});

test('character classes are supported including negation', () => {
  const m = new IgnoreMatcher(['file[0-9].txt', 'file[!0-9].txt']);
  assert.equal(m.ignores('file5.txt'), true);
  assert.equal(m.ignores('filex.txt'), true);
});

test('a leading backslash escapes a literal bang', () => {
  const m = new IgnoreMatcher(['\\!important.txt']);
  assert.equal(m.ignores('!important.txt'), true);
  assert.equal(m.ignores('important.txt'), false);
});

test('matchPath works with a precompiled pattern list', () => {
  const patterns = ['*.tmp', '!keep.tmp']
    .map(compilePattern)
    .filter((p) => p !== null);
  assert.equal(matchPath('x.tmp', patterns), true);
  assert.equal(matchPath('keep.tmp', patterns), false);
});

test('paths are normalized before matching', () => {
  const m = new IgnoreMatcher(['build/']);
  assert.equal(m.ignores('./build/', { isDirectory: true }), true);
  assert.equal(m.ignores('/build', { isDirectory: true }), true);
  assert.equal(m.ignores('build//', { isDirectory: true }), true);
});

test('non-string input is rejected', () => {
  assert.throws(() => compilePattern(42), TypeError);
  assert.throws(() => matchPath(42, []), TypeError);
  assert.throws(() => new IgnoreMatcher('not an array'), TypeError);
});
