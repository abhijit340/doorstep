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
    .addToUi();
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

