/**
 * A "Doorstep" menu in the sheet, so a copy can be set up without opening the code:
 *   1. Set up         creates the tabs, key and 15-minute mail check, then checks mail once.
 *   2. Connect phone  shows the web app link as a QR code. Deployed with "Only myself", the page needs
 *                     no key and nothing outside this Google account.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Doorstep')
    .addItem('1. Set up', 'menuSetup')
    .addItem('2. Connect my phone', 'menuConnect')
    .addSeparator()
    .addItem('Check mail now', 'menuCheck')
    .addSeparator()
    .addItem('Connect USPS tracking', 'menuUsps')
    .addToUi();
}

/** Store the USPS developer app's Consumer Key and Secret (Script Properties), then test them. */
function menuUsps() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('Connect USPS tracking (1 of 2)',
    'From developers.usps.com > Apps > your app, paste the Consumer Key.\nLeave blank and press OK to disconnect.',
    ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var id = a.getResponseText().trim(), p = props_();
  if (!id) {
    p.deleteProperty('USPS_CLIENT_ID'); p.deleteProperty('USPS_CLIENT_SECRET'); CacheService.getScriptCache().remove('USPS_TOKEN');
    ui.alert('USPS tracking disconnected.');
    return;
  }
  var b = ui.prompt('Connect USPS tracking (2 of 2)', 'Now paste the Consumer Secret.', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK || !b.getResponseText().trim()) return;
  p.setProperty('USPS_CLIENT_ID', id);
  p.setProperty('USPS_CLIENT_SECRET', b.getResponseText().trim());
  CacheService.getScriptCache().remove('USPS_TOKEN');
  p.deleteProperty('USPS_CHECKED');   // check every USPS package right away
  try {
    uspsToken_();
  } catch (e) {
    ui.alert('USPS didn\'t accept those', String(e.message || e) + '\n\nCheck the key and secret, and that the app has the Tracking API.', ui.ButtonSet.OK);
    return;
  }
  var r = poll();
  ui.alert('USPS tracking connected', 'Checked now: ' + (r.carrier_updates || 0) + ' package(s) updated.\n' +
    'From now on USPS packages are checked every couple of hours. Last check: ' + (p.getProperty('USPS_LAST') || ''), ui.ButtonSet.OK);
}

function menuSetup() {
  setup();
  var n = readPackages_().length;
  SpreadsheetApp.getUi().alert('Doorstep is set up',
    'It checks this account\'s inbox every 15 minutes (read-only) and found ' + n + ' package' + (n === 1 ? '' : 's') + ' so far.\n\n' +
    'Next: Extensions > Apps Script > Deploy > New deployment > Web app > Deploy.\n' +
    'Set Who has access to Only myself. Then come back and choose Doorstep > 2. Connect my phone.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuConnect() {
  if (!props_().getProperty('KEY')) {
    SpreadsheetApp.getUi().alert('Run Doorstep > 1. Set up first.');
    return;
  }
  var t = HtmlService.createTemplateFromFile('Connect');
  t.url = ScriptApp.getService().getUrl() || '';
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(420).setHeight(560), 'Connect your phone');
}

function menuCheck() {
  var r = poll();
  SpreadsheetApp.getUi().alert('Mail checked', JSON.stringify(r), SpreadsheetApp.getUi().ButtonSet.OK);
}

