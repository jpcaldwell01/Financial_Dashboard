$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ScraperDir = Join-Path $ScriptDir "scraper"

Write-Host ""
Write-Host "=== Rocket Money Balance Scraper ===" -ForegroundColor Cyan
Write-Host ""

Set-Location $ScraperDir
Write-Host "Running scraper in: $ScraperDir" -ForegroundColor Yellow
npm run scrape

Write-Host ""
Write-Host "Scraper finished. You can close this window." -ForegroundColor Green
Write-Host ""
pause
