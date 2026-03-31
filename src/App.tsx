import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';
import { themes, type Theme } from './data/themes';
import { emojiCategories } from './data/emojis';
import { useStableChat } from './hooks/useStableChat';
import { useRobustAV } from './hooks/useRobustAV';
import { searchYoutube } from './lib/youtube';

// Theme-aware Logo - Ultimate Gamer Style
const XPChatLogo = ({ theme, size = 'normal' }: { theme: Theme; size?: 'small' | 'normal' | 'large' }) => {
  const sizeClasses = {
    small: { text: 'text-lg', icon: 'text-sm', badge: 'text-[8px]' },
    normal: { text: 'text-2xl', icon: 'text-lg', badge: 'text-[10px]' },
    large: { text: 'text-4xl md:text-5xl', icon: 'text-2xl md:text-3xl', badge: 'text-xs' }
  };
  
  return (
    <div className={`font-display ${sizeClasses[size].text} flex items-center gap-1 select-none group cursor-pointer`}>
      {/* Glowing Badge */}
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
        {/* Pulse glow effect */}
        <div 
          className="absolute inset-0 rounded animate-ping opacity-30"
          style={{ background: theme.gradient }}
        />
      </div>
      
      {/* Crosshair Divider */}
      <span 
        className="relative mx-0.5 opacity-80"
        style={{ color: theme.accent }}
      >
        <span className="absolute inset-0 animate-spin" style={{ animationDuration: '4s' }}>✦</span>
        <span className="relative">✦</span>
      </span>
      
      {/* CHAT Text with glitch effect */}
      <div className="relative">
        <span 
          className="font-black tracking-wider"
          style={{ 
            color: theme.textColor,
            textShadow: `
              -1px -1px 0 ${theme.accent},
              1px 1px 0 rgba(0,0,0,0.5),
              0 0 10px ${theme.accent}80
            `,
            fontStyle: 'italic'
          }}
        >
          CHAT
        </span>
        {/* RGB Glitch layers */}
        <span 
          className="absolute top-0 left-0 font-black tracking-wider italic opacity-50"
          style={{ 
            color: '#ff0080',
            clipPath: 'polygon(0 0, 100% 0, 100% 45%, 0 45%)',
            transform: 'translate(-1px, 0)',
            animation: 'glitch 2s infinite'
          }}
        >
          CHAT
        </span>
        <span 
          className="absolute top-0 left-0 font-black tracking-wider italic opacity-50"
          style={{ 
            color: '#00ffff',
            clipPath: 'polygon(0 55%, 100% 55%, 100% 100%, 0 100%)',
            transform: 'translate(1px, 0)',
            animation: 'glitch 2s infinite 0.1s'
          }}
        >
          CHAT
        </span>
      </div>
      
      {/* Beta tag */}
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

function App() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(themes[0]);
  const [username, setUsername] = useState<string>('');
  const [tempUsername, setTempUsername] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [tempRoomCode, setTempRoomCode] = useState<string>('');
  const [currentView, setCurrentView] = useState<'welcome' | 'room' | 'chat'>('welcome');
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
    sendVoice,
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
    globalAudioUnlock,
  } = useRobustAV(roomCode, username, currentView === 'chat');

  // Log AV errors
  useEffect(() => {
    if (avError) {
      addErrorLog(`AV Error: ${avError}`, 'error', { connectionState, peerCount: avPeers.size });
    }
  }, [avError]);

  // Log connection state changes
  useEffect(() => {
    addErrorLog(`Connection state changed to: ${connectionState}`, 'info', { 
      peerCount: avPeers.size, 
      audioEnabled: isAudioEnabled, 
      videoEnabled: isVideoEnabled,
      quality: connectionQuality 
    });
  }, [connectionState, avPeers.size, isAudioEnabled, isVideoEnabled, connectionQuality]);

  // Voice recording state - FIXED for accurate timing
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const voiceButtonRef = useRef<HTMLButtonElement>(null);
  const isRecordingRef = useRef(false);

  // Sync isRecording with ref
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Start voice recording - FIXED
  const startRecording = async () => {
    if (isRecordingRef.current) return; // Prevent double-start
    
    try {
      // Get audio stream with specific constraints for better quality
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1
        }
      });
      
      // Try to use better codec if available
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        // Calculate actual duration
        const actualDuration = Math.round((Date.now() - recordingStartTimeRef.current) / 1000);
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        sendVoiceMessage(audioBlob, actualDuration);
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };
      
      // Request data every 100ms to avoid losing chunks
      mediaRecorder.start(100);
      recordingStartTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingDuration(0);
      
      // More accurate timer using Date.now()
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000);
        setRecordingDuration(elapsed);
        
        // Auto-stop at 60 seconds
        if (elapsed >= 60) {
          forceStopRecording();
        }
      }, 100);
      
      addErrorLog('Started voice recording', 'info');
    } catch (err) {
      addErrorLog(`Failed to start recording: ${err}`, 'error');
      alert('Could not access microphone. Please allow microphone access.');
    }
  };

  // Force stop (for auto-stop at 60s)
  const forceStopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  // Stop voice recording - FIXED
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      addErrorLog('Stopped voice recording', 'info');
    }
  };

  // Send voice message - FIXED to use actual duration
  const sendVoiceMessage = (audioBlob: Blob, actualDuration: number) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const audioData = event.target?.result as string;
      if (audioData && isReady) {
        // Ensure duration is at least 1 second and accurate
        const duration = Math.max(1, Math.min(actualDuration, 60));
        sendVoice(audioData, duration);
        setTimeout(scrollToBottom, 100);
        addErrorLog(`Sent voice message: ${duration}s`, 'info');
      }
    };
    reader.readAsDataURL(audioBlob);
  };

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (mediaRecorderRef.current && isRecordingRef.current) {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // Track if user has interacted (required for audio)
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  // Error log state with detailed info
  const [errorLogs, setErrorLogs] = useState<Array<{type: 'error' | 'info' | 'warn', message: string, timestamp: string, details?: any}>>([]);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  
  // Function to add error to log
  const addErrorLog = (message: string, type: 'error' | 'info' | 'warn' = 'error', details?: any) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { type, message, timestamp, details };
    setErrorLogs(prev => [...prev.slice(-99), logEntry]);
  };
  
  // Capture console errors, warns, and info
  useEffect(() => {
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;
    
    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      if (message.includes('AV') || message.includes('audio') || message.includes('video') || message.includes('connection') || message.includes('MQTT')) {
        addErrorLog(message, 'error');
      }
    };
    
    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args);
      const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      if (message.includes('AV') || message.includes('audio') || message.includes('video')) {
        addErrorLog(message, 'warn');
      }
    };
    
    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      console.log = originalLog;
    };
  }, []);
  
  // Run full diagnostics
  const runFullDiagnostics = async () => {
    addErrorLog('Running full diagnostics...', 'info');
    try {
      const diag = await getDiagnostics();
      setDiagnosticsData(diag);
      setShowDiagnostics(true);
      addErrorLog('Diagnostics completed successfully', 'info', { peerCount: diag.peers.length, mqttConnected: diag.mqttConnected });
    } catch (err) {
      addErrorLog(`Diagnostics failed: ${err}`, 'error');
    }
  };

  // Global audio unlock on first user interaction
  useEffect(() => {
    const handleFirstInteraction = async () => {
      if (!hasUserInteracted) {
        console.log('👆 User interaction detected - unlocking audio...');
        setHasUserInteracted(true);
        await globalAudioUnlock();
        
        // Check if audio is still blocked
        setTimeout(() => {
          const audioElements = document.querySelectorAll('audio');
          let anyPlaying = false;
          audioElements.forEach((audio: HTMLAudioElement) => {
            if (!audio.paused && !audio.muted) {
              anyPlaying = true;
            }
          });
          if (!anyPlaying && avPeers.size > 0) {
            setAudioBlocked(true);
          }
        }, 1000);
      }
    };

    document.addEventListener('click', handleFirstInteraction, { once: true });
    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    document.addEventListener('keydown', handleFirstInteraction, { once: true });

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [hasUserInteracted, globalAudioUnlock, avPeers.size]);

  // Update local video element
  useEffect(() => {
    if (localVideoRef.current && localVideoStream) {
      localVideoRef.current.srcObject = localVideoStream;
      // Ensure video plays
      localVideoRef.current.play().catch(err => {
        console.log('Local video autoplay blocked:', err);
      });
    }
  }, [localVideoStream]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('xp-chat-theme');
    if (savedTheme) {
      const theme = themes.find(t => t.id === savedTheme);
      if (theme) setCurrentTheme(theme);
    }
  }, []);

  // THEME EFFECT - completely isolated from connection logic
  useEffect(() => {
    // Only update CSS variables - NEVER affects connection state
    document.documentElement.style.setProperty('--xp-bg-primary', currentTheme.primary);
    document.documentElement.style.setProperty('--xp-bg-gradient', currentTheme.gradient);
    document.documentElement.style.setProperty('--xp-accent', currentTheme.accent);
    document.documentElement.style.setProperty('--xp-text-primary', currentTheme.textColor);
    document.documentElement.style.setProperty('--xp-text-secondary', currentTheme.textSecondary);
    document.documentElement.style.setProperty('--xp-panel-bg', currentTheme.panelBg);
    document.documentElement.style.setProperty('--xp-panel-border', currentTheme.panelBorder);
    localStorage.setItem('xp-chat-theme', currentTheme.id);
    
    // Log theme change but don't affect connection
    console.log(`Theme changed to: ${currentTheme.name} - This does NOT affect connection`);
  }, [currentTheme.id]); // Only depend on ID to prevent unnecessary updates

  // Refs for scroll handling - prevent auto-scroll when user is scrolling
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageCountRef = useRef(messages.length);

  // Handle scroll events - detect when user is actively scrolling
  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    
    // Mark that user is actively scrolling
    isUserScrollingRef.current = true;
    
    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    // Reset user scrolling flag after 1 second of no scroll events
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 1000);
    
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    
    setIsScrolledToBottom(atBottom);
    if (atBottom) {
      setUnreadCount(0);
    }
  }, []);

  // Auto-scroll effect - ONLY when YOU send a message
  useEffect(() => {
    if (messages.length === 0) {
      lastMessageCountRef.current = 0;
      return;
    }
    
    // Only process if we have a NEW message
    if (messages.length <= lastMessageCountRef.current) return;
    
    lastMessageCountRef.current = messages.length;
    const lastMessage = messages[messages.length - 1];
    
    // Only auto-scroll for YOUR own messages, and only if not actively scrolling
    if (lastMessage.username === username && !isUserScrollingRef.current) {
      setTimeout(() => {
        if (chatContainerRef.current && !isUserScrollingRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
          setIsScrolledToBottom(true);
          setUnreadCount(0);
        }
      }, 150);
    } else if (lastMessage.username !== username && isScrolledToBottom && !isUserScrollingRef.current) {
      // Others' messages: only auto-scroll if already at bottom and not scrolling
      setTimeout(() => {
        if (chatContainerRef.current && !isUserScrollingRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 150);
    } else if (lastMessage.username !== username) {
      // Others' messages when scrolled up: show unread counter
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
      setShowThemeModal(true);
    }
  };

  const handleThemeSelect = useCallback((theme: Theme) => {
    // Theme changes should NEVER affect connection
    // Only update if different theme
    if (theme.id !== currentTheme.id) {
      console.log(`Switching theme from ${currentTheme.name} to ${theme.name}`);
      setCurrentTheme(theme);
    }
    // Close theme modal
    setShowThemeModal(false);
    // If not in chat, go to room selection
    if (currentView !== 'chat') {
      setCurrentView('room');
    }
  }, [currentTheme.id, currentView, setShowThemeModal]);

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

  // File upload handler - supports images and files up to 30MB
  const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large! Maximum size is 30MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    const isImage = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');
    const isVideo = file.type.startsWith('video/');
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const fileData = event.target?.result as string;
      if (!fileData) return;
      
      if (isImage) {
        // Send as image
        sendImage(fileData, `📷 ${file.name}`);
      } else {
        // Send as file message with metadata
        const fileType = isAudio ? '🎵 Audio' : isVideo ? '🎬 Video' : '📎 File';
        const fileMsg = {
          type: 'file' as const,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          data: fileData
        };
        sendFileMessage(fileMsg);
      }
      setTimeout(scrollToBottom, 100);
    };
    
    reader.onerror = () => {
      alert('Failed to read file. Please try again.');
    };
    
    reader.readAsDataURL(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  // Send file message via chat
  const sendFileMessage = (fileData: { type: 'file'; name: string; size: number; mimeType: string; data: string }) => {
    // For now, send as a special chat message with file info
    const sizeText = fileData.size < 1024 * 1024 
      ? `${(fileData.size / 1024).toFixed(1)} KB`
      : `${(fileData.size / 1024 / 1024).toFixed(1)} MB`;
    
    const isAudio = fileData.mimeType.startsWith('audio/');
    const isVideo = fileData.mimeType.startsWith('video/');
    
    let messageText = '';
    if (isAudio) {
      messageText = `🎵 Audio: ${fileData.name} (${sizeText})`;
    } else if (isVideo) {
      messageText = `🎬 Video: ${fileData.name} (${sizeText})`;
    } else {
      const ext = fileData.name.split('.').pop()?.toUpperCase() || 'FILE';
      messageText = `📎 ${ext}: ${fileData.name} (${sizeText})`;
    }
    
    // Send as image for now (base64 data) - the hook will need updating for full file support
    sendImage(fileData.data, messageText);
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
        
        <div className="flex items-center gap-1 md:gap-2 mr-2 md:mr-6">
          {/* Quality selector - only show when AV is active */}
          {(isAudioEnabled || isVideoEnabled) && (
            <div className="relative quality-selector-container">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowQualitySelector(!showQualitySelector);
                }}
                className="xp-button px-2.5 md:px-3.5 py-2.5 text-sm md:text-base font-bold text-white"
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
            onClick={async () => {
              await globalAudioUnlock();
              await toggleAudio();
              setAudioBlocked(false);
            }}
            className={`xp-button px-2.5 md:px-3.5 py-2.5 text-sm md:text-base font-bold text-white ${isAudioEnabled ? 'animate-pulse' : ''}`}
            style={{ background: isAudioEnabled ? '#32D657' : currentTheme.gradient }}
            title="Toggle voice chat"
          >
            {isAudioEnabled ? '🎤' : '🔇'}
            <span className="hidden sm:inline ml-1">{isAudioEnabled ? 'ON' : 'OFF'}</span>
          </button>
          
          {/* Video button */}
          <button
            onClick={async () => {
              await globalAudioUnlock();
              await toggleVideo();
            }}
            className={`xp-button px-2.5 md:px-3.5 py-2.5 text-sm md:text-base font-bold text-white ${isVideoEnabled ? 'animate-pulse' : ''}`}
            style={{ background: isVideoEnabled ? '#FF6A00' : currentTheme.gradient }}
            title="Toggle video"
          >
            {isVideoEnabled ? '📹' : '📷'}
            <span className="hidden sm:inline ml-1">{isVideoEnabled ? 'ON' : 'OFF'}</span>
          </button>
          
          {/* YouTube button */}
          <button
            onClick={() => setShowYoutube(!showYoutube)}
            className="xp-button px-2.5 md:px-3.5 py-2.5 text-sm md:text-base font-bold text-white"
            style={{ background: showYoutube ? '#FF0000' : currentTheme.gradient }}
          >
            {showYoutube ? '❌' : '🎬'}
          </button>
          
          {/* Theme button */}
          <button
            onClick={() => setShowThemeModal(true)}
            className="xp-button px-2.5 md:px-3.5 py-2.5 text-sm md:text-base font-bold text-white hidden sm:block"
            style={{ background: currentTheme.gradient }}
          >
            🎨
          </button>
          
          {/* Connection status - stable width container to prevent layout shift */}
          <div className="w-[90px] md:w-[110px] flex-shrink-0">
            {(isAudioEnabled || isVideoEnabled) && connectionState !== 'connected' && (
              <button
                onClick={() => window.location.reload()}
                className="xp-button w-full px-1 md:px-3 py-2.5 text-xs md:text-sm font-bold text-white animate-pulse whitespace-nowrap"
                style={{ background: '#ff4444' }}
                title="Reload page to reconnect"
              >
                🔄 <span className="hidden md:inline">Reconnect</span>
                <span className="md:hidden">Retry</span>
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Error messages */}
      {avError && (
        <div className="mx-2 md:mx-4 mt-2 p-2 rounded-lg bg-red-500/30 text-red-100 text-xs text-center">
          ⚠️ {avError}
        </div>
      )}
      
      {/* Audio unblock prompt - show when peers exist but audio might be blocked */}
      {(isAudioEnabled || isVideoEnabled) && avPeers.size > 0 && audioBlocked && (
        <div 
          className="mx-2 md:mx-4 mt-2 p-3 rounded-lg bg-yellow-500/40 text-yellow-100 text-sm text-center cursor-pointer animate-pulse"
          onClick={async () => {
            await globalAudioUnlock();
            setAudioBlocked(false);
          }}
        >
          🔊 <strong>Click here to enable audio!</strong> Browsers block audio until you interact.
        </div>
      )}

      {/* Connection status for AV */}
      {(isAudioEnabled || isVideoEnabled) && (
        <div className="mx-2 md:mx-4 mt-2 p-2 rounded-lg bg-blue-500/20 text-blue-100 text-xs text-center">
          {connectionState === 'connected' && avPeers.size === 0 && (
            <span className="animate-pulse">📡 Waiting for others to enable audio/video...</span>
          )}
          {connectionState === 'connected' && avPeers.size > 0 && (
            <div className="flex flex-col gap-1">
              <span>🟢 Connected with {avPeers.size} peer{avPeers.size > 1 ? 's' : ''}</span>
              <span className="text-[10px] opacity-70">
                {Array.from(avPeers.values()).map(p => 
                  `${p.username}${p.connected ? '✓' : '⟳'}`
                ).join(', ')}
              </span>
            </div>
          )}
          {connectionState === 'connecting' && (
            <span className="animate-pulse">⏳ Connecting to signaling server...</span>
          )}
          {connectionState === 'reconnecting' && (
            <span className="animate-pulse">🔄 Reconnecting... Please wait</span>
          )}
          {connectionState === 'failed' && (
            <span className="text-red-300">❌ Connection failed. Try refreshing the page.</span>
          )}
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
        
        {/* LEFT PANEL: Video Grid - Optimized for up to 10 participants */}
        <div className="flex flex-col gap-2 md:w-64 lg:w-80 shrink-0">
          {/* Video panel - only show when video enabled or peers exist */}
          {(isVideoEnabled || avPeers.size > 0) && (
            <div className="xp-panel p-2 md:p-3 flex flex-col gap-2 max-h-[40vh] md:max-h-[calc(100vh-180px)] overflow-y-auto">
              <h3 className="text-xs font-bold mb-1 flex items-center justify-between sticky top-0 bg-inherit py-1 z-10" style={{ color: currentTheme.textColor }}>
                <span>Video ({avPeers.size + (isVideoEnabled ? 1 : 0)}/10)</span>
                {avPeers.size > 0 && (
                  <span className="text-[10px] opacity-60">
                    {avPeers.size + (isVideoEnabled ? 1 : 0)} participants
                  </span>
                )}
              </h3>
              
              {/* Video Grid - Memoized to prevent re-render on theme changes */}
              <VideoGrid 
                isVideoEnabled={isVideoEnabled}
                localVideoStream={localVideoStream}
                localVideoRef={localVideoRef}
                avPeers={avPeers}
                connectionQuality={connectionQuality}
              />
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
        
        {/* MIDDLE PANEL: Chat area - FIXED height with scrollbar */}
        <div className="flex-1 xp-panel flex flex-col h-[60vh] md:h-[calc(100vh-200px)] min-h-[400px] max-h-[800px] relative">
          {/* Messages - Scrollable container with fixed height */}
          <div 
            ref={chatContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto space-y-2 md:space-y-3 p-2 md:p-4 pr-2 scrollbar-thin scrollbar-thumb-white/30 scrollbar-track-black/10"
            style={{ 
              maxHeight: '100%',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.3) rgba(0,0,0,0.1)'
            }}
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
                ) : msg.type === 'voice' && msg.voiceData ? (
                  <VoiceMessage 
                    voiceData={msg.voiceData} 
                    duration={msg.voiceDuration || 0}
                    isOwn={msg.username === username}
                    theme={currentTheme}
                  />
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
              className="absolute bottom-20 right-4 xp-button px-2 py-1 text-[10px] font-bold text-white shadow-lg animate-bounce z-10 rounded-full"
              style={{ background: currentTheme.gradient }}
            >
              ↓ {unreadCount > 0 ? `${unreadCount}` : 'new'}
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
                accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt,.zip,.rar,.7z,.exe,.apk,.ipa"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              {/* Voice recording button */}
              <button
                ref={voiceButtonRef}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`p-2 rounded-full transition-all relative ${
                  isRecording 
                    ? 'bg-red-500 text-white animate-pulse' 
                    : 'hover:bg-white/10 text-lg md:text-xl'
                }`}
                style={isRecording ? { background: '#ef4444' } : {}}
                title="Hold to record voice message"
              >
                {isRecording ? (
                  <span className="flex items-center gap-1">
                    🎙️ <span className="text-xs font-bold">{recordingDuration}s</span>
                  </span>
                ) : (
                  '🎙️'
                )}
                {isRecording && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                )}
              </button>
              
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
        {currentView === 'room' && renderRoom()}
        {currentView === 'chat' && renderChat()}
        
        {/* Theme Modal - can be opened from chat */}
        {showThemeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="xp-panel w-full max-w-4xl max-h-[80vh] overflow-y-auto p-4 relative">
              <button
                onClick={() => setShowThemeModal(false)}
                className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-red-500 text-white font-bold hover:bg-red-600"
              >
                ✕
              </button>
              <div className="text-center mb-4">
                <h1 className="font-display text-2xl md:text-3xl" style={{ color: currentTheme.textColor }}>
                  Choose Your Flavor
                </h1>
                <p className="text-sm opacity-70 mt-1" style={{ color: currentTheme.textColor }}>{themes.length} themes</p>
              </div>
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
        )}
      </div>
      
      {/* Error Log Button - Bottom Left Corner */}
      <button
        onClick={() => setShowErrorLog(!showErrorLog)}
        className="fixed bottom-2 left-2 z-50 px-2 py-1 rounded text-[10px] opacity-30 hover:opacity-100 transition-opacity flex items-center gap-1"
        style={{ 
          background: errorLogs.filter(l => l.type === 'error').length > 0 ? 'rgba(255,0,0,0.5)' : 'rgba(0,0,0,0.5)', 
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)'
        }}
        title="Error Log & Diagnostics"
      >
        📝 
        {errorLogs.length > 0 && (
          <span className="bg-red-500 text-white px-1 rounded text-[8px]">
            {errorLogs.filter(l => l.type === 'error').length}
          </span>
        )}
      </button>
      
      {/* Error Log & Diagnostics Modal */}
      {showErrorLog && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowErrorLog(false)}
        >
          <div 
            className="xp-panel w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold" style={{ color: currentTheme.textColor }}>📋 System Log & Diagnostics</h3>
                <span className="text-xs opacity-50" style={{ color: currentTheme.textColor }}>
                  {errorLogs.filter(l => l.type === 'error').length} errors, {errorLogs.filter(l => l.type === 'warn').length} warnings
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={runFullDiagnostics}
                  className="text-xs px-3 py-1.5 rounded font-bold text-white"
                  style={{ background: currentTheme.gradient }}
                >
                  🔧 Run Diagnostics
                </button>
                <button
                  onClick={() => setErrorLogs([])}
                  className="text-xs px-2 py-1.5 rounded hover:bg-white/10"
                  style={{ color: currentTheme.textColor }}
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowErrorLog(false)}
                  className="text-xs px-2 py-1.5 rounded hover:bg-white/10"
                  style={{ color: currentTheme.textColor }}
                >
                  ✕
                </button>
              </div>
            </div>
            
            {/* Diagnostics Panel */}
            {showDiagnostics && diagnosticsData && (
              <div className="p-3 border-b bg-black/20" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold" style={{ color: currentTheme.textColor }}>📊 Diagnostics Report</h4>
                  <button 
                    onClick={() => setShowDiagnostics(false)}
                    className="text-[10px] opacity-50 hover:opacity-100"
                    style={{ color: currentTheme.textColor }}
                  >
                    Hide
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono" style={{ color: currentTheme.textColor }}>
                  <div className="bg-black/20 p-2 rounded">
                    <span className="opacity-70">MQTT:</span> {diagnosticsData.mqttConnected ? '🟢 Connected' : '🔴 Disconnected'}
                  </div>
                  <div className="bg-black/20 p-2 rounded">
                    <span className="opacity-70">Peers:</span> {diagnosticsData.peers.length}
                  </div>
                  <div className="bg-black/20 p-2 rounded">
                    <span className="opacity-70">Audio:</span> {diagnosticsData.isAudioEnabled ? '🎤 ON' : '🔇 OFF'}
                  </div>
                  <div className="bg-black/20 p-2 rounded">
                    <span className="opacity-70">Video:</span> {diagnosticsData.isVideoEnabled ? '📹 ON' : '📷 OFF'}
                  </div>
                  <div className="bg-black/20 p-2 rounded col-span-2">
                    <span className="opacity-70">Quality:</span> {diagnosticsData.connectionQuality}
                  </div>
                  {diagnosticsData.peers.map((peer: any, i: number) => (
                    <div key={i} className="bg-black/20 p-2 rounded col-span-2">
                      <span className="opacity-70">Peer {i+1} ({peer.username}):</span> {peer.connectionState} | ICE: {peer.iceState}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Log Entries */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
              {errorLogs.length === 0 ? (
                <span className="opacity-50" style={{ color: currentTheme.textColor }}>No events logged yet...</span>
              ) : (
                errorLogs.map((log, i) => (
                  <div 
                    key={i} 
                    className={`break-all p-1.5 rounded ${log.type === 'error' ? 'bg-red-500/20' : log.type === 'warn' ? 'bg-yellow-500/20' : 'bg-blue-500/10'}`}
                    style={{ color: currentTheme.textColor }}
                  >
                    <span className="opacity-50">[{log.timestamp}]</span>
                    <span className={`ml-1 font-bold ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-yellow-400' : 'text-blue-400'}`}>
                      {log.type === 'error' ? '❌' : log.type === 'warn' ? '⚠️' : 'ℹ️'}
                    </span>
                    <span className="ml-1">{log.message}</span>
                    {log.details && (
                      <span className="ml-1 opacity-50 text-[9px]">
                        {JSON.stringify(log.details)}
                      </span>
                    )}
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

// Voice message component with playback
function VoiceMessage({ voiceData, duration, isOwn, theme }: { voiceData: string; duration: number; isOwn: boolean; theme: Theme }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const audio = new Audio(voiceData);
    audioRef.current = audio;
    
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [voiceData]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(err => console.error('Audio play failed:', err));
      }
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (audioRef.current && progressRef.current) {
      const rect = progressRef.current.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      audioRef.current.currentTime = percent * duration;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div 
      className={`max-w-[250px] px-3 py-2 rounded-2xl ${
        isOwn 
          ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white rounded-br-sm' 
          : 'bg-white/90 text-gray-800 rounded-bl-sm'
      }`}
    >
      <div className="flex items-center gap-2">
        <button 
          onClick={togglePlay}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
            isPlaying ? 'animate-pulse' : ''
          }`}
          style={{ 
            background: isOwn ? 'rgba(255,255,255,0.3)' : theme.gradient,
            color: isOwn ? '#fff' : '#fff'
          }}
        >
          {isPlaying ? '⏸️' : '▶️'}
        </button>
        <div className="flex-1">
          <div className="text-xs font-medium mb-1">
            {isPlaying ? 'Playing...' : '🎤 Voice message'}
          </div>
          <div 
            ref={progressRef}
            onClick={handleProgressClick}
            className="h-1.5 rounded-full cursor-pointer overflow-hidden"
            style={{ background: isOwn ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)' }}
          >
            <div 
              className="h-full rounded-full transition-all"
              style={{ 
                width: `${(currentTime / duration) * 100}%`,
                background: isOwn ? '#fff' : theme.primary
              }}
            />
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
      
      // Ensure video plays (start muted, then unmute after play)
      const playVideo = async () => {
        try {
          video.muted = true; // Start muted to allow autoplay
          await video.play();
          console.log('RemoteVideo: Playing successfully');
          // Try to unmute after successful play
          setTimeout(() => {
            video.muted = false;
          }, 100);
        } catch (err) {
          console.log('RemoteVideo: Autoplay blocked, will retry:', err);
          // Retry on user interaction
          const handler = () => {
            video.muted = false;
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

// Video Grid Component - Memoized to prevent re-render on theme changes
const VideoGrid = React.memo(({ 
  isVideoEnabled, 
  localVideoStream, 
  localVideoRef, 
  avPeers, 
  connectionQuality 
}: {
  isVideoEnabled: boolean;
  localVideoStream: MediaStream | null;
  localVideoRef: React.RefObject<HTMLVideoElement>;
  avPeers: Map<string, any>;
  connectionQuality: string;
}) => {
  const peerCount = avPeers.size;
  
  return (
    <div className={`grid gap-1.5 ${
      peerCount > 3 ? 'grid-cols-2' : 'grid-cols-1'
    }`}>
      {/* Local video */}
      {isVideoEnabled && localVideoStream && (
        <div className={`relative bg-black rounded-lg overflow-hidden border-2 border-green-500/50 shrink-0 ${
          peerCount > 3 ? 'aspect-square' : 'aspect-video'
        }`}>
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
          <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 px-1 py-0.5 rounded text-white font-medium">
            You
          </span>
          {connectionQuality !== 'high' && (
            <span className="absolute top-1 right-1 text-[7px] bg-black/60 px-1 rounded text-white">
              {connectionQuality === 'medium' ? 'SD' : connectionQuality === 'low' ? 'LD' : 'AU'}
            </span>
          )}
        </div>
      )}
      
      {/* Remote videos */}
      {Array.from(avPeers.values()).map((peer) => (
        peer.videoStream && (
          <div key={peer.id} className={`relative bg-black rounded-lg overflow-hidden shrink-0 ${
            peerCount > 3 ? 'aspect-square' : 'aspect-video'
          }`}>
            <RemoteVideo stream={peer.videoStream} username={peer.username} />
            <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 px-1 py-0.5 rounded text-white font-medium">
              {peer.username}
            </span>
            {!peer.connected && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <span className="text-[10px] text-white animate-pulse">⟳</span>
              </div>
            )}
          </div>
        )
      ))}
    </div>
  );
});

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
