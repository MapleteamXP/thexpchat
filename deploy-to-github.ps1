# XP-Chat Deployment Script
# Run this in PowerShell with Git installed

param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUsername,
    
    [Parameter(Mandatory=$true)]
    [string]$RepoName = "xp-chat"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  XP-Chat GitHub Deployment Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if git is installed
try {
    $gitVersion = git --version
    Write-Host "✓ Git found: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Git not found! Please install Git first:" -ForegroundColor Red
    Write-Host "  https://git-scm.com/download/win" -ForegroundColor Yellow
    exit 1
}

# Navigate to project directory
$projectDir = "C:\Users\Renau\OneDrive\Documents\Kimi_Agent_XPCHAT\app"
Set-Location $projectDir
Write-Host "✓ Working in: $projectDir" -ForegroundColor Green

# Check if already a git repo
if (Test-Path ".git") {
    Write-Host "✗ Git repository already exists!" -ForegroundColor Red
    Write-Host "  To push updates, run:" -ForegroundColor Yellow
    Write-Host "    git add ." -ForegroundColor Yellow
    Write-Host "    git commit -m 'Your message'" -ForegroundColor Yellow
    Write-Host "    git push" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Step 1: Initializing Git repository..." -ForegroundColor Cyan
git init
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "Step 2: Adding files..." -ForegroundColor Cyan
git add .

Write-Host ""
Write-Host "Step 3: Creating commit..." -ForegroundColor Cyan
git commit -m "XP-Chat v2.0 - Bulletproof auto-reconnect feature

Features:
- Automatic MQTT reconnection with exponential backoff
- WebRTC ICE restart on connection failure
- Network status monitoring (online/offline detection)
- Tab visibility handling for reconnect
- 45 candy rainbow themes
- Separated video/chat UI with manual scroll control
- Quality settings (HD/SD/LD/Audio-only)"

if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "Step 4: Adding GitHub remote..." -ForegroundColor Cyan
$remoteUrl = "https://github.com/$GitHubUsername/$RepoName.git"
git remote add origin $remoteUrl

Write-Host ""
Write-Host "Step 5: Pushing to GitHub..." -ForegroundColor Cyan
git branch -M main
git push -u origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Trying with 'master' branch name..." -ForegroundColor Yellow
    git branch -M master
    git push -u origin master
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  SUCCESS! Code pushed to GitHub!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Go to https://github.com/$GitHubUsername/$RepoName" -ForegroundColor White
    Write-Host "  2. Visit https://app.netlify.com/" -ForegroundColor White
    Write-Host "  3. Click 'Add new site' → 'Import from Git'" -ForegroundColor White
    Write-Host "  4. Select your repository" -ForegroundColor White
    Write-Host "  5. Build command: npm run build" -ForegroundColor White
    Write-Host "  6. Publish directory: dist" -ForegroundColor White
    Write-Host ""
    Write-Host "Repository URL: $remoteUrl" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "✗ Push failed!" -ForegroundColor Red
    Write-Host "  Make sure you've created the repository on GitHub first:" -ForegroundColor Yellow
    Write-Host "  https://github.com/new" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
