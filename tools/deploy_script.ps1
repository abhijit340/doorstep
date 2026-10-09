# Publishes apps-script/ to the sheet's Apps Script project and moves the web-app
# deployment to the new version. The private link stays the same, so phones don't
# need reconnecting.
#
# Run from the project root:  powershell -File tools/deploy_script.ps1 "what changed"
# Needs: clasp (npm install -g @google/clasp), a clasp login for the account that
# owns the script, and a local .clasp.json pointing at it (gitignored).
#
# -User picks the clasp login to use (see `clasp login --user <name>`).

param(
    [Parameter(Mandatory = $true)][string]$Description,
    [string]$User = "auto"
)
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:Path"

node "$PSScriptRoot\..\tests\parse_test.js" | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { throw "Publish blocked: parser tests failed." }

# The live deployment is the one pinned to a version number (not @HEAD).
# Its ID is part of the private link, so it's looked up here rather than stored.
$deployments = clasp --user $User list-deployments 2>&1 | Out-String
$ids = @([regex]::Matches($deployments, "- (\S+) @\d+") | ForEach-Object { $_.Groups[1].Value })
if ($ids.Count -ne 1) {
    throw "Expected exactly one versioned deployment, found $($ids.Count):`n$deployments"
}

clasp --user $User push --force
if ($LASTEXITCODE -ne 0) { throw "clasp push failed" }

clasp --user $User update-deployment $ids[0] --description $Description
if ($LASTEXITCODE -ne 0) { throw "clasp update-deployment failed" }

clasp --user $User list-deployments
