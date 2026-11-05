/**
 * Recognises bot-protection pages (Cloudflare, Imperva, DataDome, PerimeterX,
 * Akamai, AWS WAF, Vercel) so they are not converted, cached, and returned as
 * the article. Some vendors answer 200, so the status alone does not tell.
 *
 * Every rule needs little visible text, and vendor markers count only where
 * the vendor puts them: in script code and in script or iframe sources, never
 * in the text a reader sees or in other attributes. An article about robots,
 * a page explaining `cf_chl_opt`, or a heading anchored `#cf_chl_opt` stays content.
 */

export type ChallengeVendor =
  | "cloudflare"
  | "imperva"
  | "datadome"
  | "perimeterx"
  | "akamai"
  | "aws_waf"
  | "vercel"
  | "generic";

/** Challenge pages seen in production carry at most ~600 characters of text. */
const MAX_CHALLENGE_TEXT_CHARS = 1500;

/**
 * Where an assigned global starts: at the start of a statement (optionally after
 * var/let/const) or after window./self./globalThis. Text inside a regex literal
 * (`if (x) /_cf_chl_opt =/.test(s)`) starts after "/" and does not count.
 */
const ASSIGNED = String.raw`(?:(?:^|[;{},\n])\s*(?:(?:var|let|const)\s+)?|\b(?:window|self|globalthis)\.)`;

/**
 * What only a challenge's own scripts carry: the globals its code assigns
 * (`window._cf_chl_opt = {...}`), matched in script code outside string
 * literals and comments, so an article serialised into a hydration string does not count;
 * and the addresses its <script> or <iframe> tags load.
 */
const VENDOR_SCRIPTS: Array<[ChallengeVendor, { globals: RegExp[]; sources: string[] }]> = [
  // Normal Cloudflare pages also load /cdn-cgi/challenge-platform/scripts/jsd/;
  // only a challenge loads an /orchestrate/ script.
  ["cloudflare", { globals: [new RegExp(`${ASSIGNED}_cf_chl_opt\\s*=(?!=)`)], sources: ["/orchestrate/chl", "/orchestrate/managed", "/orchestrate/jsch"] }],
  // Its c.js or captcha iframe.
  ["datadome", { globals: [], sources: ["captcha-delivery.com"] }],
  ["aws_waf", { globals: [new RegExp(`${ASSIGNED}gokuprops\\s*=(?!=)`)], sources: [] }],
  // Imperva Advanced Bot Protection's 200 interstitial ("Pardon Our Interruption"), which loads its script by a random path.
  ["imperva", { globals: [new RegExp(`${ASSIGNED}(?:reeseskipexpirationcheck|reeseskipautoload|onprotectioninitialized)\\s*=(?!=)`)], sources: [] }],
];
/** PerimeterX globals and scripts; its captcha container alone could be any element id. */
const PERIMETERX_SCRIPT = /_pxappid|perimeterx|px-cdn\.net|px-cloud\.net/;

/** Titles that name the vendor's block page. */
const VENDOR_TITLES: Array<[ChallengeVendor, RegExp]> = [
  ["cloudflare", /^attention required! \| cloudflare$/i],
  ["vercel", /^vercel security checkpoint$/i],
];

/** Title or heading wording of a block page from any vendor. */
const BLOCK_HEADING =
  /^(?:just a moment\.*|security verification|security check|access denied|request blocked|robot or human\??|are you a (?:robot|human)\??|verify (?:that )?you are (?:a )?human|checking your browser.*|pardon our interruption|.*\bare you a robot\??)$/i;

/**
 * Wording a block page adds besides its heading: a request or incident ID,
 * or a reason for the block. A heading alone could be an article's title.
 */
const BLOCK_EVIDENCE =
  /\b(?:(?:ray|request|incident|support) id\b[\s:#]*(?=[\w-]*\d)[\w-]{6,}|reference\s*#\s*[\d.a-f]{6,}|unusual (?:traffic|activity)|invalid connection|automated (?:access|requests|queries)|(?:has|have) been blocked|was blocked|you don't have permission to access|verifying (?:your browser|you are (?:a )?human)|enable javascript and cookies to continue|needs to review the security of your connection)\b/i;
/** A block notice is a few lines; an article with that heading is longer. */
const MAX_GENERIC_TEXT_CHARS = 600;

const DENIAL = String.raw`(?:[Aa]ccess [Dd]enied|ACCESS DENIED|[Rr]equest [Bb]locked|[Ee]rror 403|403 [Ee]rror)`;
/** A site's name beside the denial: one or two capitalised words, so "How to fix" is not one. */
const SITE_NAME = String.raw`\p{Lu}[^\s|\u2013()-]*(?: \p{Lu}[^\s|\u2013()-]*)?`;
/**
 * A title or heading that is a denial notice, alone, after the site's name, or
 * with a second denial: "Farnell | 403 Error", "Error 403 - Request Blocked",
 * "Access Denied (Error 403)", "Access Denied - Macy's".
 * "Error 403 explained" and "Error 403 - Troubleshooting" are not.
 */
const DENIAL_HEADING = new RegExp(
  `^(?:${SITE_NAME}\\s[|\u2013-]\\s)?(?:${DENIAL}(?:\\s[|\u2013-]\\s${DENIAL}|\\s\\((?:[Ee]rror )?403\\))?|(?:[Aa]ccess [Dd]enied|ACCESS DENIED)\\s[|\u2013-]\\s${SITE_NAME})$`,
  "u",
);
/** Akamai's reference number, with or without "Reference #": 0.5bc90b17.1793873578.64ebbb98. */
const AKAMAI_REFERENCE = /\b\d{1,3}\.[\da-f]{6,8}\.\d{10}\.[\da-f]{6,10}\b/i;
/** The sentence a denial page tells the visitor they were taken for a bot with (Fisher Scientific, Newark). */
const DENIAL_EVIDENCE = /\bour security (?:service detected activity from your request|software has identified something in this session)\b/i;
/** Denial pages explain how to get unblocked at length; Fisher Scientific's runs to ~1,900 characters. */
const MAX_DENIAL_TEXT_CHARS = 2500;

/**
 * A denial page: its heading announces the denial, and its text has Akamai's
 * reference or says the visitor looked like a bot. Also Home Depot's "Error Page"
 * with its own wording, which its browser visitors get instead of Akamai's denial.
 */
function denialRule(headings: string[], text: string): ChallengeVendor | null {
  const textChars = text.replace(/\s/g, "").length;
  if (textChars <= MAX_GENERIC_TEXT_CHARS && headings.some((heading) => /^error page$/i.test(heading)) && /\boops!! something went wrong\. please refresh page\b/i.test(text)) return "generic";
  if (textChars > MAX_DENIAL_TEXT_CHARS || !headings.some((heading) => DENIAL_HEADING.test(heading))) return null;
  if (AKAMAI_REFERENCE.test(text)) return "akamai";
  return DENIAL_EVIDENCE.test(text) ? "generic" : null;
}

interface PageParts {
  /** Script code with string literals blanked, lowercased. */
  code: string;
  /** <script> and <iframe> sources, lowercased. */
  sources: string;
  /** Whether the page has a <div id="px-captcha">. */
  pxCaptcha: boolean;
  /** Whether the page has an image. */
  hasImage: boolean;
  /** Visible text with collapsed spaces. */
  text: string;
  /** <title> text. */
  title: string;
  /** The page's own headings: its <title> and first <h1>. */
  headings: string[];
}

const MARKUP = /<!--|<(script|style|textarea|template)\b|<[a-z!/?]/gi;

/** A tag's attribute value, read attribute by attribute so quoted values hide their contents, or "". */
function attr(tag: string, name: string): string {
  const pattern = /\s*([^\s=>\/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?|\s*[^\s]/y;
  const space = tag.search(/\s/);
  pattern.lastIndex = space < 0 ? tag.length : space;
  for (let match = pattern.exec(tag); match; match = pattern.exec(tag)) {
    if (match[1]?.toLowerCase() === name) return match[2] ?? match[3] ?? match[4] ?? "";
    if (pattern.lastIndex >= tag.length) break;
  }
  return "";
}

/** The index of the ">" that ends the tag opened at `start`, skipping quoted attribute values, or -1. */
function tagEnd(html: string, start: number): number {
  let quote = "";
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * Splits off comments and the code of <script> and <style> in one forward
 * pass, so unclosed comments or tags cannot make it quadratic. Keeps only
 * code that runs: not comments, data blocks (JSON-LD may quote vendor names),
 * or scripts shown in a <textarea> or held in a <template>.
 */
function splitCode(html: string): { withoutCode: string; scripts: string[]; tags: string[] } {
  const lower = html.toLowerCase();
  const out: string[] = [];
  const scripts: string[] = [];
  // Real tags only: a tag quoted in an attribute value is part of its tag.
  const tags: string[] = [];
  let at = 0;
  MARKUP.lastIndex = 0;
  for (let match = MARKUP.exec(html); match; match = MARKUP.exec(html)) {
    out.push(html.slice(at, match.index));
    at = html.length;
    if (!match[1] && match[0] !== "<!--") {
      // Any other tag, whole, so "<script>" inside an attribute value is not a script.
      const end = tagEnd(html, match.index);
      if (end < 0) break;
      const tag = html.slice(match.index, end + 1);
      out.push(tag);
      tags.push(tag);
      at = end + 1;
    } else if (match[0] === "<!--") {
      const end = html.indexOf("-->", match.index + 4);
      if (end < 0) break; // an unclosed comment runs to the end
      at = end + 3;
    } else {
      const tag = match[1].toLowerCase();
      const openEnd = tagEnd(html, match.index);
      if (openEnd < 0) break;
      const close = tag === "template" ? templateClose(lower, openEnd + 1) : lower.indexOf(`</${tag}`, openEnd + 1);
      const content = html.slice(openEnd + 1, close < 0 ? html.length : close);
      const opening = html.slice(match.index, openEnd + 1);
      tags.push(opening);
      if (tag === "script") {
        const type = attr(opening, "type").trim().toLowerCase();
        if (!type || /javascript|ecmascript|^module$/.test(type)) scripts.push(content);
        out.push(opening);
      } else if (tag === "style") {
        out.push(opening);
      } else {
        // Shown or inert markup: its text, with no tags of its own.
        out.push(opening, content.replace(/</g, " "));
      }
      if (close < 0) break;
      const closeEnd = html.indexOf(">", close);
      if (closeEnd < 0) break;
      at = closeEnd + 1;
    }
    MARKUP.lastIndex = at;
  }
  out.push(html.slice(at));
  return { withoutCode: out.join(""), scripts, tags };
}

/** Where the </template> matching an opened template starts (templates nest), or -1. */
function templateClose(lower: string, from: number): number {
  // Real tags only: skip comments, and read each tag whole so a quoted "</template>" does not count.
  // Raw-text elements are skipped whole, so a "</template>" in a script string does not count either.
  const tags = /<!--|<(\/?)template\b|<(script|style|textarea|title)\b|<[a-z!/?]/g;
  tags.lastIndex = from;
  let depth = 1;
  for (let match = tags.exec(lower); match; match = tags.exec(lower)) {
    if (match[0] === "<!--") {
      const end = lower.indexOf("-->", match.index + 4);
      if (end < 0) return -1;
      tags.lastIndex = end + 3;
      continue;
    }
    if (match[1] !== undefined) {
      depth += match[1] ? -1 : 1;
      if (depth === 0) return match.index;
    }
    const end = tagEnd(lower, match.index);
    if (end < 0) return -1;
    tags.lastIndex = end + 1;
    if (match[2]) {
      const close = lower.indexOf(`</${match[2]}`, end + 1);
      if (close < 0) return -1;
      tags.lastIndex = close;
    }
  }
  return -1;
}

/** Characters after which a "/" starts a regular expression rather than a division. */
const BEFORE_REGEX = /[=(,:[!&|?{};+\-*%^~<>]/;
/** Keywords after which a "/" also starts a regular expression. */
const KEYWORD_BEFORE_REGEX = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|instanceof|new|delete|void|throw|yield|await|of)$/;

/** `code` without its comments and the contents of its string and regex literals, in one pass. */
function withoutStrings(code: string): string {
  const out: string[] = [];
  let at = 0;
  let previous = ";"; // the last non-space character outside literals and comments
  let previousAt = -1;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (/\s/.test(ch)) continue;
    const regexCanStart = BEFORE_REGEX.test(previous) ||
      (/[\w$]/.test(previous) && KEYWORD_BEFORE_REGEX.test(code.slice(Math.max(0, previousAt - 11), previousAt + 1)));
    if (ch === "/" && code[i + 1] !== "/" && code[i + 1] !== "*" && regexCanStart) {
      // A regex literal: drop its body up to the closing "/" on the same line.
      let j = i + 1;
      let inClass = false;
      while (j < code.length && code[j] !== "\n" && (inClass || code[j] !== "/")) {
        if (code[j] === "\\") j++;
        else if (code[j] === "[") inClass = true;
        else if (code[j] === "]") inClass = false;
        j++;
      }
      out.push(code.slice(at, i + 1));
      i = j;
      at = j;
      previous = "/";
      previousAt = j;
      continue;
    }
    if (ch === "/" && (code[i + 1] === "/" || code[i + 1] === "*")) {
      // A comment leaves the context before it unchanged.
      out.push(code.slice(at, i));
      const end = code[i + 1] === "/" ? code.indexOf("\n", i + 2) : code.indexOf("*/", i + 2);
      if (end < 0) return out.join("");
      i = code[i + 1] === "/" ? end - 1 : end + 1;
      at = i + 1;
      continue;
    }
    previous = ch;
    previousAt = i;
    if (ch !== '"' && ch !== "'" && ch !== "`") continue;
    out.push(code.slice(at, i + 1));
    let j = i + 1;
    while (j < code.length && code[j] !== ch) j += code[j] === "\\" ? 2 : 1;
    i = j;
    at = j;
  }
  out.push(code.slice(at));
  return out.join("");
}

function pageParts(html: string): PageParts {
  const { withoutCode, scripts, tags } = splitCode(html);
  const sources = tags
    .filter((tag) => /^<(?:script|iframe)\b/i.test(tag))
    .map((tag) => attr(tag, "src"));
  const headingText = (tag: string) =>
    new RegExp(`<${tag}\\b[^<>]*>([^<]*)<\\/${tag}>`, "i").exec(withoutCode)?.[1]?.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() ?? "";
  const title = headingText("title");
  const headings = [title, headingText("h1")].filter(Boolean);
  return {
    title,
    // One script per line, so each starts a statement.
    code: scripts.map(withoutStrings).join("\n").toLowerCase(),
    sources: sources.join(" ").toLowerCase(),
    pxCaptcha: tags.some((tag) => /^<div\b/i.test(tag) && attr(tag, "id") === "px-captcha"),
    hasImage: tags.some((tag) => /^<(?:img|picture|svg|video)\b/i.test(tag)),
    text: withoutCode.replace(/<[^<>]*>/g, " ").replace(/\s+/g, " ").trim(),
    headings,
  };
}

/** The vendor whose challenge or block page this is, or null for content. */
export function detectChallengePage(html: string): ChallengeVendor | null {
  const { code, sources, pxCaptcha, hasImage, text, title, headings } = pageParts(html);
  const textChars = text.replace(/\s/g, "").length;
  if (textChars > MAX_CHALLENGE_TEXT_CHARS) return denialRule(headings, text);

  for (const [vendor, markers] of VENDOR_SCRIPTS) {
    if (markers.globals.some((assignment) => assignment.test(code)) || markers.sources.some((src) => sources.includes(src))) return vendor;
  }
  if (pxCaptcha && (PERIMETERX_SCRIPT.test(code) || PERIMETERX_SCRIPT.test(sources) || BLOCK_EVIDENCE.test(text))) return "perimeterx";
  // Imperva's 200 challenge: a page with no text or image, only its script.
  if (textChars === 0 && !hasImage && sources.includes("_incapsula_resource")) return "imperva";
  return textRules(title, headings, text, sources);
}

/**
 * The rules that need only a page's wording, so they also check text another
 * service extracted (Firecrawl, Jina): `title`, the page's headings, and its text.
 */
export function detectChallengeText(title: string, headings: string[], text: string): ChallengeVendor | null {
  if (text.replace(/\s/g, "").length > MAX_CHALLENGE_TEXT_CHARS) return denialRule([title, ...headings].filter(Boolean), text);
  return textRules(title, [title, ...headings].filter(Boolean), text, "");
}

function textRules(title: string, headings: string[], text: string, sources: string): ChallengeVendor | null {
  // A vendor's block-page title, with the page's own block wording or checkpoint script.
  for (const [vendor, pattern] of VENDOR_TITLES) {
    if (pattern.test(title) && (BLOCK_EVIDENCE.test(text) || sources.includes("/.well-known/vercel/security/"))) return vendor;
  }
  if (/^request unsuccessful\. incapsula incident id\b/i.test(text)) return "imperva";
  // DataDome's notice when its captcha cannot load.
  if (/\bplease enable js and disable any ad blocker\b/i.test(text) && text.replace(/\s/g, "").length <= 200) return "datadome";
  if (/you don't have permission to access/i.test(text) && /\breference\s*#\s*[\d.a-f]{6,}/i.test(text)) return "akamai";
  if (
    text.replace(/\s/g, "").length <= MAX_GENERIC_TEXT_CHARS &&
    headings.some((heading) => BLOCK_HEADING.test(heading)) &&
    BLOCK_EVIDENCE.test(text)
  ) return "generic";
  return denialRule(headings, text);
}
