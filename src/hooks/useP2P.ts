import { useState, useEffect, useRef, useCallback } from 'react';
import Peer from 'peerjs';

export interface PeerMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  type: 'chat' | 'system';
}

export interface PeerUser {
  id: string;
  username: string;
  hasAudio: boolean;
}

export function useP2P(localUsername: string, roomId: string) {
  const [messages, setMessages] = useState<PeerMessage[]>([]);
  const [peers, setPeers] = useState<Map<string, PeerUser>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [myPeerId, setMyPeerId] = useState<string>('');
  
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, any>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Initialize PeerJS
  useEffect(() => {
    if (!roomId || !localUsername) return;

    setConnectionStatus('connecting');
    
    // Create peer with unique ID based on room
    const peerId = `${roomId}-${localUsername}-${Math.random().toString(36).substr(2, 6)}`;
    
    const peer = new Peer(peerId, {
      host: 'peerjs-server.herokuapp.com',
      port: 443,
      secure: true,
      debug: 2,
    });
    
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('My peer ID is:', id);
      setMyPeerId(id);
      setIsConnected(true);
      setConnectionStatus('connected');
      
      // Announce presence to room
      broadcastMessage({
        type: 'join',
        username: localUsername,
        peerId: id,
      });
    });

    peer.on('connection', (conn) => {
      console.log('Incoming connection from:', conn.peer);
      setupConnection(conn);
    });

    peer.on('call', (call) => {
      console.log('Incoming call from:', call.peer);
      
      // Answer with local stream if voice is enabled
      if (localStreamRef.current) {
        call.answer(localStreamRef.current);
      } else {
        call.answer();
      }
      
      call.on('stream', (remoteStream) => {
        console.log('Received remote stream from:', call.peer);
        playRemoteAudio(call.peer, remoteStream);
      });
      
      call.on('error', (err) => {
        console.error('Call error:', err);
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      setConnectionStatus('disconnected');
    });

    peer.on('disconnected', () => {
      console.log('Peer disconnected');
      setConnectionStatus('disconnected');
    });

    // Connect to existing peers in the room
    const interval = setInterval(() => {
      discoverAndConnectPeers();
    }, 3000);

    return () => {
      clearInterval(interval);
      
      // Cleanup
      connectionsRef.current.forEach((conn) => {
        conn.close();
      });
      
      audioElementsRef.current.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;
      });
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      peer.destroy();
    };
  }, [roomId, localUsername]);

  // Setup data connection
  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      console.log('Connection opened with:', conn.peer);
      connectionsRef.current.set(conn.peer, conn);
      
      // Add to peers list
      setPeers(prev => {
        const newPeers = new Map(prev);
        newPeers.set(conn.peer, {
          id: conn.peer,
          username: conn.metadata?.username || 'Unknown',
          hasAudio: false,
        });
        return newPeers;
      });
      
      // Send our info
      conn.send({
        type: 'info',
        username: localUsername,
        hasAudio: !!localStreamRef.current,
      });
    });

    conn.on('data', (data: any) => {
      console.log('Received data:', data);
      handleData(conn.peer, data);
    });

    conn.on('close', () => {
      console.log('Connection closed with:', conn.peer);
      connectionsRef.current.delete(conn.peer);
      
      setPeers(prev => {
        const newPeers = new Map(prev);
        newPeers.delete(conn.peer);
        return newPeers;
      });
      
      // Remove audio element
      const audio = audioElementsRef.current.get(conn.peer);
      if (audio) {
        audio.pause();
        audio.srcObject = null;
        audioElementsRef.current.delete(conn.peer);
      }
    });

    conn.on('error', (err: any) => {
      console.error('Connection error:', err);
    });
  };

  // Handle incoming data
  const handleData = (peerId: string, data: any) => {
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
          const peer = newPeers.get(peerId);
          if (peer) {
            peer.username = data.username;
            peer.hasAudio = data.hasAudio;
          } else {
            newPeers.set(peerId, {
              id: peerId,
              username: data.username,
              hasAudio: data.hasAudio,
            });
          }
          return newPeers;
        });
        break;
        
      case 'join':
        addSystemMessage(`${data.username} joined!`);
        
        // Connect back to this peer
        if (peerRef.current && data.peerId !== myPeerId) {
          setTimeout(() => {
            connectToPeer(data.peerId, data.username);
          }, 500);
        }
        break;
    }
  };

  // Connect to a peer
  const connectToPeer = (peerId: string, _username: string) => {
    if (!peerRef.current) return;
    if (connectionsRef.current.has(peerId)) return;
    if (peerId === myPeerId) return;
    
    console.log('Connecting to peer:', peerId);
    
    const conn = peerRef.current.connect(peerId, {
      metadata: { username: localUsername },
      reliable: true,
    });
    
    setupConnection(conn);
    
    // Initiate call if we have audio
    if (localStreamRef.current) {
      setTimeout(() => {
        const call = peerRef.current!.call(peerId, localStreamRef.current!);
        call.on('stream', (remoteStream) => {
          console.log('Received stream from call:', peerId);
          playRemoteAudio(peerId, remoteStream);
        });
      }, 1000);
    }
  };

  // Discover and connect to peers
  const discoverAndConnectPeers = () => {
    if (!peerRef.current || !roomId) return;
    
    // Try to connect to potential peers in the room
    // In a real app, you'd use a discovery service
    // For now, we'll use a simple approach with predefined peer IDs
    
    // This is a workaround - we'll try common peer ID patterns
    const commonNames = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley'];
    
    commonNames.forEach(name => {
      if (name === localUsername) return;
      
      // Try different peer ID patterns - simplified for now
      // In production, use a proper signaling server
      void name;
    });
  };

  // Play remote audio
  const playRemoteAudio = (peerId: string, stream: MediaStream) => {
    // Remove existing audio element
    const existingAudio = audioElementsRef.current.get(peerId);
    if (existingAudio) {
      existingAudio.pause();
      existingAudio.srcObject = null;
    }
    
    // Create new audio element
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.volume = 1.0;
    
    audioElementsRef.current.set(peerId, audio);
    
    // Update peer hasAudio status
    setPeers(prev => {
      const newPeers = new Map(prev);
      const peer = newPeers.get(peerId);
      if (peer) {
        peer.hasAudio = true;
      }
      return newPeers;
    });
    
    console.log('Playing audio from:', peerId);
  };

  // Broadcast message to all peers
  const broadcastMessage = (data: any) => {
    connectionsRef.current.forEach((conn) => {
      if (conn.open) {
        conn.send(data);
      }
    });
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
    
    const message: PeerMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      username: localUsername,
      text: text.trim(),
      timestamp: Date.now(),
      type: 'chat',
    };
    
    // Add to local messages
    setMessages(prev => [...prev, message]);
    
    // Broadcast to all peers
    broadcastMessage({
      type: 'chat',
      username: localUsername,
      text: text.trim(),
    });
  }, [localUsername]);

  // Enable voice
  const enableVoice = async (): Promise<boolean> => {
    try {
      console.log('Requesting microphone...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
        },
        video: false,
      });
      
      console.log('Microphone access granted!');
      localStreamRef.current = stream;
      setIsVoiceEnabled(true);
      
      // Call all connected peers
      connectionsRef.current.forEach((conn, peerId) => {
        if (peerRef.current && conn.open) {
          console.log('Calling peer:', peerId);
          const call = peerRef.current.call(peerId, stream);
          call.on('stream', (remoteStream) => {
            playRemoteAudio(peerId, remoteStream);
          });
        }
      });
      
      // Broadcast that we have audio
      broadcastMessage({
        type: 'info',
        username: localUsername,
        hasAudio: true,
      });
      
      addSystemMessage('Voice chat enabled! 🎤');
      return true;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      addSystemMessage('Could not access microphone. Please check permissions.');
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
    addSystemMessage('Voice chat disabled.');
    
    // Broadcast that we no longer have audio
    broadcastMessage({
      type: 'info',
      username: localUsername,
      hasAudio: false,
    });
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

  return {
    peers,
    messages,
    isConnected,
    connectionStatus,
    isVoiceEnabled,
    myPeerId,
    sendMessage,
    toggleVoice,
    connectToPeer,
  };
}
