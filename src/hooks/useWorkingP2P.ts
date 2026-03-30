import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  type: 'chat' | 'system';
}

interface PeerData {
  id: string;
  username: string;
  connected: boolean;
}

// Free public STUN servers
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export function useWorkingP2P(localUsername: string, roomCode: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peers, setPeers] = useState<Map<string, PeerData>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [myId, setMyId] = useState<string>('');
  
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const myIdRef = useRef<string>('');
  const isInitiatorRef = useRef<boolean>(false);

  // Generate unique ID
  useEffect(() => {
    const id = Math.random().toString(36).substr(2, 9);
    setMyId(id);
    myIdRef.current = id;
  }, []);

  // Connect to signaling server and setup P2P
  useEffect(() => {
    if (!roomCode || !myId) return;

    setConnectionStatus('connecting');
    
    // Use a free WebSocket relay service
    const wsUrl = `wss://ws.postman-echo.com/raw`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        
        // Join room
        ws.send(JSON.stringify({
          type: 'join',
          room: roomCode,
          id: myIdRef.current,
          username: localUsername,
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WS message:', data);
          
          // Ignore our own messages
          if (data.from === myIdRef.current) return;
          
          // Only process messages from our room
          if (data.room && data.room !== roomCode) return;

          switch (data.type) {
            case 'user-joined':
              if (data.id !== myIdRef.current) {
                // Someone joined - become initiator and create offer
                isInitiatorRef.current = true;
                await createPeerConnection();
                await createAndSendOffer();
              }
              break;
              
            case 'offer':
              if (!isInitiatorRef.current) {
                await handleOffer(data.offer, data.from);
              }
              break;
              
            case 'answer':
              if (isInitiatorRef.current && pcRef.current) {
                await pcRef.current.setRemoteDescription(data.answer);
              }
              break;
              
            case 'ice-candidate':
              if (pcRef.current && data.candidate) {
                await pcRef.current.addIceCandidate(data.candidate);
              }
              break;
          }
        } catch (err) {
          console.error('Error handling WS message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setConnectionStatus('disconnected');
        // Fallback: try direct connection
        tryDirectConnection();
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        setConnectionStatus('disconnected');
      };
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      tryDirectConnection();
    }

    return () => {
      cleanup();
    };
  }, [roomCode, myId, localUsername]);

  // Try direct connection without signaling (same network only)
  const tryDirectConnection = async () => {
    console.log('Trying direct connection...');
    isInitiatorRef.current = true;
    await createPeerConnection();
  };

  // Create RTCPeerConnection
  const createPeerConnection = async () => {
    console.log('Creating peer connection...');
    
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    // Create data channel if initiator
    if (isInitiatorRef.current) {
      const dataChannel = pc.createDataChannel('chat', {
        ordered: true,
      });
      setupDataChannel(dataChannel);
      dataChannelRef.current = dataChannel;
    } else {
      // Wait for data channel from initiator
      pc.ondatachannel = (event) => {
        console.log('Received data channel');
        setupDataChannel(event.channel);
        dataChannelRef.current = event.channel;
      };
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          room: roomCode,
          from: myIdRef.current,
          candidate: event.candidate,
        }));
      }
    };

    // Handle connection state
    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
        setConnectionStatus('connected');
        addSystemMessage('🎉 Connected! You can now chat.');
        
        setPeers(prev => {
          const newPeers = new Map(prev);
          newPeers.set('peer', {
            id: 'peer',
            username: 'Friend',
            connected: true,
          });
          return newPeers;
        });
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setIsConnected(false);
        setConnectionStatus('disconnected');
        addSystemMessage('Connection lost. Please refresh to reconnect.');
      }
    };

    // Handle incoming audio stream
    pc.ontrack = (event) => {
      console.log('Received remote track');
      const [stream] = event.streams;
      
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(console.error);
      } else {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.autoplay = true;
        audioRef.current = audio;
      }
      
      setPeers(prev => {
        const newPeers = new Map(prev);
        const peer = newPeers.get('peer');
        if (peer) {
          peer.connected = true;
        }
        return newPeers;
      });
    };
  };

  // Create and send offer
  const createAndSendOffer = async () => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          room: roomCode,
          from: myIdRef.current,
          offer: offer,
        }));
      }
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  };

  // Handle incoming offer
  const handleOffer = async (offer: RTCSessionDescriptionInit, from: string) => {
    console.log('Handling offer from:', from);
    
    if (!pcRef.current) {
      await createPeerConnection();
    }
    
    const pc = pcRef.current;
    if (!pc) return;

    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'answer',
          room: roomCode,
          from: myIdRef.current,
          to: from,
          answer: answer,
        }));
      }
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  };

  // Setup data channel
  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.onopen = () => {
      console.log('Data channel opened!');
      setIsConnected(true);
      setConnectionStatus('connected');
      
      // Send our info
      channel.send(JSON.stringify({
        type: 'info',
        username: localUsername,
      }));
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleDataChannelMessage(data);
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    };

    channel.onclose = () => {
      console.log('Data channel closed');
      setIsConnected(false);
      setConnectionStatus('disconnected');
    };

    channel.onerror = (err) => {
      console.error('Data channel error:', err);
    };
  };

  // Handle data channel message
  const handleDataChannelMessage = (data: any) => {
    switch (data.type) {
      case 'chat':
        setMessages(prev => [...prev, {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          username: data.username,
          text: data.text,
          timestamp: Date.now(),
          type: 'chat',
        }]);
        break;
        
      case 'info':
        setPeers(prev => {
          const newPeers = new Map(prev);
          const peer = newPeers.get('peer');
          if (peer) {
            peer.username = data.username;
          }
          return newPeers;
        });
        addSystemMessage(`${data.username} joined the chat!`);
        break;
    }
  };

  // Add system message
  const addSystemMessage = (text: string) => {
    setMessages(prev => [...prev, {
      id: `sys-${Date.now()}`,
      username: 'System',
      text,
      timestamp: Date.now(),
      type: 'system',
    }]);
  };

  // Send chat message
  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    
    const msg = {
      type: 'chat',
      username: localUsername,
      text: text.trim(),
    };
    
    // Add to local messages
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      username: localUsername,
      text: text.trim(),
      timestamp: Date.now(),
      type: 'chat',
    }]);
    
    // Send via data channel
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(msg));
    }
  }, [localUsername]);

  // Enable voice
  const enableVoice = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      
      localStreamRef.current = stream;
      setIsVoiceEnabled(true);
      
      // Add tracks to peer connection
      const pc = pcRef.current;
      if (pc) {
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream);
        });
      }
      
      addSystemMessage('🎤 Voice enabled!');
      return true;
    } catch (err) {
      console.error('Error accessing microphone:', err);
      addSystemMessage('Could not access microphone. Please allow permissions.');
      return false;
    }
  };

  // Disable voice
  const disableVoice = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setIsVoiceEnabled(false);
    addSystemMessage('Voice disabled.');
  };

  // Toggle voice
  const toggleVoice = async (): Promise<boolean> => {
    if (isVoiceEnabled) {
      disableVoice();
      return false;
    } else {
      return await enableVoice();
    }
  };

  // Cleanup
  const cleanup = () => {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    
    setIsConnected(false);
    setIsVoiceEnabled(false);
    setConnectionStatus('disconnected');
  };

  return {
    messages,
    peers,
    isConnected,
    connectionStatus,
    isVoiceEnabled,
    myId,
    sendMessage,
    toggleVoice,
    cleanup,
  };
}
