import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';
import { themes, type Theme } from './data/themes';
import { emojiCategories } from './data/emojis';
import { useStableChat, GLOBAL_ROOM } from './hooks/useStableChat';
import { useRobustAV } from './hooks/useRobustAV';
import { searchYoutube } from './lib/youtube';

// Theme-aware Logo
const XPChatLogo = ({ theme, size = 'normal' }: { theme: Theme; size?: 'small' | 'normal' | 'large' }) => {
  const sizeClasses = {
    small: { text: 'text-lg', icon: 'text-sm', badge: 'text-[8px]' },
    normal: { text: 'text-2xl', icon: 'text-lg', badge: 'text-[10px]' },
    large: { text: 'text-4xl md:text-5xl', icon: 'text-2xl md:text-3xl', badge: 'text-xs' }
  };
  
  return (
    <div className={`font-display ${sizeClasses[size].text} flex items-center gap-1 select-none`}>
      <div className="relative">
        <span 
          className={`${sizeClasses[size].icon} font-black px-1.5 py-0.5 rounded skew-x-[-10deg]`}
          style={{ 
            background: theme.gradient,
            boxShadow: '0 0 15px rgba(255,255,255,0.4), 0 4px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.2)'
          }}
        >
          <span className="block skew-x-[10deg] text-white">XP</span>
        </span>
        <div className="absolute inset-0 rounded animate-ping opacity-30" style={{ background: theme.gradient }} />
      </div>
      
      <span className="relative mx-0.5 opacity-80" style={{ color: theme.accent }}>
        <span className="absolute inset-0 animate-spin" style={{ animationDuration: '4s' }}>✦</span>
        <span className="relative">✦</span>
      </span>
      
      <div className="relative">
        <span 
          className="font-black tracking-wider italic"
          style={{ 
            color: theme.textColor,
            textShadow: `-1px -1px 0 ${theme.accent}, 1px 1px 0 rgba(0,0,0,0.5), 0 0 10px ${theme.accent}80`
          }}
        >
          CHAT
        </span>
      </div>
      
      <span 
        className={`${sizeClasses[size].badge} px-1 py-0 rounded font-bold ml-0.5`}
        style={{ 
          background: 'linear-gradient(135deg, #ff0066, #ff6600)',
          color: 'white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
        }}
      >
        PRO
      </span>
    </div>
  );
};

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// File download helper
const downloadFile = (dataUrl: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

function App() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0]);
  const [username, setUsername] = useState<string>('');
  const [tempUsername, setTempUsername] = useState<string>('');
  const [currentView, setCurrentView] = useState<'welcome' | 'chat'>('welcome');
  const [showThemeModal, setShowThemeModal] = useState(false);

  const [selectedEmojiCategory, setSelectedEmojiCategory] = useState('Smileys');
  const [newMessage, setNewMessage] = useState('');
  const [showYoutube, setShowYoutube] = useState(false);
  const [youtubeSearch, setYoutubeSearch] = useState('');
  const [youtubeResults, setYoutubeResults] = useState<any[]>([]);
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSearchingYoutube, setIsSearchingYoutube] = useState(false);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  
  // Chat scroll state
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
    sendVoice,
    sendFile,
    clearMessages,
  } = useStableChat(username);

  const {
    isAudioEnabled,
    isVideoEnabled,
    peers: avPeers,
    localVideoStream,
    error: avError,
    connectionQuality,
    connectionState,
    isReconnecting,
    activePeerCount,
    toggleAudio,
    toggleVideo,
    setQuality,
    getDiagnostics,
    globalAudioUnlock,
  } = useRobustAV(GLOBAL_ROOM, username, currentView === 'chat');

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

  const startRecording = async () => {
    if (isRecordingRef.current) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 }
      });
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data?.size > 0) audioChunksRef.current.push(event.data);
      };
      
      mediaRecorder.onstop = () => {
        const actualDuration = Math.round((Date.now() - recordingStartTimeRef.current) / 1000);
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        sendVoiceMessage(audioBlob, actualDuration);
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start(100);
      recordingStartTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingDuration(0);
      
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000);
        setRecordingDuration(elapsed);
        if (elapsed >= 60) forceStopRecording();
      }, 100);
    } catch (err) {
      alert('Could not access microphone.');
    }
  };

  const forceStopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    }
  };

  const sendVoiceMessage = (audioBlob: Blob, actualDuration: number) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const audioData = event.target?.result as string;
      if (audioData && isReady) {
        sendVoice(audioData, Math.max(1, Math.min(actualDuration, 60)));
        setTimeout(scrollToBottom, 100);
      }
    };
    reader.readAsDataURL(audioBlob);
  };

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && isRecordingRef.current) mediaRecorderRef.current.stop();
    };
  }, []);

  // Update local video
  useEffect(() => {
    if (localVideoRef.current && localVideoStream) {
      localVideoRef.current.srcObject = localVideoStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localVideoStream]);

  // Load saved theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('xp-chat-theme');
    if (savedTheme) {
      const theme = themes.find(t => t.id === savedTheme);
      if (theme) setCurrentTheme(theme);
    }
  }, []);

  // Theme effect
  useEffect(() => {
    document.documentElement.style.setProperty('--xp-bg-primary', currentTheme.primary);
    document.documentElement.style.setProperty('--xp-bg-gradient', currentTheme.gradient);
    document.documentElement.style.setProperty('--xp-accent', currentTheme.accent);
    document.documentElement.style.setProperty('--xp-text-primary', currentTheme.textColor);
    document.documentElement.style.setProperty('--xp-text-secondary', currentTheme.textSecondary);
    document.documentElement.style.setProperty('--xp-panel-bg', currentTheme.panelBg);
    document.documentElement.style.setProperty('--xp-panel-border', currentTheme.panelBorder);
    localStorage.setItem('xp-chat-theme', currentTheme.id);
  }, [currentTheme.id]);

  // Scroll handling
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageCountRef = useRef(messages.length);

  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    
    isUserScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => { isUserScrollingRef.current = false; }, 1000);
    
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    setIsScrolledToBottom(atBottom);
    if (atBottom) setUnreadCount(0);
  }, []);

  useEffect(() => {
    if (messages.length === 0) { lastMessageCountRef.current = 0; return; }
    if (messages.length <= lastMessageCountRef.current) return;
    lastMessageCountRef.current = messages.length;
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage.username === username && !isUserScrollingRef.current) {
      setTimeout(() => {
        if (chatContainerRef.current && !isUserScrollingRef.current) {
          chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
          setIsScrolledToBottom(true);
          setUnreadCount(0);
        }
      }, 150);
    } else if (lastMessage.username !== username && isScrolledToBottom && !isUserScrollingRef.current) {
      setTimeout(() => {
        if (chatContainerRef.current && !isUserScrollingRef.current) {
          chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
      }, 150);
    } else if (lastMessage.username !== username) {
      setUnreadCount(prev => prev + 1);
    }
  }, [messages, username, isScrolledToBottom]);

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      setIsScrolledToBottom(true);
      setUnreadCount(0);
    }
  };

  // Close emoji picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.emoji-picker-container') && !target.closest('.emoji-button')) {
        setEmojiPickerPos(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const toggleEmojiPicker = () => {
    if (emojiPickerPos) {
      setEmojiPickerPos(null);
    } else if (emojiButtonRef.current) {
      const rect = emojiButtonRef.current.getBoundingClientRect();
      setEmojiPickerPos({
        top: Math.max(10, rect.top - 320),
        left: Math.min(rect.left, window.innerWidth - 340),
      });
    }
  };

  const handleUsernameSubmit = () => {
    if (tempUsername.trim()) {
      setUsername(tempUsername.trim());
      setShowThemeModal(true);
    }
  };

  const handleThemeSelect = useCallback((theme: Theme) => {
    if (theme.id !== currentTheme.id) setCurrentTheme(theme);
    setShowThemeModal(false);
    setCurrentView('chat');
  }, [currentTheme.id]);

  const sendMessage = () => {
    if (!newMessage.trim() || !isReady) return;
    sendChatMessage(newMessage.trim());
    setNewMessage('');
    closeEmojiPicker();
    setTimeout(scrollToBottom, 100);
  };

  const addEmoji = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    messageInputRef.current?.focus();
  };

  const closeEmojiPicker = () => setEmojiPickerPos(null);

  // Enhanced file upload handler
  const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB limit for stability
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large! Maximum size is 25MB. Your file is ${formatFileSize(file.size)}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    setIsFileUploading(true);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const fileData = event.target?.result as string;
      if (!fileData) {
        setIsFileUploading(false);
        return;
      }
      
      const isImage = file.type.startsWith('image/');
      
      if (isImage) {
        sendImage(fileData, `📷 ${file.name}`);
      } else {
        sendFile(fileData, file.name, file.size, file.type);
      }
      
      setIsFileUploading(false);
      setTimeout(scrollToBottom, 100);
    };
    
    reader.onerror = () => {
      alert('Failed to read file.');
      setIsFileUploading(false);
    };
    
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSearchYoutube = async () => {
    if (!youtubeSearch.trim()) return;
    setIsSearchingYoutube(true);
    try {
      const videos = await searchYoutube(youtubeSearch);
      setYoutubeResults(videos);
    } catch (error) {
      setYoutubeResults([]);
    } finally {
      setIsSearchingYoutube(false);
    }
  };

  const playVideo = (videoId: string) => setCurrentVideo(videoId);
  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Error logs
  const [errorLogs, setErrorLogs] = useState<Array<{type: 'error' | 'info' | 'warn', message: string, timestamp: string}>>([]);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const addErrorLog = (message: string, type: 'error' | 'info' | 'warn' = 'error') => {
    const timestamp = new Date().toLocaleTimeString();
    setErrorLogs(prev => [...prev.slice(-99), { type, message, timestamp }]);
  };

  const runFullDiagnostics = async () => {
    try {
      const diag = await getDiagnostics();
      setDiagnosticsData(diag);
      setShowDiagnostics(true);
    } catch (err) {
      addErrorLog(`Diagnostics failed: ${err}`, 'error');
    }
  };

  const handleWipeHistory = () => {
    if (confirm('Clear all chat messages from your view?')) {
      clearMessages();
      addErrorLog('Chat history cleared', 'info');
    }
  };

  // Render functions
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
          maxLength={20}
        />
        <button
          onClick={handleUsernameSubmit}
          disabled={!tempUsername.trim()}
          className="xp-button w-full py-3 font-bold text-white disabled:opacity-50 transition-opacity"
          style={{ background: currentTheme.gradient }}
        >
          Start Chatting
        </button>
      </div>
    </div>
  );

  // Modern Webcam Grid with connection limit indicator
  const WebcamGrid = ({ isVideoEnabled, localVideoStream, avPeers }: { isVideoEnabled: boolean; localVideoStream: MediaStream | null; avPeers: Map<string, any> }) => {
    const videoPeers = Array.from(avPeers.values()).filter(p => p.videoStream);
    const totalVideos = (isVideoEnabled && localVideoStream ? 1 : 0) + videoPeers.length;
    
    const getGridClasses = () => {
      if (totalVideos <= 1) return 'grid-cols-1';
      if (totalVideos === 2) return 'grid-cols-2';
      if (totalVideos <= 4) return 'grid-cols-2';
      if (totalVideos <= 6) return 'grid-cols-3';
      if (totalVideos <= 9) return 'grid-cols-3';
      return 'grid-cols-4';
    };
    
    const getAspectClass = () => totalVideos <= 2 ? 'aspect-video' : 'aspect-square';
    
    return (
      <div className={`grid ${getGridClasses()} gap-2`}>
        {isVideoEnabled && localVideoStream && (
          <div className={`relative bg-black rounded-xl overflow-hidden border-2 border-green-500/50 ${getAspectClass()} shadow-lg`}>
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
            <div className="absolute bottom-2 left-2 flex items-center gap-1">
              <span className="text-[10px] bg-black/70 px-2 py-0.5 rounded text-white font-medium">You</span>
              {connectionQuality !== 'high' && (
                <span className="text-[9px] bg-yellow-500/70 px-1.5 rounded text-white">
                  {connectionQuality === 'medium' ? 'SD' : 'LD'}
                </span>
              )}
            </div>
            {isAudioEnabled && (
              <div className="absolute top-2 right-2">
                <span className="text-[10px] bg-green-500/70 px-1.5 py-0.5 rounded text-white">🎤</span>
              </div>
            )}
          </div>
        )}
        
        {videoPeers.map((peer) => (
          <div key={peer.id} className={`relative bg-black rounded-xl overflow-hidden ${getAspectClass()} shadow-lg`}>
            <RemoteVideo stream={peer.videoStream} username={peer.username} />
            <div className="absolute bottom-2 left-2">
              <span className="text-[10px] bg-black/70 px-2 py-0.5 rounded text-white font-medium">{peer.username}</span>
            </div>
            {!peer.connected && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span className="text-white text-xs animate-pulse">Reconnecting...</span>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderChat = () => (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-3 border-b backdrop-blur-md" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-3">
          <XPChatLogo theme={currentTheme} size="small" />
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-xs opacity-70 hidden sm:inline" style={{ color: currentTheme.textColor }}>
              {userCount} online
            </span>
            {(isAudioEnabled || isVideoEnabled) && activePeerCount > 0 && (
              <span className="text-[10px] bg-blue-500/30 px-2 py-0.5 rounded text-blue-100">
                {activePeerCount} connected
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={async () => { await globalAudioUnlock(); await toggleAudio(); }}
            className={`xp-button px-3 py-2 text-sm font-bold text-white transition-all ${isAudioEnabled ? 'animate-pulse' : ''}`}
            style={{ background: isAudioEnabled ? '#32D657' : currentTheme.gradient }}
            title="Toggle voice"
          >
            {isAudioEnabled ? '🎤' : '🔇'}
          </button>
          
          <button
            onClick={async () => { await globalAudioUnlock(); await toggleVideo(); }}
            className={`xp-button px-3 py-2 text-sm font-bold text-white transition-all ${isVideoEnabled ? 'animate-pulse' : ''}`}
            style={{ background: isVideoEnabled ? '#FF6A00' : currentTheme.gradient }}
            title="Toggle video"
          >
            {isVideoEnabled ? '📹' : '📷'}
          </button>
          
          <button
            onClick={() => setShowYoutube(!showYoutube)}
            className="xp-button px-3 py-2 text-sm font-bold text-white"
            style={{ background: showYoutube ? '#FF0000' : currentTheme.gradient }}
            title="YouTube"
          >
            🎬
          </button>
          
          <button
            onClick={() => setShowThemeModal(true)}
            className="xp-button px-3 py-2 text-sm font-bold text-white hidden sm:block"
            style={{ background: currentTheme.gradient }}
            title="Theme"
          >
            🎨
          </button>
          
          {(isAudioEnabled || isVideoEnabled) && connectionState !== 'connected' && (
            <button
              onClick={() => window.location.reload()}
              className="xp-button px-3 py-2 text-xs font-bold text-white animate-pulse"
              style={{ background: '#ff4444' }}
            >
              🔄 Retry
            </button>
          )}
        </div>
      </header>
      
      {/* Connection status */}
      {(isAudioEnabled || isVideoEnabled) && (
        <div className="px-4 py-1.5 bg-black/20 text-center flex items-center justify-center gap-3">
          <span className="text-xs" style={{ color: currentTheme.textColor }}>
            {connectionState === 'connected' && activePeerCount === 0 && (
              <span className="opacity-70">Waiting for others...</span>
            )}
            {connectionState === 'connected' && activePeerCount > 0 && (
              <span className="opacity-70">Connected with {activePeerCount} peer{activePeerCount > 1 ? 's' : ''}</span>
            )}
            {connectionState === 'connecting' && <span className="animate-pulse">Connecting...</span>}
            {connectionState === 'reconnecting' && <span className="animate-pulse text-yellow-400">Reconnecting...</span>}
          </span>
          {avError && <span className="text-xs text-red-400">({avError})</span>}
        </div>
      )}
      
      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-3 p-3 overflow-hidden">
        
        {/* Left: Webcam Grid */}
        {(isVideoEnabled || avPeers.size > 0) && (
          <div className="lg:w-80 xl:w-96 shrink-0">
            <div className="xp-panel p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold" style={{ color: currentTheme.textColor }}>
                  Video ({activePeerCount + (isVideoEnabled ? 1 : 0)})
                </h3>
                <select
                  value={connectionQuality}
                  onChange={(e) => setQuality(e.target.value as any)}
                  className="text-[10px] px-2 py-1 rounded bg-black/20 border-none outline-none cursor-pointer"
                  style={{ color: currentTheme.textColor }}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="audio-only">Audio Only</option>
                </select>
              </div>
              <WebcamGrid isVideoEnabled={isVideoEnabled} localVideoStream={localVideoStream} avPeers={avPeers} />
            </div>
            
            {isAudioEnabled && !isVideoEnabled && avPeers.size > 0 && (
              <div className="xp-panel p-3 mt-2">
                <h3 className="text-xs font-bold mb-2" style={{ color: currentTheme.textColor }}>Voice Chat</h3>
                <div className="flex flex-wrap gap-1">
                  <span className="text-xs px-2 py-1 rounded-full bg-green-500/30 text-green-100">🎤 You</span>
                  {Array.from(avPeers.values()).map((peer) => (
                    <span key={peer.id} className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${peer.connected ? 'bg-blue-500/30 text-blue-100' : 'bg-gray-500/30 text-gray-300'}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      🎤 {peer.username}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Center: Chat */}
        <div className="flex-1 xp-panel flex flex-col min-h-[50vh] lg:min-h-0">
          {/* Messages */}
          <div 
            ref={chatContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-3 space-y-2"
            style={{ maxHeight: 'calc(100vh - 200px)' }}
          >
            {messages.length === 0 && (
              <div className="text-center py-8 opacity-50">
                <p className="text-lg mb-2" style={{ color: currentTheme.textColor }}>Welcome to {GLOBAL_ROOM}!</p>
                <p className="text-sm" style={{ color: currentTheme.textColor }}>Start chatting with everyone</p>
              </div>
            )}
            
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.username === username ? 'items-end' : msg.username === 'System' ? 'items-center' : 'items-start'}`}
              >
                {msg.username !== 'System' && (
                  <span className="text-[10px] opacity-60 mb-0.5" style={{ color: currentTheme.textColor }}>
                    {msg.username} • {formatTime(msg.timestamp)}
                  </span>
                )}
                
                {msg.type === 'image' && msg.imageData ? (
                  <div className="max-w-[200px] md:max-w-[280px]">
                    <img 
                      src={msg.imageData} 
                      alt="Shared" 
                      className="rounded-lg cursor-pointer hover:opacity-90 transition-opacity shadow-md"
                      onClick={() => { setSelectedImage(msg.imageData!); setShowImageModal(true); }}
                    />
                  </div>
                ) : msg.type === 'voice' && msg.voiceData ? (
                  <VoiceMessage voiceData={msg.voiceData} duration={msg.voiceDuration || 0} isOwn={msg.username === username} theme={currentTheme} />
                ) : msg.type === 'file' ? (
                  <FileMessage 
                    fileName={msg.fileName || 'file'} 
                    fileSize={msg.fileSize || 0} 
                    fileData={msg.fileData || ''}
                    isOwn={msg.username === username}
                    theme={currentTheme}
                  />
                ) : (
                  <div 
                    className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
                      msg.username === username 
                        ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white rounded-br-sm shadow-md' 
                        : msg.username === 'System' 
                          ? 'bg-gray-400/50 text-gray-200 text-xs px-3 py-1' 
                          : 'bg-white/90 text-gray-800 rounded-bl-sm shadow-md'
                    }`}
                  >
                    {msg.text}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Scroll to bottom */}
          {!isScrolledToBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-24 right-6 xp-button px-3 py-1.5 text-xs font-bold text-white shadow-lg animate-bounce z-10 rounded-full"
              style={{ background: currentTheme.gradient }}
            >
              ↓ {unreadCount > 0 ? `${unreadCount} new` : 'new'}
            </button>
          )}
          
          {/* Input area */}
          <div className="border-t p-2" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
            <div className="flex gap-1 items-center">
              <button ref={emojiButtonRef} onClick={toggleEmojiPicker} className="emoji-button p-2 rounded-full hover:bg-white/10 text-lg transition-colors">
                😀
              </button>
              
              <button onClick={() => fileInputRef.current?.click()} disabled={isFileUploading} className="p-2 rounded-full hover:bg-white/10 text-lg transition-colors disabled:opacity-50">
                {isFileUploading ? '⏳' : '📎'}
              </button>
              <input ref={fileInputRef} type="file" accept="*/*" onChange={handleFileSelect} className="hidden" />
              
              <button
                ref={useRef<HTMLButtonElement>(null)}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`p-2 rounded-full transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'hover:bg-white/10 text-lg'}`}
              >
                {isRecording ? `🎙️ ${recordingDuration}s` : '🎙️'}
              </button>
              
              <input
                ref={messageInputRef}
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                className="flex-1 px-3 py-2 rounded-full text-sm outline-none"
                style={{ color: '#333', background: 'rgba(255,255,255,0.95)' }}
                maxLength={1000}
              />
              <button
                onClick={sendMessage}
                disabled={!isReady || !newMessage.trim()}
                className="xp-button px-4 py-2 font-bold text-white text-sm disabled:opacity-50 transition-opacity"
                style={{ background: currentTheme.gradient }}
              >
                Send
              </button>
            </div>
          </div>
          
          {/* Emoji picker */}
          {emojiPickerPos && (
            <div 
              className="emoji-picker-container fixed z-50 xp-panel p-3 shadow-2xl"
              style={{ top: `${emojiPickerPos.top}px`, left: `${emojiPickerPos.left}px`, width: '300px', maxHeight: '280px' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: currentTheme.textColor }}>Emojis</span>
                <button onClick={closeEmojiPicker} className="text-xs px-2 py-1 rounded hover:bg-white/10" style={{ color: currentTheme.textColor }}>✕</button>
              </div>
              <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
                {emojiCategories.map((cat) => (
                  <button
                    key={cat.name}
                    onClick={() => setSelectedEmojiCategory(cat.name)}
                    className={`px-2 py-1 rounded-full text-xs whitespace-nowrap transition-all ${selectedEmojiCategory === cat.name ? 'text-white' : ''}`}
                    style={selectedEmojiCategory === cat.name ? { background: currentTheme.gradient } : {}}
                  >
                    {cat.icon}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-8 gap-1 max-h-[160px] overflow-y-auto p-1">
                {emojiCategories.find(cat => cat.name === selectedEmojiCategory)?.emojis.map((emoji, i) => (
                  <button key={i} onClick={() => addEmoji(emoji)} className="text-lg p-1 hover:bg-white/20 rounded text-center transition-transform hover:scale-110">
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Right: YouTube */}
        {showYoutube && (
          <div className="lg:w-72 shrink-0 xp-panel p-3 flex flex-col max-h-[calc(100vh-100px)]">
            <h3 className="text-xs font-bold mb-2" style={{ color: currentTheme.textColor }}>Mini Theater</h3>
            <div className="flex gap-1 mb-2">
              <input
                type="text"
                placeholder="Search YouTube..."
                value={youtubeSearch}
                onChange={(e) => setYoutubeSearch(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearchYoutube()}
                className="flex-1 px-2 py-1.5 rounded-full text-xs"
                style={{ color: '#333', border: '1px solid rgba(0,0,0,0.1)' }}
              />
              <button onClick={handleSearchYoutube} disabled={isSearchingYoutube} className="xp-button px-2 py-1 text-white text-xs disabled:opacity-50" style={{ background: '#FF0000' }}>
                {isSearchingYoutube ? '⏳' : '🔍'}
              </button>
            </div>
            {currentVideo && (
              <div className="youtube-player mb-2">
                <iframe src={`https://www.youtube.com/embed/${currentVideo}?autoplay=1`} title="YouTube" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            )}
            <div className="space-y-1 overflow-y-auto flex-1">
              {youtubeResults.map((v) => (
                <button key={v.id} onClick={() => playVideo(v.id)} className="flex gap-2 w-full text-left hover:bg-white/10 p-1.5 rounded transition-colors">
                  <img src={v.thumbnail} alt="" className="w-16 h-12 object-cover rounded flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs line-clamp-2 block" style={{ color: currentTheme.textColor }}>{v.title}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Image modal */}
      {showImageModal && selectedImage && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setShowImageModal(false)}>
          <img src={selectedImage} alt="Full size" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );

  return (
    <div className="xp-bg min-h-screen">
      <div className="grain-overlay"></div>
      <div className="relative z-10">
        {currentView === 'welcome' && renderWelcome()}
        {currentView === 'chat' && renderChat()}
        
        {showThemeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="xp-panel w-full max-w-4xl max-h-[80vh] overflow-y-auto p-4 relative">
              <button onClick={() => setShowThemeModal(false)} className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-red-500 text-white font-bold hover:bg-red-600">✕</button>
              <div className="text-center mb-4">
                <h1 className="font-display text-2xl md:text-3xl" style={{ color: currentTheme.textColor }}>Choose Your Flavor</h1>
              </div>
              <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2 md:gap-3">
                {themes.map((theme) => (
                  <button key={theme.id} onClick={() => handleThemeSelect(theme)} className={`theme-swatch ${currentTheme.id === theme.id ? 'active' : ''}`} style={{ background: theme.gradient }} title={theme.name} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Error Log Button */}
      <button onClick={() => setShowErrorLog(!showErrorLog)} className="fixed bottom-2 left-2 z-50 px-2 py-1 rounded text-[10px] opacity-40 hover:opacity-100 transition-opacity" style={{ background: errorLogs.filter(l => l.type === 'error').length > 0 ? 'rgba(255,0,0,0.5)' : 'rgba(0,0,0,0.5)', color: '#fff' }}>
        📝 {errorLogs.length > 0 && <span className="ml-1">{errorLogs.filter(l => l.type === 'error').length}</span>}
      </button>
      
      {/* Error Log Modal */}
      {showErrorLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowErrorLog(false)}>
          <div className="xp-panel w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <h3 className="text-sm font-bold" style={{ color: currentTheme.textColor }}>System Log</h3>
              <div className="flex gap-2">
                <button onClick={handleWipeHistory} className="text-xs px-3 py-1.5 rounded font-bold text-white bg-orange-500 hover:bg-orange-600">🗑️ Wipe Chat</button>
                <button onClick={runFullDiagnostics} className="text-xs px-3 py-1.5 rounded font-bold text-white" style={{ background: currentTheme.gradient }}>🔧 Diagnostics</button>
                <button onClick={() => setErrorLogs([])} className="text-xs px-2 py-1.5 rounded hover:bg-white/10" style={{ color: currentTheme.textColor }}>Clear</button>
                <button onClick={() => setShowErrorLog(false)} className="text-xs px-2 py-1.5 rounded hover:bg-white/10" style={{ color: currentTheme.textColor }}>✕</button>
              </div>
            </div>
            
            {showDiagnostics && diagnosticsData && (
              <div className="p-3 border-b bg-black/20" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold" style={{ color: currentTheme.textColor }}>Diagnostics</h4>
                  <button onClick={() => setShowDiagnostics(false)} className="text-[10px] opacity-50 hover:opacity-100" style={{ color: currentTheme.textColor }}>Hide</button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]" style={{ color: currentTheme.textColor }}>
                  <div className="bg-black/20 p-2 rounded">MQTT: {diagnosticsData.mqttConnected ? '✅' : '❌'}</div>
                  <div className="bg-black/20 p-2 rounded">Peers: {diagnosticsData.peers?.length || 0}</div>
                  <div className="bg-black/20 p-2 rounded">Audio: {diagnosticsData.isAudioEnabled ? '🎤' : '🔇'}</div>
                  <div className="bg-black/20 p-2 rounded">Video: {diagnosticsData.isVideoEnabled ? '📹' : '📷'}</div>
                </div>
              </div>
            )}
            
            <div className="flex-1 overflow-y-auto p-3 space-y-1 text-xs">
              {errorLogs.length === 0 ? (
                <span className="opacity-50" style={{ color: currentTheme.textColor }}>No events logged...</span>
              ) : (
                errorLogs.map((log, i) => (
                  <div key={i} className={`break-all p-1.5 rounded ${log.type === 'error' ? 'bg-red-500/20' : log.type === 'warn' ? 'bg-yellow-500/20' : 'bg-blue-500/10'}`} style={{ color: currentTheme.textColor }}>
                    <span className="opacity-50">[{log.timestamp}]</span>
                    <span className={`ml-1 ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-yellow-400' : 'text-blue-400'}`}>
                      {log.type === 'error' ? '❌' : log.type === 'warn' ? '⚠️' : 'ℹ️'}
                    </span>
                    <span className="ml-1">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Voice Message Component
function VoiceMessage({ voiceData, duration, isOwn, theme }: { voiceData: string; duration: number; isOwn: boolean; theme: Theme }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(voiceData);
    audioRef.current = audio;
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    return () => { audio.pause(); audio.src = ''; };
  }, [voiceData]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play().catch(() => {});
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`max-w-[220px] px-3 py-2 rounded-2xl ${isOwn ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white rounded-br-sm shadow-md' : 'bg-white/90 text-gray-800 rounded-bl-sm shadow-md'}`}>
      <div className="flex items-center gap-2">
        <button onClick={togglePlay} className={`w-8 h-8 rounded-full flex items-center justify-center ${isPlaying ? 'animate-pulse' : ''}`} style={{ background: isOwn ? 'rgba(255,255,255,0.3)' : theme.gradient, color: '#fff' }}>
          {isPlaying ? '⏸️' : '▶️'}
        </button>
        <div className="flex-1">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: isOwn ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(currentTime / duration) * 100}%`, background: isOwn ? '#fff' : theme.primary }} />
          </div>
          <div className="flex justify-between text-[10px] mt-0.5 opacity-70">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// File Message Component with Download
function FileMessage({ fileName, fileSize, fileData, isOwn, theme }: { fileName: string; fileSize: number; fileData: string; isOwn: boolean; theme: Theme }) {
  const handleDownload = () => {
    downloadFile(fileData, fileName);
  };

  return (
    <div 
      className={`max-w-[250px] px-3 py-2 rounded-2xl cursor-pointer hover:opacity-90 transition-opacity ${
        isOwn ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white rounded-br-sm shadow-md' : 'bg-white/90 text-gray-800 rounded-bl-sm shadow-md'
      }`}
      onClick={handleDownload}
    >
      <div className="flex items-center gap-2">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${isOwn ? 'bg-white/20' : 'bg-gray-200'}`}>
          📎
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{fileName}</div>
          <div className="text-[10px] opacity-70">{formatFileSize(fileSize)} • Click to download</div>
        </div>
        <div className="text-lg">⬇️</div>
      </div>
    </div>
  );
}

// Remote Video Component
function RemoteVideo({ stream, username }: { stream: MediaStream; username: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasError, setHasError] = useState(false);
  
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(() => setHasError(true));
    }
    return () => { if (video) { video.pause(); video.srcObject = null; } };
  }, [stream]);
  
  if (hasError) return <div className="w-full h-full flex items-center justify-center bg-black/50"><span className="text-white text-xs">Video error</span></div>;
  
  return <video ref={videoRef} autoPlay playsInline muted={false} className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />;
}

export default App;
