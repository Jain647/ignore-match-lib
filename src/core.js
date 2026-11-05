// Core gitignore-style pattern matching.
//
// Design decisions:
// - Patterns are compiled once into a list of {negated, regex} objects.
//   Matching walks the list in order and the last match wins. This mirrors
//   gitignore precedence: later lines override earlier ones, and a negated
//   pattern re-includes a path that an earlier pattern excluded.
// - A pattern with no slash matches the basename at any depth, so `*.log`
//   excludes `a/b/c.log`. A pattern containing a slash is anchored to the
//   root of the tree being matched.
// - Trailing slash means directory-only; we record that flag and require the
//   caller to tell us whether the path is a directory.
// - A leading `!` negates. A leading `\` escapes a literal `!` or `#`.
// - `**` matches any number of path segments. A single `*` matches within a
//   segment and never crosses `/`. `?` matches one non-slash character.

const REGEX_SPECIAL = /[.+^${}()|\[\]\\]/g;

/**
 * Escape a literal character for use inside a RegExp source string.
 */
function escapeLiteral(ch) {
  return ch.replace(REGEX_SPECIAL, '\\$&');
}

/**
 * Translate one gitignore pattern into a RegExp source string.
 *
 * The returned source always begins with `^` and ends with `$` so callers
 * can test it directly against a full relative path.
 *
 * @param {string} pattern the pattern body (without leading `!` or trailing `/`)
 * @param {boolean} anchored whether the pattern is anchored to the root
 * @returns {string}
 */
function translate(pattern, anchored) {
  let out = anchored ? '^' : '(?:^|/)';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        // `**` consumes any number of segments. A trailing `/` after `**`
        // is optional so `a/**` matches `a` itself as well as `a/b`.
        const after = pattern[i + 2];
        if (after === '/') {
          out += '(?:.*/)?';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      out += '[^/]';
      i += 1;
    } else if (ch === '[') {
      // Character class: copy until the matching `]`. A `!` or `^` right
      // after `[` negates the class, matching shell glob behaviour.
      let j = i + 1;
      let cls = '[';
      if (pattern[j] === '!' || pattern[j] === '^') {
        cls += '^';
        j += 1;
      }
      while (j < pattern.length && pattern[j] !== ']') {
        cls += pattern[j];
        j += 1;
      }
      if (j >= pattern.length) {
        // Unterminated class: treat `[` as a literal.
        out += '\\[';
        i += 1;
        continue;
      }
      cls += ']';
      out += cls;
      i = j + 1;
    } else {
      out += escapeLiteral(ch);
      i += 1;
    }
  }
  out += '$';
  return out;
}

/**
 * Compile a single gitignore line into a matcher record.
 *
 * Blank lines and comments return `null`; callers filter those out.
 *
 * @param {string} line one raw line from a gitignore file
 * @returns {{negated: boolean, directoryOnly: boolean, regex: RegExp, source: string} | null}
 */
export function compilePattern(line) {
  if (typeof line !== 'string') {
    throw new TypeError('pattern must be a string');
  }
  let body = line;
  // Trailing whitespace is not significant, but a backslash before it makes
  // it significant. We keep the simple rule: trim the right side.
  body = body.replace(/\s+$/, '');
  if (body === '') return null;
  if (body[0] === '#') return null;

  let negated = false;
  if (body[0] === '!') {
    negated = true;
    body = body.slice(1);
  } else if (body[0] === '\\' && (body[1] === '!' || body[1] === '#')) {
    // Escaped literal `!` or `#` at the start of a pattern.
    body = body.slice(1);
  }

  let directoryOnly = false;
  if (body.endsWith('/')) {
    directoryOnly = true;
    body = body.slice(0, -1);
  }
  if (body === '') return null;

  // A pattern is anchored when it contains a slash anywhere in the body.
  // A leading slash is stripped because anchoring is already implied.
  let anchored = false;
  if (body[0] === '/') {
    anchored = true;
    body = body.slice(1);
  } else if (body.includes('/')) {
    anchored = true;
  }

  return {
    negated,
    directoryOnly,
    regex: new RegExp(translate(body, anchored)),
    source: line,
  };
}

/**
 * Normalize a path for matching: strip leading `./` and `/`, collapse
 * duplicate slashes, and drop a trailing slash. Gitignore paths are relative
 * to the ignore file's directory, so callers should pass relative paths.
 *
 * @param {string} p
 * @returns {string}
 */
function normalize(p) {
  if (typeof p !== 'string') {
    throw new TypeError('path must be a string');
  }
  let out = p.replace(/\\/g, '/');
  out = out.replace(/^\/+/, '');
  out = out.replace(/^\.\//, '');
  out = out.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Test whether a path is ignored by a list of compiled patterns.
 *
 * Precedence: the last matching pattern wins. A negated pattern that matches
 * therefore re-includes the path even if an earlier pattern excluded it.
 *
 * @param {string} path relative path to test
 * @param {Array<{negated: boolean, directoryOnly: boolean, regex: RegExp}>} patterns
 * @param {{isDirectory?: boolean}} [options]
 * @returns {boolean}
 */
export function matchPath(path, patterns, options = {}) {
  const isDirectory = options.isDirectory === true;
  const normalized = normalize(path);
  if (normalized === '') return false;

  let ignored = false;
  for (const p of patterns) {
    if (p.directoryOnly && !isDirectory) continue;
    if (p.regex.test(normalized)) {
      ignored = !p.negated;
    }
  }
  return ignored;
}

/**
 * Stateful matcher built from a list of gitignore-style lines.
 *
 * The matcher stores compiled patterns and exposes `ignores(path, options)`.
 * Compiling once and reusing is the intended usage; recompiling on every call
 * would be wasteful for directory walks.
 */
export class IgnoreMatcher {
  /**
   * @param {string[]} [lines] raw gitignore lines
   */
  constructor(lines = []) {
    if (!Array.isArray(lines)) {
      throw new TypeError('lines must be an array of strings');
    }
    /** @type {Array<{negated: boolean, directoryOnly: boolean, regex: RegExp, source: string}>} */
    this.patterns = [];
    for (const line of lines) {
      const compiled = compilePattern(line);
      if (compiled !== null) {
        this.patterns.push(compiled);
      }
    }
  }

  /**
   * @param {string} path relative path
   * @param {{isDirectory?: boolean}} [options]
   * @returns {boolean}
   */
  ignores(path, options) {
    return matchPath(path, this.patterns, options);
  }

  /**
   * Number of compiled (non-comment, non-blank) patterns.
   * @returns {number}
   */
  get size() {
    return this.patterns.length;
  }
}
