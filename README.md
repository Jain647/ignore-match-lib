# ignore-match-lib

Filter relative paths with gitignore-style patterns and last-match-wins precedence.

```js
import { IgnoreMatcher } from './src/index.js';

const matcher = new IgnoreMatcher([
  '*.log',
  '!keep.log',
  'build/',
]);

matcher.ignores('app.log');                       // true
matcher.ignores('keep.log');                      // false
matcher.ignores('build', { isDirectory: true });  // true
matcher.ignores('build', { isDirectory: false }); // false
```

The package also exports `compilePattern(line)` and `matchPath(path, patterns, options)` for callers that want to manage the compiled pattern list themselves.

## Why this exists

Walking a directory tree and deciding which entries to skip is a common job, and the rules people actually want are the gitignore rules: later lines override earlier ones, `!` re-includes, a pattern without a slash matches a basename anywhere, and a trailing slash means directory-only. Reimplementing that per project tends to produce subtly different precedence. This library compiles each line once into a `RegExp` and then walks the list at match time, applying the last matching pattern. The trade-off is that matching is O(patterns) per path rather than a single trie lookup; for the pattern counts a real ignore file contains this is irrelevant, and the simple ordering is what makes precedence easy to reason about.

## The awkward edge

Directory-only patterns need to know whether the path is a directory. `matchPath` and `IgnoreMatcher#ignores` take an `options` object with `isDirectory`, defaulting to `false`. If you forget to pass it while walking a tree, a `build/` pattern will not exclude the `build` directory itself; it will still exclude files inside it only if the pattern matches them, which it does not. The caller is responsible for supplying the flag.

## API

- `new IgnoreMatcher(lines)` — `lines` is an array of raw gitignore lines. Blank lines and `#` comments are dropped. Exposes `ignores(path, options)` and a `size` getter for the number of compiled patterns.
- `compilePattern(line)` — returns `{ negated, directoryOnly, regex, source }` or `null` for a blank/comment line. Throws `TypeError` for non-strings.
- `matchPath(path, patterns, options)` — applies a precompiled pattern list to a path. `patterns` is the array returned by mapping `compilePattern` and filtering out `null`.

Paths are normalized before matching: backslashes become forward slashes, a leading `./` or `/` is stripped, repeated slashes collapse, and a trailing slash is removed. A pattern containing a slash is anchored to the root; one without is matched against the basename at any depth.
