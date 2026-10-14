# Doorstep

A personal, ad-free "where are my packages" app. It reads shipping emails, works out what each package is, who's carrying it and when it arrives, and shows that on a clean phone page.

Live page: https://abhijit340.github.io/doorstep/ (it shows nothing until you connect it to your own tracker with a private link).

## How it works

```
shipping emails ──► Gmail inbox ──► Apps Script (every 15 min) ──► private Google Sheet
                                                   ▲                        │
                                 phone page ───────┴── private link + key ──┘
```

- **`apps-script/`** runs inside a Google account, attached to a Google Sheet. Every 15 minutes it reads new mail in that account's inbox (read-only), pulls out tracking number, carrier, store, items, expected date and a product photo where the email has one, and keeps one row per package in the sheet. It also answers the phone page, but only for requests carrying the secret key.
- **`docs/`** is the phone page, served by GitHub Pages. It is static: no data, no keys, no analytics. It stores your private link on your device and draws what the script returns.
- **No package data lives in this repo.** It stays in the private sheet.

Parsing is plain rules (regular expressions) in `apps-script/Parse.gs`. No AI service and no third-party tracking API sees your mail.

## Set up your own

1. **A dedicated inbox (recommended).** Create a Gmail account just for this, and in your main Gmail add a filter that forwards shipping emails to it. The script then can only ever see forwarded shipping mail, never your main inbox. A filter that works well, pasted into "Has the words":

   ```
   {from:(ups.com OR usps.com OR fedex.com OR dhl.com OR shipment-tracking@amazon.com OR auto-confirm@amazon.com OR order-update@amazon.com) subject:(shipped OR shipping OR "on its way" OR "on the way" OR "tracking number" OR "out for delivery" OR delivered OR "order confirmation" OR "order confirmed" OR "your order" OR "thanks for your order" OR "thank you for your order" OR "delivery update" OR "delivery date")}
   ```

2. **Create the sheet and script** in that account with [clasp](https://github.com/google/clasp):

   ```
   clasp login
   clasp create-script --type sheets --title "Package Tracker" --rootDir apps-script
   clasp push --force
   clasp create-deployment --description "v1"
   ```

   (`clasp create-script` overwrites `apps-script/appsscript.json`; restore it from git before pushing.)

3. **Run `setup` once** in the script editor and approve the permissions: read-only Gmail, this one spreadsheet, and timers. It creates the tabs, the secret key and the 15-minute trigger, and logs the key.

4. **Connect your phone.** Your private link is `https://script.google.com/macros/s/<deployment id>/exec?key=<key>`. Open the live page, paste the link, and add the page to your home screen.

## Day to day

- Tap a card to fix a name, date or status, or to archive it. Edits are written back to the sheet.
- You can also edit the **Packages** tab directly, or type in a row by hand; the script picks it up.
- ↻ checks mail immediately instead of waiting for the next 15-minute run.
- Delivered packages leave the Delivered tab after 30 days.
- Anyone with your private link can see your list. Run `rotateKey` in the script editor to replace the key.

## Changing things

- `node tests/parse_test.js` runs the parser tests. Add a sample email there when a store's format is missed.
- `powershell -File tools/deploy_script.ps1 "what changed"` publishes `apps-script/` and keeps the same private link.
- Pushing to `main` updates the page within about a minute.
