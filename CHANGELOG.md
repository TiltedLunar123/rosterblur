# Changelog

## 2.0.1

- The presentation shield now makes its free tier obvious. Free users
  could always arm it (it masks tab titles), but the button barely
  reacted. Armed state gets a clear highlight, the caption says
  plainly that name blur is the Pro half, and arming without Pro
  points at the upgrade card.

## 2.0.0

The "one click before you share" release.

- 7-day Pro trial for every install. Everything unlocks locally on
  install day; no account, no card, no server. When it ends the free
  features stay and saved rosters are kept.
- Presentation shield (Alt+Shift+S, or the big popup button): masks
  tab titles and favicons in every tab and, with Pro, forces roster
  blur on everywhere. Toolbar badge shows ON while armed; the shield
  always starts a browser session disarmed.
- Capture roster from the page (Pro): click your gradebook or class
  list and the student names are extracted and saved as a roster,
  with a preview before anything is stored.
- One-click activation: the purchase confirmation page now shows an
  "Activate in RosterBlur" button when the extension is installed;
  no more copy-and-paste (which still works).
- Pseudonym styles: keep "Student 1" labels or switch to stable
  fictional names (Avery M., Riley P., ...).
- Blur student photos and avatars whose alt text matches a roster
  name (Pro, opt-in).
- Blur grade cells: table cells that contain only a grade-shaped
  token (A-, 95%, 18/20) can blur too (Pro, opt-in).
- Never-blur list: names that should stay visible (yours,
  co-teachers) are excluded from matching.
- Quick roster switching and a hidden-names counter in the popup.
  Counters are local, like everything else.
- Site licenses: Department (5 teachers) and School (30 teachers)
  keys carry their tier; the activation service mints them from
  their own payment links. Individual keys are unchanged and all
  existing keys keep working.
- Firefox support. `node build.js --firefox` builds the same extension
  with a Firefox manifest (event-page background scripts instead of a
  service worker, `options_ui`, gecko id and data-collection
  declaration for AMO, minimum Firefox 140).
- New "alarms" permission (fires once when the trial ends). Still
  zero network requests from the extension.

## 1.1.1

- The popup tools no longer sit disabled on tabs that were already open
  when the extension was installed or updated. Content scripts are now
  injected into open tabs on install and update, and the popup injects
  on demand as a fallback. Adds the "scripting" permission; site access
  is unchanged (the content script already ran on all sites).

## 1.1.0

UI and onboarding refresh. No changes to blurring behavior, matching,
storage, or the license format.

- Popup: clearer tool names with icons, a per-site status line showing
  what is blurred, a two-step confirm on "Clear this site", and a
  direct Pro checkout button for free users
- Options: a short setup guide, a live roster-blur preview on a sample
  gradebook for free users, and a clearer Pro section with the full
  feature list and one-time pricing
- The options page opens once after install
- Deep link support: the popup's "Have a key?" jumps straight to the
  license section

## 1.0.0

Initial release.

- Click-to-blur picker with hover highlight and per-site persistence
- Area blur rectangles
- Panic hotkey that blurs the whole page
- Tab title and favicon masking
- Adjustable blur strength
- Pro: roster auto-blur with live re-scanning on dynamic pages
- Pro: pseudonymize mode with stable Student N labels
- Pro: email, phone, and ID pattern detection
- Pro: CSV roster import and multiple named rosters with toggles
- Pro: meeting mode for Google Meet, Zoom, and Teams
- Offline license verification; the extension makes no network requests
