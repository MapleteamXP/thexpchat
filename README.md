# 🌈 XP-Chat

A colorful, retro-themed video and text chat application built with React, WebRTC, and MQTT.

![XP-Chat Screenshot](https://placehold.co/600x400/gradient/purple/white?text=XP-Chat)

## ✨ Features

### 📹 Video & Audio
- **Bulletproof Auto-Reconnect** - Never lose connection with automatic recovery
- **WebRTC Peer-to-Peer** - Direct browser-to-browser video/audio calls
- **Adaptive Quality** - Auto-adjusts from HD to Audio-only based on network conditions
- **Multi-Peer Support** - Group video calls with multiple participants
- **Smart ICE Restart** - Automatically recovers from connection failures

### 💬 Chat
- **Real-time Messaging** - Instant text chat via MQTT
- **Image Sharing** - Send photos directly in chat
- **Emoji Picker** - Fun emoji reactions
- **Manual Scroll Control** - No annoying auto-scroll jumping

### 🎨 Themes
- **45 Candy Rainbow Themes** - From Cotton Candy to Neon Cyberpunk
- **Gradient Backgrounds** - Beautiful animated gradients
- **Retro XP Styling** - Nostalgic Windows XP-inspired UI

### 🎬 Entertainment
- **YouTube Mini Theater** - Watch videos together while chatting
- **Search & Play** - Built-in YouTube video search

## 🚀 Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui
- **Real-time**: MQTT (HiveMQ public broker)
- **Video**: WebRTC with multiple STUN/TURN servers
- **Build**: Vite with optimized chunking

## 🛠️ Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## 📦 Deployment

### Option 1: Automated PowerShell Script

```powershell
# Run the deployment script
.\deploy-to-github.ps1 -GitHubUsername "yourusername" -RepoName "xp-chat"
```

### Option 2: Manual Git Setup

```bash
# Navigate to project
cd "C:\Users\Renau\OneDrive\Documents\Kimi_Agent_XPCHAT\app"

# Initialize and push
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/xp-chat.git
git push -u origin main
```

### Netlify Setup

1. Go to [Netlify](https://app.netlify.com/)
2. Click "Add new site" → "Import from Git"
3. Select your GitHub repository
4. Build settings (already configured in `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Deploy!

See [DEPLOY.md](DEPLOY.md) for detailed instructions.

## 🌐 Live Demo

**Coming soon** - Deploy your own instance!

## 🔧 Configuration

### MQTT Broker
The app uses HiveMQ's public WebSocket broker by default:
```
wss://broker.hivemq.com:8884/mqtt
```

For production, consider setting up your own MQTT broker.

### STUN/TURN Servers
Pre-configured with multiple servers for maximum connectivity:
- Google STUN servers
- OpenRelay TURN servers

## 📱 Mobile Support

XP-Chat works on mobile devices with:
- Responsive design
- Touch-friendly controls
- Adaptive video quality for mobile networks

## 🎨 Themes List

| Theme | Description |
|-------|-------------|
| Bubblegum | Pink and purple gradient |
| Cotton Candy | Soft blue and pink |
| Sunset | Orange and pink |
| Ocean | Blue and teal |
| Rainbow Burst | Full rainbow gradient |
| Neon Rainbow | Cyberpunk neon colors |
| Aurora Borealis | Cyan and magenta |
| ...and 38 more! | |

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

MIT License - feel free to use this for your own projects!

## 🙏 Credits

- Icons and emojis from various open-source projects
- MQTT broker courtesy of HiveMQ
- TURN servers from OpenRelay

---

Made with 💖 and 🌈
