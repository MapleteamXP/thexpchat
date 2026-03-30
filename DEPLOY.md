# XP-Chat Deployment Guide

## GitHub + Netlify Auto-Deploy Setup

### Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `xp-chat` (or your preferred name)
3. Make it Public (for free Netlify hosting)
4. Do NOT initialize with README (we already have one)
5. Click "Create repository"

### Step 2: Push Code to GitHub

Open PowerShell or Command Prompt with Git installed, then run:

```powershell
# Navigate to project
cd "C:\Users\Renau\OneDrive\Documents\Kimi_Agent_XPCHAT\app"

# Initialize git
git init

# Configure git (if first time)
git config user.name "Your Name"
git config user.email "your@email.com"

# Add all files
git add .

# Commit
git commit -m "XP-Chat v2.0 - Bulletproof auto-reconnect feature

Features:
- Automatic MQTT reconnection with exponential backoff
- WebRTC ICE restart on connection failure
- Network status monitoring (online/offline detection)
- Tab visibility handling for reconnect
- 45 candy rainbow themes
- Separated video/chat UI with manual scroll control
- Quality settings (HD/SD/LD/Audio-only)"

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/xp-chat.git

# Push to GitHub
git push -u origin main
```

If you get an error about `main` branch, try `master` instead:
```powershell
git push -u origin master
```

### Step 3: Connect to Netlify

1. Go to https://app.netlify.com/
2. Sign up/log in (you can use GitHub login)
3. Click "Add new site" → "Import an existing project"
4. Select "GitHub" as Git provider
5. Authorize Netlify to access your GitHub account
6. Find and select your `xp-chat` repository
7. Configure build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
   - Leave other settings as default
8. Click "Deploy site"

### Step 4: Wait for Build

- Netlify will automatically build and deploy your site
- Build takes ~1-2 minutes
- You'll get a URL like `https://xp-chat-123abc.netlify.app`

### Step 5: Custom Domain (Optional)

1. In Netlify dashboard, go to "Domain settings"
2. Click "Add custom domain"
3. Enter your domain and follow DNS instructions

---

## Future Updates (Auto-Deploy)

After initial setup, any push to GitHub will auto-deploy:

```powershell
cd "C:\Users\Renau\OneDrive\Documents\Kimi_Agent_XPCHAT\app"
git add .
git commit -m "Your update description"
git push
```

Netlify will automatically rebuild and deploy!

---

## Troubleshooting

### Build Fails on Netlify
Check build settings match:
- Node version: 20 (set in netlify.toml)
- Build command: `npm run build`
- Publish directory: `dist`

### Git Push Rejected
If you get "rejected: non-fast-forward":
```powershell
git pull origin main --rebase
git push
```

### MQTT Connection Issues
The app uses public HiveMQ broker. For production, consider:
- Setting up your own MQTT broker
- Using WebSocket Secure (wss://) - already configured

---

## Files Explained

| File | Purpose |
|------|---------|
| `.gitignore` | Excludes node_modules and build files from git |
| `netlify.toml` | Configures Netlify build and SPA routing |
| `DEPLOY.md` | This deployment guide |
