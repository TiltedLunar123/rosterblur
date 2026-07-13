# RosterBlur

Blur student names before you share your screen. Everything runs on
your device: no accounts, no servers, no analytics, zero network
requests from the extension.

Built for teachers who present gradebooks, seating charts, LMS pages,
and email in front of a class, on a projector, or in a recorded
meeting.

## Free features

- **Click-to-blur.** Toggle the picker (toolbar button or
  Alt+Shift+B), hover to highlight, click any element to blur it.
  Click again to unblur.
- **Area blur.** Drag a rectangle over any region of the page.
- **Per-site memory.** Blurs persist per domain across reloads and
  navigation.
- **Panic blur.** Alt+Shift+H instantly blurs the entire page. Press
  again to restore.
- **Tab masking.** Replace the tab title and favicon with neutral
  placeholders on demand.
- **Adjustable blur strength.**

## Pro features ($15 once, lifetime)

- **Roster auto-blur.** Paste class rosters (one name per line) into
  the options page. Every visible occurrence of a roster name is
  blurred automatically on every page, including content that renders
  late or re-renders (Google Classroom, PowerSchool, and other
  single-page apps).
- **Pseudonymize mode.** Show "Student 1", "Student 2", ... instead of
  a blur so recordings and live demos look natural. Labels are stable:
  the same student gets the same number everywhere.
- **Pattern detection.** Optionally auto-blur email addresses, phone
  numbers, and long ID numbers.
- **CSV import.** Load rosters from simple exports (first,last columns
  or a single name column).
- **Meeting mode.** When a Google Meet, Zoom, or Teams tab is open,
  roster blur turns on across all tabs automatically and a small
  indicator appears.

Name matching is case-insensitive, accent-insensitive (Jose finds
Jose and José), anchored to word boundaries ("May Chen" never fires
inside "Maybelle Chenoweth"), and understands both "First Last" and
"Last, First". Names inside URLs and code blocks are left alone.
Matching standalone first or last names is available as an opt-in.

## Privacy

- Rosters, settings, and the license key are stored only in
  `chrome.storage.local` on your machine.
- The extension makes zero network requests. You can audit this:
  there is no fetch, XMLHttpRequest, or WebSocket anywhere in the
  shipped code.
- Blurring is non-destructive. RosterBlur never rewrites the page's
  text; it applies CSS filters and positioned overlays, so web apps
  keep working and nothing is ever submitted or saved differently.
- RosterBlur helps you protect student information while screen
  sharing. It is not a compliance product and does not make you or
  your school FERPA compliant on its own.

## How the Pro license works

Buying Pro through the Stripe link opens a page that issues a signed
license key. Paste the key into the options page once; the extension
verifies it offline against a built-in public key. Losing the key is
fine: revisiting your purchase link re-issues it. The extension never
contacts a license server.

## Install (development)

1. Clone this repo.
2. Open `chrome://extensions`, enable Developer mode.
3. Load unpacked, select the repo folder (or run `node build.js` and
   select `dist/`).

## Development

```bash
npm install
npm test          # unit tests (matcher, parsers, license, key service)
npm run e2e       # live browser checks with the extension loaded
npm run zip       # build dist/ and the store zip
```

The `netlify/` folder contains the one-function license service; see
`netlify/README.md`. Nothing in the extension talks to it.

## License

MIT. See [LICENSE](LICENSE).
