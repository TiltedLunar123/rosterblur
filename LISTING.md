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

FREE:
- Click to blur. Turn on the picker and click anything to blur it. Click again to unblur.
- Area blur: drag a rectangle over any part of the page.
- Blurs are remembered per site. They come back after reloads and navigation.
- About to share in a hurry? The panic hotkey (Alt+Shift+H) blurs the entire page at once.
- Swap the tab title and favicon for neutral ones when you need to.
- Adjustable blur strength.

PRO ($15 once, yours forever):
- Roster auto-blur. Paste your class rosters once and every visible roster name gets blurred on every page. This holds even on live apps like Google Classroom and PowerSchool, which redraw themselves constantly.
- Pseudonymize mode. Instead of a blur, names become numbered stand-ins (Student 1, Student 2...). Recordings look natural and the same student keeps the same number.
- Auto-detect emails and phone numbers, plus long ID numbers. Each has its own toggle.
- CSV import, plus multiple named rosters with their own on and off switches. One per class period works well.
- Meeting mode. When a Google Meet, Zoom, or Teams tab is open, roster blur switches on across all your tabs by itself.

Matching is careful on purpose. Case and accents are ignored, so typing Jose still finds the accented spelling. Word boundaries are respected; a student named May never blurs the month of May. Gradebook-style Last, First works too. Names inside URLs and code blocks get left alone.

PRIVATE BY DESIGN:
Your rosters never leave your computer. They live in local browser storage, and that is the only place they exist. The extension makes zero network requests (no analytics, no server behind it). Even the Pro license key is checked on your device against a built-in public key. One honest caveat: RosterBlur helps you protect student information while you share your screen. It is not a compliance product, and it does not by itself make you or your school FERPA compliant.

## Permissions justification (for the store's privacy tab)

RosterBlur asks for the storage permission so your settings, per-site blur lists, and rosters can be saved in local browser storage. It runs a content script on all sites because a blur tool has to work on whatever page you happen to be sharing; a teacher's day moves between the gradebook, the LMS, and email, and the next page is never predictable. The extension sends no data anywhere. There are no analytics and no network requests of any kind, which you can verify in the source. Keyboard shortcuts use the commands API. Nothing else is requested.

## Single purpose description (store review field)

RosterBlur blurs or pseudonymizes student names and other personal information visible on web pages so teachers can share their screen without exposing student data.
