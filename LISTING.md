# Chrome Web Store listing

## Title (75 char max)

RosterBlur: Hide Student Names for Screen Sharing

## Summary (132 char max)

Blur or rename student names, emails, and IDs on any page before you share your screen. Works offline, nothing leaves your device.

## Category

Privacy & Security

## Full description

Share your screen without showing the whole class list.

RosterBlur is a privacy tool for teachers. Before you project a gradebook or record a tutorial, it blurs the student information on the page; the class never sees it, and neither does the recording, the parent on the video call, or whoever ends up watching that video three years from now.

NEW IN 2.0: every install starts with a free 7-day Pro trial. No account, no card, nothing to cancel; it just unlocks and later it just ends.

FREE:
- Presentation shield. One hotkey (Alt+Shift+S) before you share: tab titles and icons go neutral in every tab, and with Pro your whole roster blurs everywhere at once. A badge on the toolbar shows it is armed.
- Click to blur. Turn on the picker and click anything to blur it. Click again to unblur.
- Area blur: drag a rectangle over any part of the page.
- Blurs are remembered per site. They come back after reloads and navigation.
- About to share in a hurry? The panic hotkey (Alt+Shift+H) blurs the entire page at once.
- Swap the tab title and favicon for neutral ones when you need to.
- Adjustable blur strength.

PRO ($15 once, yours forever):
- Roster auto-blur. Add your class rosters once and every visible roster name gets blurred on every page. This holds even on live apps like Google Classroom and PowerSchool, which redraw themselves constantly.
- Capture roster from the page. Open your gradebook or class list, click it, and the student names save as a roster. No typing, no CSV wrangling.
- Pseudonymize mode. Instead of a blur, names become stand-ins: numbered (Student 1, Student 2...) or natural-looking fictional names. The same student keeps the same stand-in everywhere.
- Blur student photos and avatars that are labeled with a roster name, and grade cells in tables (A-, 95%, 18/20) if you want grades hidden too.
- Auto-detect emails and phone numbers, plus long ID numbers. Each has its own toggle.
- Never-blur list for your own name and co-teachers.
- CSV import, plus multiple named rosters with their own on and off switches. One per class period works well, and the popup switches between them.
- Meeting mode. When a Google Meet, Zoom, or Teams tab is open, roster blur switches on across all your tabs by itself.

Buying for a team? Department (5 teachers, $49) and school building (30 teachers, $129) licenses are available; email support@secplusmastery.com for an invoice or purchase order.

Matching is careful on purpose. Case and accents are ignored, so typing Jose still finds the accented spelling. Word boundaries are respected; a student named May never blurs the month of May. Gradebook-style Last, First works too. Names inside URLs and code blocks get left alone.

PRIVATE BY DESIGN:
Your rosters never leave your computer. They live in local browser storage, and that is the only place they exist. The extension makes zero network requests (no analytics, no server behind it). Even the Pro license key is checked on your device against a built-in public key. One honest caveat: RosterBlur helps you protect student information while you share your screen. It is not a compliance product, and it does not by itself make you or your school FERPA compliant.

## Permissions justification (for the store's privacy tab)

### storage

RosterBlur asks for the storage permission so your settings, per-site blur
lists, and rosters can be saved in local browser storage. That is the only
place they exist; the extension sends no data anywhere.

### scripting

RosterBlur's blur tools are driven by its content script. Content scripts
declared in the manifest only attach to pages that load after the extension
starts, so any tab already open when RosterBlur is installed or updated has
no working blur tools until that page is refreshed. The scripting permission
is used for exactly one thing: injecting the same two content script files
already declared in the manifest (shared.js and contentScript.js) into tabs
that were open during an install or update, and into the current tab from
the popup when the script is not yet running there. No other code is ever
injected, no code is fetched or executed from a server, and the extension
makes zero network requests.

### alarms

Used for exactly one thing: waking the extension when the local 7-day
trial period ends so the feature flags flip at the right moment. The
trial clock is a timestamp in local storage; nothing is scheduled or
reported anywhere else.

### Host permission (all sites)

Teachers use RosterBlur on whatever page they are about to share:
gradebooks, LMS pages, email, spreadsheets. Which site that is cannot be
known in advance, so the content script matches all URLs. Broad host access
is also required by chrome.scripting.executeScript to inject that same
content script into tabs that were already open at install or update time.
The extension reads page text only to find and blur roster names, keeps all
data in local browser storage, and makes no network requests of any kind.

Keyboard shortcuts use the commands API. Nothing else is requested.

## Single purpose description (store review field)

RosterBlur blurs or pseudonymizes student names and other personal information visible on web pages so teachers can share their screen without exposing student data.
