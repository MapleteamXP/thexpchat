import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { themes, type Theme } from './data/themes';
import { emojiCategories } from './data/emojis';
import { useStableChat } from './hooks/useStableChat';
import { useRobustAV } from './hooks/useRobustAV';
import { searchYoutube } from './lib/youtube';

// Theme-aware Logo
const XPChatLogo = ({ theme, size = 'normal' }: { theme: Theme; size?: 'small' | 'normal' | 'large' }) => {
  const sizeClasses = {
    small: 'text-xl',
    normal: 'text-3xl',
    large: 'text-5xl md:text-6xl'
  };
  
  return (
    <div className={`font-display ${sizeClasses[size]} flex items-center gap-1`}>
      <span 
        className="px-2 py-1 rounded-lg"
        style={{ 
          background: theme.gradient,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
        }}
      >
        XP
      </span>
      <span style={{ color: theme.textColor }}>-</span>
      <span style={{ color: theme.accent }}>chat</span>
    </div>
  );
};

function App() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0]);
  const [username, setUsername] = useState<string>('');
  const [tempUsername, setTempUsername] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [tempRoomCode, setTempRoomCode] = useState<string>('');
  const [currentView, setCurrentView] = useState<'welcome' | 'theme' | 'room' | 'chat'>('welcome');

  const [selectedEmojiCategory, setSelectedEmojiCategory] = useState('Smileys');
  const [newMessage, setNewMessage] = useState('');
  const [showYoutube, setShowYoutube] = useState(false);
  const [youtubeSearch, setYoutubeSearch] = useState('');
  const [youtubeResults, setYoutubeResults] = useState<any[]>([]);
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSearchingYoutube, setIsSearchingYoutube] = useState(false);
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  
  // Chat scroll state - manual scroll control
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const {
    messages,
    userCount,
    connectionStatus,
    isReady,
    sendMessage: sendChatMessage,
    sendImage,
  } = useStableChat(username, roomCode);

  const {
    isAudioEnabled,
    isVideoEnabled,
    localVideoStream,
    peers: avPeers,
    error: avError,
    connectionQuality,
    connectionState,
    isReconnecting,
    lastConnectedAt,
    toggleAudio,
    toggleVideo,
    setQuality,
    getDiagnostics,
  } = useRobustAV(roomCode, username, currentView === 'chat');

  // Update local video element
  useEffect(() => {
    if (localVideoRef.current && localVideoStream) {
      localVideoRef.current.srcObject = localVideoStream;
    }
  }, [localVideoStream]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('xp-chat-theme');
    if (savedTheme) {
      const theme = themes.find(t => t.id === savedTheme);
      if (theme) setCurrentTheme(theme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--xp-bg-primary', currentTheme.primary);
    document.documentElement.style.setProperty('--xp-bg-gradient', currentTheme.gradient);
    document.documentElement.style.setProperty('--xp-accent', currentTheme.accent);
    document.documentElement.style.setProperty('--xp-text-primary', currentTheme.textColor);
    document.documentElement.style.setProperty('--xp-text-secondary', currentTheme.textSecondary);
    document.documentElement.style.setProperty('--xp-panel-bg', currentTheme.panelBg);
    document.documentElement.style.setProperty('--xp-panel-border', currentTheme.panelBorder);
    localStorage.setItem('xp-chat-theme', currentTheme.id);
  }, [currentTheme]);

  // Track new messages for unread count instead of auto-scroll
  useEffect(() => {
    if (messages.length === 0) return;
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.username === username) {
      // Our own message - scroll to bottom
      scrollToBottom();
    } else if (!isScrolledToBottom) {
      // New message from others and we're not at bottom - increment unread
      setUnreadCount(prev => prev + 1);
    }
  }, [messages, username, isScrolledToBottom]);

  // Handle scroll events
  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    setIsScrolledToBottom(atBottom);
    if (atBottom) {
      setUnreadCount(0);
    }
  };

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      setIsScrolledToBottom(true);
      setUnreadCount(0);
    }
  };

  // Close quality selector and emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.quality-selector-container')) {
        setShowQualitySelector(false);
      }
      if (!target.closest('.emoji-picker-container') && !target.closest('.emoji-button')) {
        setEmojiPickerPos(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Position emoji picker near the emoji button
  const toggleEmojiPicker = () => {
    if (emojiPickerPos) {
      setEmojiPickerPos(null);
    } else if (emojiButtonRef.current) {
      const rect = emojiButtonRef.current.getBoundingClientRect();
      setEmojiPickerPos({
        top: rect.top - 320, // Position above the button
        left: Math.min(rect.left, window.innerWidth - 340), // Keep within viewport
      });
    }
  };

  const handleUsernameSubmit = () => {
    if (tempUsername.trim()) {
      setUsername(tempUsername.trim());
      setCurrentView('theme');
    }
  };

  const handleThemeSelect = (theme: Theme) => {
    setCurrentTheme(theme);
    setCurrentView('room');
  };

  const handleJoinRoom = () => {
    const code = tempRoomCode.trim() || `room-${Math.random().toString(36).substr(2, 6)}`;
    setRoomCode(code);
    setCurrentView('chat');
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !isReady) return;
    sendChatMessage(newMessage.trim());
    setNewMessage('');
    closeEmojiPicker();
    // Scroll to bottom when sending own message
    setTimeout(scrollToBottom, 100);
  };

  const addEmoji = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    messageInputRef.current?.focus();
  };

  const closeEmojiPicker = () => {
    setEmojiPickerPos(null);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const imageData = event.target?.result as string;
      if (imageData) {
        sendImage(imageData, 'Shared an image');
        setTimeout(scrollToBottom, 100);
      }
    };
    reader.readAsDataURL(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSearchYoutube = async () => {
    if (!youtubeSearch.trim()) return;
    
    setIsSearchingYoutube(true);
    try {
      const videos = await searchYoutube(youtubeSearch);
      setYoutubeResults(videos);
    } catch (error) {
      console.error('YouTube search error:', error);
      setYoutubeResults([]);
    } finally {
      setIsSearchingYoutube(false);
    }
  };

  const playVideo = (videoId: string) => {
    setCurrentVideo(videoId);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Handle quality change with immediate feedback
  const handleQualityChange = (quality: 'high' | 'medium' | 'low' | 'audio-only') => {
    setQuality(quality);
    setShowQualitySelector(false);
  };

  const renderWelcome = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="mb-8 animate-fade-in">
        <XPChatLogo theme={currentTheme} size="large" />
      </div>
      
      <div className="xp-panel w-full max-w-sm p-6 md:p-8">
        <h1 className="font-display text-3xl md:text-4xl text-center mb-4" style={{ color: currentTheme.primary }}>
          DROP IN
        </h1>
        <p className="text-center text-sm mb-6 opacity-70" style={{ color: currentTheme.textColor === '#FFFFFF' ? '#333' : '#fff' }}>
          Enter any username to start chatting
        </p>
        
        <input
          type="text"
          placeholder="Your nickname"
          value={tempUsername}
          onChange={(e) => setTempUsername(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleUsernameSubmit()}
          className="xp-input w-full mb-4"
          style={{ color: '#333' }}
        />
        <button
          onClick={handleUsernameSubmit}
          className="xp-button w-full py-3 font-bold text-white"
          style={{ background: currentTheme.gradient }}
        >
          Start Chatting
        </button>
      </div>
    </div>
  );

  const renderThemePicker = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <XPChatLogo theme={currentTheme} size="normal" />
      <h1 className="font-display text-2xl md:text-3xl mt-4 mb-2 text-center" style={{ color: currentTheme.textColor }}>
        Choose Your Flavor
      </h1>
      <p className="mb-4 text-sm opacity-70" style={{ color: currentTheme.textColor }}>45 candy themes</p>
      
      <div className="xp-panel w-full max-w-4xl p-4 max-h-[50vh] overflow-y-auto">
        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2 md:gap-3">
          {themes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => handleThemeSelect(theme)}
              className={`theme-swatch ${currentTheme.id === theme.id ? 'active' : ''}`}
              style={{ background: theme.gradient }}
              title={theme.name}
            />
          ))}
        </div>
        <p className="text-center mt-4 font-retro text-xs" style={{ color: currentTheme.textColor }}>
          Selected: {currentTheme.name}
        </p>
      </div>
    </div>
  );

  const renderRoom = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <XPChatLogo theme={currentTheme} size="normal" />
      
      <div className="xp-panel w-full max-w-sm p-6 mt-4">
        <h2 className="font-display text-2xl text-center mb-4" style={{ color: currentTheme.primary }}>
          Join a Room
        </h2>
        
        <input
          type="text"
          placeholder="Room code (or leave blank)"
          value={tempRoomCode}
          onChange={(e) => setTempRoomCode(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleJoinRoom()}
          className="xp-input w-full mb-4"
          style={{ color: '#333' }}
        />
        <button
          onClick={handleJoinRoom}
          className="xp-button w-full py-3 font-bold text-white"
          style={{ background: currentTheme.gradient }}
        >
          {tempRoomCode.trim() ? 'Join Room' : 'Create Room'}
        </button>
        
        <div className="mt-4 p-3 rounded-xl bg-black/5 text-xs text-center">
          <p style={{ color: currentTheme.textColor === '#FFFFFF' ? '#333' : '#fff', opacity: 0.8 }}>
            Share your room code with friends to chat together!
          </p>
        </div>
      </div>
    </div>
  );

  const renderChat = () => (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-2 md:p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-2 md:gap-3">
          <XPChatLogo theme={currentTheme} size="small" />
          <div className="flex items-center gap-1 md:gap-2 flex-wrap">
            <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></span>
            <span className="text-xs hidden sm:inline" style={{ color: currentTheme.textColor }}>{connectionStatus}</span>
            {isReconnecting && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/50 text-yellow-100 animate-pulse">
                🔄
              </span>
            )}
            {(isAudioEnabled || isVideoEnabled) && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                connectionQuality === 'high' ? 'bg-green-500/50 text-green-100' :
                connectionQuality === 'medium' ? 'bg-blue-500/50 text-blue-100' :
                connectionQuality === 'low' ? 'bg-orange-500/50 text-orange-100' :
                'bg-gray-500/50 text-gray-100'
              }`}>
                {connectionQuality === 'high' ? 'HD' : connectionQuality === 'medium' ? 'SD' : connectionQuality === 'low' ? 'LD' : 'AU'}
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1 md:gap-2">
          {/* Quality selector - only show when AV is active */}
          {(isAudioEnabled || isVideoEnabled) && (
            <div className="relative quality-selector-container">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowQualitySelector(!showQualitySelector);
                }}
                className="xp-button px-2 md:px-3 py-2 text-xs md:text-sm font-bold text-white"
                style={{ background: '#6366F1' }}
                title="Quality settings"
              >
                ⚙️
              </button>
              {showQualitySelector && (
                <div className="absolute right-0 top-full mt-1 xp-panel p-2 z-50 min-w-[140px]">
                  <p className="text-xs font-bold mb-2" style={{ color: currentTheme.textColor }}>Quality</p>
                  {(['high', 'medium', 'low', 'audio-only'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => handleQualityChange(q)}
                      className={`w-full text-left px-2 py-1 rounded text-xs mb-1 ${
                        connectionQuality === q ? 'text-white' : 'hover:bg-white/10'
                      }`}
                      style={connectionQuality === q ? { background: currentTheme.gradient } : { color: currentTheme.textColor }}
                    >
                      {q === 'high' ? '🔥 High (HD)' : q === 'medium' ? '⚡ Medium (SD)' : q === 'low' ? '📉 Low (LD)' : '🔊 Audio Only'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Audio button */}
          <button
            onClick={toggleAudio}
            className={`xp-button px-2 md:px-3 py-2 text-xs md:text-sm font-bold text-white ${isAudioEnabled ? 'animate-pulse' : ''}`}
            style={{ background: isAudioEnabled ? '#32D657' : currentTheme.gradient }}
            title="Toggle voice chat"
          >
            {isAudioEnabled ? '🎤' : '🎤'}
            <span className="hidden sm:inline ml-1">{isAudioEnabled ? 'ON' : 'OFF'}</span>
          </button>
          
          {/* Video button */}
          <button
            onClick={toggleVideo}
            className={`xp-button px-2 md:px-3 py-2 text-xs md:text-sm font-bold text-white ${isVideoEnabled ? 'animate-pulse' : ''}`}
            style={{ background: isVideoEnabled ? '#FF6A00' : currentTheme.gradient }}
            title="Toggle video"
          >
            {isVideoEnabled ? '📹' : '📹'}
            <span className="hidden sm:inline ml-1">{isVideoEnabled ? 'ON' : 'OFF'}</span>
          </button>
          
          {/* YouTube button */}
          <button
            onClick={() => setShowYoutube(!showYoutube)}
            className="xp-button px-2 md:px-3 py-2 text-xs md:text-sm font-bold text-white"
            style={{ background: showYoutube ? '#FF0000' : currentTheme.gradient }}
          >
            {showYoutube ? '❌' : '🎬'}
          </button>
          
          {/* Theme button */}
          <button
            onClick={() => setCurrentView('theme')}
            className="xp-button px-2 md:px-3 py-2 text-xs md:text-sm font-bold text-white hidden sm:block"
            style={{ background: currentTheme.gradient }}
          >
            🎨
          </button>
          
          {/* Debug/Diagnostics button */}
          <button
            onClick={async () => {
              const diag = await getDiagnostics();
              alert('Diagnostics logged to console. Press F12 to view.');
              console.log(JSON.stringify(diag, null, 2));
            }}
            className="xp-button px-2 md:px-3 py-2 text-xs md:text-sm font-bold text-white hidden md:block"
            style={{ background: '#666' }}
            title="Run diagnostics (F12 for console)"
          >
            🔧
          </button>
        </div>
      </div>
      
      {/* Error messages */}
      {avError && (
        <div className="mx-2 md:mx-4 mt-2 p-2 rounded-lg bg-red-500/30 text-red-100 text-xs text-center">
          ⚠️ {avError}
        </div>
      )}
      
      {/* Room info bar */}
      <div className="mx-2 md:mx-4 mt-2 p-2 md:p-3 rounded-xl bg-white/10 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs md:text-sm font-bold truncate max-w-[100px] sm:max-w-[150px]" style={{ color: currentTheme.textColor }}>
            Room: {roomCode}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/20" style={{ color: currentTheme.textColor }}>
            {userCount} users
          </span>
          {/* Connection state indicator */}
          {(isAudioEnabled || isVideoEnabled) && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              connectionState === 'connected' ? 'bg-green-500/40 text-green-100' :
              connectionState === 'reconnecting' ? 'bg-yellow-500/40 text-yellow-100 animate-pulse' :
              connectionState === 'failed' ? 'bg-red-500/40 text-red-100' :
              'bg-gray-500/40 text-gray-100'
            }`}
            title={`${connectionState}${lastConnectedAt ? ` - Last connected: ${new Date(lastConnectedAt).toLocaleTimeString()}` : ''}`}
            >
              {connectionState === 'connected' ? '🔒' : connectionState === 'reconnecting' ? '🔄' : connectionState === 'failed' ? '❌' : '⏳'} {connectionState}
            </span>
          )}
          {/* Quality indicator */}
          {(isAudioEnabled || isVideoEnabled) && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              connectionQuality === 'high' ? 'bg-green-500/40 text-green-100' :
              connectionQuality === 'medium' ? 'bg-blue-500/40 text-blue-100' :
              connectionQuality === 'low' ? 'bg-orange-500/40 text-orange-100' :
              'bg-gray-500/40 text-gray-100'
            }`}>
              {connectionQuality === 'high' ? '🔥 HD' : connectionQuality === 'medium' ? '⚡ SD' : connectionQuality === 'low' ? '📉 LD' : '🔊 Audio'}
            </span>
          )}
          {isReconnecting && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/40 text-yellow-100 animate-pulse">
              🔄 Reconnecting...
            </span>
          )}
        </div>
        <button 
          onClick={() => {
            navigator.clipboard.writeText(roomCode);
            const btn = document.activeElement as HTMLButtonElement;
            const originalText = btn.innerText;
            btn.innerText = '✓ Copied!';
            setTimeout(() => btn.innerText = originalText, 1500);
          }}
          className="text-xs px-2 md:px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          style={{ color: currentTheme.textColor }}
        >
          Copy
        </button>
      </div>
      
      {/* Main content area - SEPARATED LAYOUT */}
      <div className="flex-1 flex flex-col md:flex-row gap-2 md:gap-4 p-2 md:p-4 overflow-hidden">
        
        {/* LEFT PANEL: Video Grid - Fixed position, independent scroll */}
        <div className="flex flex-col gap-2 md:w-64 lg:w-72 shrink-0">
          {/* Video panel - only show when video enabled or peers exist */}
          {(isVideoEnabled || avPeers.size > 0) && (
            <div className="xp-panel p-2 md:p-4 flex flex-col gap-2 max-h-[35vh] md:max-h-[calc(100vh-200px)] overflow-y-auto">
              <h3 className="text-xs font-bold mb-1 flex items-center justify-between sticky top-0 bg-inherit py-1" style={{ color: currentTheme.textColor }}>
                <span>Video</span>
                {avPeers.size > 0 && (
                  <span className="text-[10px] opacity-60">{avPeers.size + (isVideoEnabled ? 1 : 0)} participants</span>
                )}
              </h3>
              
              {/* Local video */}
              {isVideoEnabled && localVideoStream && (
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden border-2 border-green-500/50 shrink-0">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget;
                      video.play().catch(err => console.log('Local video play failed:', err));
                    }}
                  />
                  <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-white font-medium">
                    You
                  </span>
                  {connectionQuality !== 'high' && (
                    <span className="absolute top-1 right-1 text-[8px] bg-black/60 px-1 rounded text-white">
                      {connectionQuality === 'medium' ? 'SD' : connectionQuality === 'low' ? 'LD' : 'AU'}
                    </span>
                  )}
                </div>
              )}
              
              {/* Remote videos */}
              {Array.from(avPeers.values()).map((peer) => (
                peer.videoStream && (
                  <div key={peer.id} className="relative aspect-video bg-black rounded-lg overflow-hidden shrink-0">
                    <RemoteVideo stream={peer.videoStream} username={peer.username} />
                    <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-white font-medium">
                      {peer.username}
                    </span>
                    {!peer.connected && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-xs text-white animate-pulse">Reconnecting...</span>
                      </div>
                    )}
                  </div>
                )
              ))}
            </div>
          )}
          
          {/* Audio indicator when only audio is enabled */}
          {isAudioEnabled && !isVideoEnabled && avPeers.size > 0 && (
            <div className="xp-panel p-3">
              <h3 className="text-xs font-bold mb-2" style={{ color: currentTheme.textColor }}>Voice Chat Active</h3>
              <div className="flex flex-wrap gap-1">
                <span className="text-xs px-2 py-1 rounded-full bg-green-500/30 text-green-100 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  🎤 You
                </span>
                {Array.from(avPeers.values()).map((peer) => (
                  <AudioPeerIndicator key={peer.id} peer={peer} />
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* MIDDLE PANEL: Chat area - Fixed height with scroll */}
        <div className="flex-1 xp-panel flex flex-col h-[calc(100vh-180px)] md:h-auto md:min-h-0 relative">
          {/* Messages - Scrollable container */}
          <div 
            ref={chatContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto space-y-2 md:space-y-3 p-2 md:p-4 pr-1"
          >
            {messages.length === 0 && (
              <div className="text-center py-8 opacity-50">
                <p className="text-lg mb-2" style={{ color: currentTheme.textColor }}>Welcome to {roomCode}!</p>
                <p className="text-sm" style={{ color: currentTheme.textColor }}>Share this room code with friends.</p>
              </div>
            )}
            
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.username === username ? 'items-end' : msg.username === 'System' ? 'items-center' : 'items-start'}`}
              >
                {msg.username !== 'System' && (
                  <span className="text-xs opacity-60 mb-0.5" style={{ color: currentTheme.textColor }}>
                    {msg.username} • {formatTime(msg.timestamp)}
                  </span>
                )}
                
                {msg.type === 'image' && msg.imageData ? (
                  <div className="max-w-[200px] md:max-w-[300px]">
                    <img 
                      src={msg.imageData} 
                      alt="Shared" 
                      className="rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => {
                        setSelectedImage(msg.imageData!);
                        setShowImageModal(true);
                      }}
                    />
                  </div>
                ) : (
                  <div 
                    className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm md:text-base ${
                      msg.username === username 
                        ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white rounded-br-sm' 
                        : msg.username === 'System' 
                          ? 'bg-gray-400/50 text-gray-200 text-xs px-2 py-1' 
                          : 'bg-white/90 text-gray-800 rounded-bl-sm'
                    }`}
                  >
                    {msg.text}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Scroll to bottom button - appears when not at bottom */}
          {!isScrolledToBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-20 right-4 xp-button px-3 py-2 text-xs font-bold text-white shadow-lg animate-bounce z-10"
              style={{ background: currentTheme.gradient }}
            >
              ↓ {unreadCount > 0 ? `${unreadCount} new` : 'New messages'}
            </button>
          )}
          
          {/* Input area - Fixed at bottom of chat panel */}
          <div className="border-t p-2 md:p-3 shrink-0" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
            <div className="flex gap-1 md:gap-2 items-center">
              <button
                ref={emojiButtonRef}
                onClick={toggleEmojiPicker}
                className="emoji-button p-2 rounded-full hover:bg-white/10 text-lg md:text-xl transition-colors"
              >
                😀
              </button>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-full hover:bg-white/10 text-lg md:text-xl transition-colors"
              >
                📎
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
              
              <input
                ref={messageInputRef}
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                className="flex-1 px-3 md:px-4 py-2 rounded-full text-sm md:text-base outline-none"
                style={{ 
                  color: '#333', 
                  background: 'rgba(255,255,255,0.95)',
                  border: '2px solid rgba(0,0,0,0.1)'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!isReady}
                className="xp-button px-3 md:px-4 py-2 font-bold text-white text-sm disabled:opacity-50"
                style={{ background: currentTheme.gradient }}
              >
                Send
              </button>
            </div>
            
          </div>

          {/* Emoji picker - Floating overlay positioned near the emoji button */}
          {emojiPickerPos && (
            <div 
              className="emoji-picker-container fixed z-50 xp-panel p-3 md:p-4 shadow-2xl"
              style={{ 
                top: `${emojiPickerPos.top}px`, 
                left: `${emojiPickerPos.left}px`,
                width: '320px',
                maxHeight: '300px',
              }}
            >
              {/* Close button */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: currentTheme.textColor }}>Emojis</span>
                <button 
                  onClick={closeEmojiPicker}
                  className="text-xs px-2 py-1 rounded-full hover:bg-white/10"
                  style={{ color: currentTheme.textColor }}
                >
                  ✕ Close
                </button>
              </div>
              
              {/* Category tabs */}
              <div className="flex gap-1 mb-2 overflow-x-auto pb-1 scrollbar-thin">
                {emojiCategories.map((cat) => (
                  <button
                    key={cat.name}
                    onClick={() => setSelectedEmojiCategory(cat.name)}
                    className={`px-2 py-1 rounded-full text-xs whitespace-nowrap transition-all ${selectedEmojiCategory === cat.name ? 'text-white shadow-md' : 'bg-black/10 hover:bg-black/20'}`}
                    style={selectedEmojiCategory === cat.name ? { background: currentTheme.gradient } : {}}
                    title={cat.name}
                  >
                    {cat.icon}
                  </button>
                ))}
              </div>
              
              {/* Emoji grid */}
              <div className="grid grid-cols-8 gap-1 max-h-[180px] overflow-y-auto p-1">
                {emojiCategories
                  .find(cat => cat.name === selectedEmojiCategory)
                  ?.emojis.map((emoji, i) => (
                    <button 
                      key={i} 
                      onClick={() => addEmoji(emoji)} 
                      className="text-lg md:text-xl p-1.5 hover:bg-white/20 rounded-lg text-center transition-transform hover:scale-125"
                    >
                      {emoji}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
        
        {/* RIGHT PANEL: YouTube panel */}
        {showYoutube && (
          <div className="xp-panel w-full md:w-72 p-2 md:p-4 flex flex-col shrink-0">
            <h3 className="text-xs font-bold mb-2" style={{ color: currentTheme.textColor }}>Mini Theater</h3>
            
            <div className="flex gap-1 mb-2">
              <input
                type="text"
                placeholder="Search YouTube..."
                value={youtubeSearch}
                onChange={(e) => setYoutubeSearch(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearchYoutube()}
                className="flex-1 px-2 py-1 rounded-full text-xs"
                style={{ color: '#333', border: '1px solid rgba(0,0,0,0.1)' }}
              />
              <button 
                onClick={handleSearchYoutube} 
                disabled={isSearchingYoutube}
                className="xp-button px-2 py-1 text-white text-xs disabled:opacity-50" 
                style={{ background: '#FF0000' }}
              >
                {isSearchingYoutube ? '⏳' : '🔍'}
              </button>
            </div>
            
            {currentVideo && (
              <div className="youtube-player mb-2">
                <iframe
                  src={`https://www.youtube.com/embed/${currentVideo}?autoplay=1`}
                  title="YouTube"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
            
            <div className="space-y-1 overflow-y-auto flex-1 max-h-64">
              {isSearchingYoutube ? (
                <div className="text-center py-4 text-xs opacity-60" style={{ color: currentTheme.textColor }}>
                  Searching...
                </div>
              ) : youtubeResults.length === 0 ? (
                <div className="text-center py-4 text-xs opacity-60" style={{ color: currentTheme.textColor }}>
                  {youtubeSearch ? 'No results found' : 'Search for videos'}
                </div>
              ) : (
                youtubeResults.map((v) => (
                  <button key={v.id} onClick={() => playVideo(v.id)} className="flex gap-2 w-full text-left hover:bg-white/10 p-1 rounded group">
                    <div className="relative flex-shrink-0">
                      <img src={v.thumbnail} alt="" className="w-16 h-12 object-cover rounded" />
                      {v.lengthSeconds && (
                        <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[10px] px-1 rounded">
                          {Math.floor(v.lengthSeconds / 60)}:{String(v.lengthSeconds % 60).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs line-clamp-2 block" style={{ color: currentTheme.textColor }}>
                        {v.title}
                      </span>
                      {v.author && (
                        <span className="text-[10px] opacity-60 block truncate" style={{ color: currentTheme.textColor }}>
                          {v.author}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Image modal */}
      {showImageModal && selectedImage && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowImageModal(false)}
        >
          <img 
            src={selectedImage} 
            alt="Full size" 
            className="max-w-full max-h-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="xp-bg min-h-screen">
      <div className="grain-overlay"></div>
      <div className="relative z-10">
        {currentView === 'welcome' && renderWelcome()}
        {currentView === 'theme' && renderThemePicker()}
        {currentView === 'room' && renderRoom()}
        {currentView === 'chat' && renderChat()}
      </div>
    </div>
  );
}

// Remote video component with audio level indicator
function RemoteVideo({ stream, username }: { stream: MediaStream; username: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      console.log('RemoteVideo: Setting stream', stream.id, 'with', stream.getTracks().length, 'tracks');
      video.srcObject = stream;
      
      // Ensure video plays
      const playVideo = async () => {
        try {
          video.muted = false;
          await video.play();
          console.log('RemoteVideo: Playing successfully');
        } catch (err) {
          console.log('RemoteVideo: Autoplay blocked, will retry:', err);
          // Retry on user interaction
          const handler = () => {
            video.play().catch(console.error);
            document.removeEventListener('click', handler);
            document.removeEventListener('touchstart', handler);
          };
          document.addEventListener('click', handler, { once: true });
          document.addEventListener('touchstart', handler, { once: true });
        }
      };
      
      playVideo();
      
      // Listen for track changes
      stream.onaddtrack = () => {
        console.log('RemoteVideo: Track added to stream');
        playVideo();
      };
      
      return () => {
        video.pause();
        video.srcObject = null;
      };
    }
  }, [stream]);
  
  // Audio level visualization
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    
    // @ts-ignore
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyserRef.current = analyser;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(average);
      animationRef.current = requestAnimationFrame(updateLevel);
    };
    
    updateLevel();
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      audioContext.close();
    };
  }, [stream]);
  
  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        className="w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />
      {/* Audio level indicator */}
      {stream.getAudioTracks().length > 0 && (
        <div className="absolute bottom-1 right-1 flex items-end gap-0.5 h-3 bg-black/60 px-1 py-0.5 rounded">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-0.5 bg-green-400 transition-all duration-75"
              style={{
                height: `${Math.min(100, (audioLevel / (i * 30)) * 100)}%`,
                opacity: audioLevel > i * 20 ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Audio-only peer indicator with visual feedback
function AudioPeerIndicator({ peer }: { peer: any }) {
  const [audioLevel, setAudioLevel] = useState(0);
  
  useEffect(() => {
    if (!peer.audioStream) return;
    
    // @ts-ignore
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(peer.audioStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationId: number;
    
    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(average);
      animationId = requestAnimationFrame(updateLevel);
    };
    
    updateLevel();
    
    return () => {
      cancelAnimationFrame(animationId);
      audioContext.close();
    };
  }, [peer.audioStream]);
  
  return (
    <span className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 transition-all ${
      peer.connected ? 'bg-blue-500/30 text-blue-100' : 'bg-gray-500/30 text-gray-300'
    }`}>
      <span className={`w-2 h-2 rounded-full ${audioLevel > 10 ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
      🎤 {peer.username}
    </span>
  );
}

export default App;
