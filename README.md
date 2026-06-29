# LinkedInOhneAlgo

*LinkedIn ohne Algorithmus* — a small browser extension (Firefox & Chrome) that
hides every post in your LinkedIn home feed except those authored by your
**1st-degree connections**, so you see what your actual network posts instead of
algorithmic filler.

## Install — Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select the `manifest.json` file in this folder
4. Open `https://www.linkedin.com/feed/` — a blue **Filter ON** pill appears
   bottom-right. Click it to toggle filtering on/off.

Temporary add-ons are removed when Firefox restarts. To keep it permanently
you'd need to package and sign it via Mozilla's add-on developer hub
(addons.mozilla.org), or run Firefox Developer/Nightly edition which allows
unsigned add-ons.

## Install — Chrome

1. Go to `chrome://extensions` and turn on **Developer mode** (top-right).
2. Click **Load unpacked** and select this folder.
3. Open `https://www.linkedin.com/feed/` — the **Filter ON** pill appears.

Chrome shows a harmless *"Unrecognized manifest key 'browser_specific_settings'"*
warning (that key is Firefox-only; Chrome ignores it). Unlike Firefox's temporary
add-on, an unpacked extension persists across Chrome restarts.

## How it works

As of LinkedIn's 2025 "server-driven UI" feed rebuild, class names are hashed
(`_26ae297a`…) and posts no longer carry `data-urn`/`data-id`. The content
script keys off the durable hooks that remain:

- **Feed list:** `[data-testid="mainFeed"]` (a `data-component-type="LazyColumn"`).
- **A post:** a top-level `[role="listitem"]` inside that list.
- **Author + degree:** the author's `aria-label`, e.g. `"Jane Doe … 1st"`.

For each post it reads the **author's** degree from that aria-label and hides
the post unless it's `1st`. Reading the author label (rather than scanning the
post's visible text) matters: verified authors render the degree beside a badge
icon (not a plain text node), and a post body can contain a *commenter's* badge
("Laura commented … • 1st") that a text scan would wrongly match. It re-checks
on scroll via a `MutationObserver`, since the feed lazy-loads posts.

If LinkedIn ever changes the markup so no degree is detectable on any post, the
script **fails safe** (shows everything) and logs a `[LCF]` warning rather than
blanking your feed.

## Verifying / debugging against the live feed

`test/inspect-feed.mjs` (Playwright) drives your installed Chrome with a
persistent profile and dumps the real feed DOM, so you can confirm the selectors
without guessing:

```
npm install            # one-time (uses your installed Chrome; no download)
npm run inspect        # log in once; dumps post/author/degree structure
npm run verify         # runs the real content.js on the feed; asserts posts get hidden
```

Note: Chrome under automation refuses to load the unpacked extension and
LinkedIn's CSP blocks injected scripts, so `verify` runs `content.js` through a
CSP-exempt path to exercise the real code. (The extension itself runs normally
as a Firefox content script, which is exempt from the page CSP.)

## If it stops filtering

1. Run `npm run inspect` and look at the dumped post container / author
   `aria-label` structure.
2. Update `SELECTORS.feed` / `SELECTORS.post` or the `authorDegree()` aria-label
   assumption in `content.js` to match.
3. Watch the `[LCF] posts=… withDegree=… hidden=…` line in the DevTools console:
   `posts=0` ⇒ the feed/post selector is wrong; `posts>0 withDegree=0` ⇒ the
   degree/aria-label read is wrong.

## Notes

- Only affects the home feed display in your browser; it doesn't change
  anything on LinkedIn's side or touch your account.
- Set `DEBUG = true` at the top of `content.js` to dim/outline filtered posts
  in red instead of hiding them, which helps when tuning selectors.
- The Playwright profile stores your LinkedIn session locally under
  `~/.cache/li-connection-filter/profile` and is never transmitted anywhere;
  delete that folder to reset/log out.
