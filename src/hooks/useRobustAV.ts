import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';

interface AVPeer {
  id: string;
  connection: RTCPeerConnection;
  audioStream?: MediaStream;
  videoStream?: MediaStream;
  username: string;
  connected: boolean;
  lastPing: number;
  reconnectCount: number;
  iceBuffer: RTCIceCandidateInit[];
  isSettingRemoteDesc: boolean;
  pendingRemoval?: boolean;
  connectionAttemptTime?: number;
}

interface LocalStreams {
  audio: MediaStream | null;
  video: MediaStream | null;
}

type QualityLevel = 'high' | 'medium' | 'low' | 'audio-only';
type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'failed';

// Conservative RTC config for stability
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  bundlePolicy: 'max-bundle' as RTCBundlePolicy,
  rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy,
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 4,
};

// Conservative limits
const MAX_PEERS = 10; // Hard limit on concurrent peer connections
const MAX_CONCURRENT_CONNECTIONS = 3; // Max connections to establish at once

// Timeouts (in ms)
const CONNECTION_TIMEOUT = 60000;
const ICE_RESTART_DELAY = 45000;
const HEALTH_CHECK_INTERVAL = 20000;
const PING_INTERVAL = 15000;

// Audio constraints - conservative
const getAudioConstraints = (): MediaTrackConstraints => ({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 44100,
  channelCount: 1,
});

// Video constraints - adaptive based on peer count
const getVideoConstraints = (peerCount: number = 0): MediaTrackConstraints => {
  // More aggressive downscaling as more peers join
  const settings = peerCount <= 1 
    ? { width: 640, height: 480, frameRate: 20 }
    : peerCount <= 3
    ? { width: 480, height: 360, frameRate: 15 }
    : peerCount <= 6
    ? { width: 320, height: 240, frameRate: 12 }
    : { width: 240, height: 180, frameRate: 10 };
  
  return {
    facingMode: 'user',
    width: { ideal: settings.width, max: settings.width },
    height: { ideal: settings.height, max: settings.height },
    frameRate: { ideal: settings.frameRate, max: settings.frameRate },
  };
};

// Bitrate constraints
const getAudioBitrate = (peerCount: number): number => {
  if (peerCount <= 2) return 64000;
  if (peerCount <= 4) return 32000;
  return 16000;
};

const getVideoBitrate = (peerCount: number): number => {
  if (peerCount <= 1) return 400000;
  if (peerCount <= 3) return 200000;
  if (peerCount <= 6) return 100000;
  return 50000;
};

// Exponential backoff for reconnection
const getReconnectDelay = (attempt: number): number => {
  const baseDelay = 3000;
  const maxDelay = 60000;
  const delay = Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay);
  return delay + Math.random() * 1000;
};

export function useRobustAV(roomCode: string, localUsername: string, isActive: boolean) {
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [peers, setPeers] = useState<Map<string, AVPeer>>(new Map());
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<QualityLevel>('medium');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);
  const [activePeerCount, setActivePeerCount] = useState(0);
  
  const localStreamsRef = useRef<LocalStreams>({ audio: null, video: null });
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const myIdRef = useRef<string>(`av-${Math.random().toString(36).substr(2, 9)}`);
  const audioContextRef = useRef<AudioContext | null>(null);
  const peersRef = useRef<Map<string, AVPeer>>(new Map());
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const makingOfferRef = useRef<Set<string>>(new Set());
  const lastIceRestartRef = useRef<Map<string, number>>(new Map());
  const currentQualityRef = useRef<QualityLevel>('medium');
  const isReconnectingRef = useRef<boolean>(false);
  const wasConnectedRef = useRef<boolean>(false);
  const lastPingReceivedRef = useRef<number>(Date.now());
  const connectionQueueRef = useRef<string[]>([]);
  const isProcessingConnectionQueueRef = useRef(false);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const statsIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Batch peer updates
  const batchUpdatePeers = useCallback(() => {
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    updateTimeoutRef.current = setTimeout(() => {
      const peerArray = Array.from(peersRef.current.values());
      const activeCount = peerArray.filter(p => p.connected && !p.pendingRemoval).length;
      setActivePeerCount(activeCount);
      setPeers(new Map(peersRef.current));
    }, 150);
  }, []);

  // Update quality ref
  useEffect(() => {
    currentQualityRef.current = connectionQuality;
  }, [connectionQuality]);

  // Network status
  useEffect(() => {
    const handleOnline = () => {
      if (wasConnectedRef.current && !clientRef.current?.connected) {
        attemptMqttReconnect();
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // Connection queue processing - limit concurrent connections
  const processConnectionQueue = useCallback(() => {
    if (isProcessingConnectionQueueRef.current || connectionQueueRef.current.length === 0) return;
    
    const activeConnections = Array.from(peersRef.current.values()).filter(
      p => !p.connected && !p.pendingRemoval
    ).length;
    
    if (activeConnections >= MAX_CONCURRENT_CONNECTIONS) {
      setTimeout(processConnectionQueue, 2000);
      return;
    }
    
    isProcessingConnectionQueueRef.current = true;
    const peerId = connectionQueueRef.current.shift();
    
    if (peerId) {
      const peer = peersRef.current.get(peerId);
      if (peer && !peer.connected) {
        reconnectPeer(peerId);
      }
    }
    
    isProcessingConnectionQueueRef.current = false;
    
    if (connectionQueueRef.current.length > 0) {
      setTimeout(processConnectionQueue, 1500);
    }
  }, []);

  // MQTT reconnection
  const attemptMqttReconnect = useCallback(() => {
    if (isReconnectingRef.current) return;
    isReconnectingRef.current = true;
    setIsReconnecting(true);
    setConnectionState('reconnecting');

    const attempt = async () => {
      if (!wasConnectedRef.current) return;
      
      try {
        if (clientRef.current) {
          clientRef.current.end(true);
        }

        const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
          clientId: myIdRef.current,
          clean: true,
          connectTimeout: 30000,
          reconnectPeriod: 10000,
          keepalive: 60,
        });
        
        clientRef.current = client;
        setupClientHandlers(client);
      } catch (err) {
        setTimeout(() => {
          isReconnectingRef.current = false;
          attemptMqttReconnect();
        }, 10000);
      }
    };

    attempt();
  }, [roomCode]);

  // Setup MQTT handlers
  const setupClientHandlers = (client: mqtt.MqttClient) => {
    client.on('connect', () => {
      console.log('AV MQTT connected');
      setConnectionState('connected');
      setIsReconnecting(false);
      setLastConnectedAt(Date.now());
      isReconnectingRef.current = false;
      lastPingReceivedRef.current = Date.now();
      
      client.subscribe(`xpav/${roomCode}/#`, { qos: 0 });
      
      if (localStreamsRef.current.audio || localStreamsRef.current.video) {
        setTimeout(() => {
          broadcastJoin();
        }, 1000);
      }
      
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        broadcastPing();
      }, PING_INTERVAL);
      
      if (healthCheckIntervalRef.current) clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = setInterval(() => {
        checkConnectionHealth();
      }, HEALTH_CHECK_INTERVAL);
    });

    client.on('message', async (_topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        if (data.from === myIdRef.current) return;

        switch (data.type) {
          case 'av-join':
            if (localStreamsRef.current.audio || localStreamsRef.current.video) {
              // Stagger connection attempts
              setTimeout(() => {
                if (peersRef.current.size < MAX_PEERS) {
                  initiateConnection(data.from, data.username);
                }
              }, Math.random() * 2000 + 500);
            }
            break;
          case 'av-offer':
            await handleOffer(data.offer, data.from, data.username);
            break;
          case 'av-answer':
            await handleAnswer(data.answer, data.from);
            break;
          case 'av-ice':
            await handleIceCandidate(data.candidate, data.from);
            break;
          case 'av-ping':
            handlePing(data.from);
            break;
          case 'av-leave':
            handlePeerLeave(data.from);
            break;
        }
      } catch (e) {
        console.error('AV message error:', e);
      }
    });

    client.on('error', (err: any) => {
      console.error('MQTT error:', err);
    });

    client.on('close', () => {
      setConnectionState('disconnected');
      if (wasConnectedRef.current && !isReconnectingRef.current) {
        setTimeout(() => attemptMqttReconnect(), 5000);
      }
    });

    client.on('offline', () => {
      setConnectionState('disconnected');
    });
  };

  // Main connection effect
  useEffect(() => {
    if (!isActive || !roomCode) return;

    wasConnectedRef.current = true;
    setConnectionState('connecting');

    const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
      clientId: myIdRef.current,
      clean: true,
      connectTimeout: 30000,
      reconnectPeriod: 10000,
      keepalive: 60,
    });
    
    clientRef.current = client;
    setupClientHandlers(client);

    return () => {
      wasConnectedRef.current = false;
      cleanup();
      client.end(true);
    };
  }, [isActive, roomCode]);

  const broadcastPing = () => {
    if (!clientRef.current?.connected) return;
    lastPingReceivedRef.current = Date.now();
    
    clientRef.current.publish(
      `xpav/${roomCode}/ping`,
      JSON.stringify({ type: 'av-ping', from: myIdRef.current, timestamp: Date.now() }),
      { qos: 0 }
    );
  };

  const broadcastJoin = () => {
    if (!clientRef.current?.connected) return;
    
    clientRef.current.publish(
      `xpav/${roomCode}/join`,
      JSON.stringify({
        type: 'av-join',
        from: myIdRef.current,
        username: localUsername,
      }),
      { qos: 0 }
    );
  };

  const broadcastLeave = () => {
    if (!clientRef.current?.connected) return;
    
    clientRef.current.publish(
      `xpav/${roomCode}/leave`,
      JSON.stringify({
        type: 'av-leave',
        from: myIdRef.current,
        username: localUsername,
      }),
      { qos: 0 }
    );
  };

  const handlePing = (from: string) => {
    lastPingReceivedRef.current = Date.now();
    const peer = peersRef.current.get(from);
    if (peer) {
      peer.lastPing = Date.now();
    }
  };

  const handlePeerLeave = (from: string) => {
    const peer = peersRef.current.get(from);
    if (peer) {
      cleanupPeer(peer);
      peersRef.current.delete(from);
      batchUpdatePeers();
      reconnectAttemptsRef.current.delete(from);
      makingOfferRef.current.delete(from);
    }
  };

  const cleanupPeer = (peer: AVPeer) => {
    try {
      // Clear stats interval
      const statsInterval = statsIntervalsRef.current.get(peer.id);
      if (statsInterval) {
        clearInterval(statsInterval);
        statsIntervalsRef.current.delete(peer.id);
      }
      
      peer.connection.close();
    } catch (e) {}
    
    const audioEl = document.getElementById(`av-audio-${peer.id}`);
    if (audioEl) audioEl.remove();
  };

  const checkConnectionHealth = () => {
    const now = Date.now();
    let needsUpdate = false;
    
    peersRef.current.forEach((peer, peerId) => {
      const timeout = peer.connected ? 90000 : 45000;
      
      if (now - peer.lastPing > timeout && !peer.pendingRemoval) {
        peer.connected = false;
        peer.pendingRemoval = true;
        needsUpdate = true;
        
        const attempts = reconnectAttemptsRef.current.get(peerId) || 0;
        if (attempts < 3 && (localStreamsRef.current.audio || localStreamsRef.current.video)) {
          connectionQueueRef.current.push(peerId);
        } else {
          cleanupPeer(peer);
          peersRef.current.delete(peerId);
        }
      }
      
      const pc = peer.connection;
      if (pc) {
        const lastRestart = lastIceRestartRef.current.get(peerId) || 0;
        const canRestart = now - lastRestart > ICE_RESTART_DELAY;
        
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          if (!peer.pendingRemoval) {
            peer.connected = false;
            peer.pendingRemoval = true;
            needsUpdate = true;
            connectionQueueRef.current.push(peerId);
          }
        }
        
        if (pc.iceConnectionState === 'failed' && canRestart && !peer.pendingRemoval) {
          lastIceRestartRef.current.set(peerId, now);
          try {
            pc.restartIce();
          } catch (e) {
            connectionQueueRef.current.push(peerId);
          }
        }
      }
    });
    
    if (needsUpdate) batchUpdatePeers();
    
    if (connectionQueueRef.current.length > 0) {
      processConnectionQueue();
    }
  };

  const reconnectPeer = (peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    
    const attempts = reconnectAttemptsRef.current.get(peerId) || 0;
    if (attempts > 3) {
      cleanupPeer(peer);
      peersRef.current.delete(peerId);
      batchUpdatePeers();
      return;
    }
    
    reconnectAttemptsRef.current.set(peerId, attempts + 1);
    makingOfferRef.current.delete(peerId);
    
    cleanupPeer(peer);
    peersRef.current.delete(peerId);
    
    const delay = getReconnectDelay(attempts);
    
    setTimeout(() => {
      if ((localStreamsRef.current.audio || localStreamsRef.current.video) && clientRef.current?.connected) {
        if (peersRef.current.size < MAX_PEERS) {
          createPeerConnection(peerId, peer.username, true);
        }
      }
    }, delay);
  };

  const initiateConnection = (peerId: string, peerUsername: string) => {
    if (makingOfferRef.current.has(peerId)) return;
    if (!clientRef.current?.connected) return;
    if (peersRef.current.size >= MAX_PEERS) {
      console.log('Max peers reached, queueing connection to:', peerId);
      connectionQueueRef.current.push(peerId);
      return;
    }
    
    createPeerConnection(peerId, peerUsername, true);
  };

  const createPeerConnection = async (peerId: string, peerUsername: string, isInitiator: boolean): Promise<RTCPeerConnection | null> => {
    if (peersRef.current.size >= MAX_PEERS) {
      console.warn(`Max peers (${MAX_PEERS}) reached`);
      return null;
    }
    
    const existing = peersRef.current.get(peerId);
    if (existing?.connected) return existing.connection;
    
    if (existing) {
      cleanupPeer(existing);
      peersRef.current.delete(peerId);
      makingOfferRef.current.delete(peerId);
    }

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peerCount = peersRef.current.size;
      
      if (localStreamsRef.current.audio) {
        localStreamsRef.current.audio.getAudioTracks().forEach(track => {
          const sender = pc.addTrack(track, localStreamsRef.current.audio!);
          applyBitrateConstraint(sender, 'audio', peerCount);
        });
      }

      if (localStreamsRef.current.video) {
        localStreamsRef.current.video.getVideoTracks().forEach(track => {
          const sender = pc.addTrack(track, localStreamsRef.current.video!);
          applyBitrateConstraint(sender, 'video', peerCount);
        });
      }

      const senders = pc.getSenders();
      const hasAudioSender = senders.some(s => s.track?.kind === 'audio');
      const hasVideoSender = senders.some(s => s.track?.kind === 'video');

      if (!hasAudioSender) pc.addTransceiver('audio', { direction: 'recvonly' });
      if (!hasVideoSender) pc.addTransceiver('video', { direction: 'recvonly' });

      // Debounced negotiation
      let negotiationTimeout: NodeJS.Timeout | null = null;
      pc.onnegotiationneeded = async () => {
        if (negotiationTimeout) return;
        negotiationTimeout = setTimeout(async () => {
          negotiationTimeout = null;
          try {
            if (makingOfferRef.current.has(peerId)) return;
            makingOfferRef.current.add(peerId);
            
            const offer = await pc.createOffer();
            if (pc.signalingState !== 'stable') {
              makingOfferRef.current.delete(peerId);
              return;
            }
            
            await pc.setLocalDescription(offer);
            
            if (pc.localDescription && clientRef.current?.connected) {
              clientRef.current.publish(
                `xpav/${roomCode}/offer`,
                JSON.stringify({
                  type: 'av-offer',
                  from: myIdRef.current,
                  to: peerId,
                  offer: pc.localDescription,
                  username: localUsername,
                }),
                { qos: 0 }
              );
            }
          } catch (err) {
            console.error('Negotiation error:', err);
          } finally {
            makingOfferRef.current.delete(peerId);
          }
        }, 200);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && clientRef.current?.connected) {
          clientRef.current.publish(
            `xpav/${roomCode}/ice`,
            JSON.stringify({
              type: 'av-ice',
              from: myIdRef.current,
              to: peerId,
              candidate: event.candidate,
            }),
            { qos: 0 }
          );
        }
      };

      pc.oniceconnectionstatechange = () => {
        const now = Date.now();
        const lastRestart = lastIceRestartRef.current.get(peerId) || 0;
        
        if (pc.iceConnectionState === 'failed' && now - lastRestart > ICE_RESTART_DELAY) {
          lastIceRestartRef.current.set(peerId, now);
          try {
            pc.restartIce();
          } catch (e) {
            if (!peer.pendingRemoval) {
              connectionQueueRef.current.push(peerId);
            }
          }
        }
      };

      pc.ontrack = (event) => {
        const peer = peersRef.current.get(peerId);
        if (!peer) return;
        
        let stream: MediaStream;
        if (event.streams && event.streams[0]) {
          stream = event.streams[0];
        } else {
          stream = new MediaStream([event.track]);
        }
        
        if (event.track.kind === 'audio') {
          peer.audioStream = stream;
          setTimeout(() => playAudio(peerId, stream), 100);
        } else if (event.track.kind === 'video') {
          peer.videoStream = stream;
        }
        
        peer.connected = true;
        peer.pendingRemoval = false;
        peer.lastPing = Date.now();
        batchUpdatePeers();
        
        reconnectAttemptsRef.current.set(peerId, 0);
      };

      const connectionTimeout = setTimeout(() => {
        if (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting') {
          if (!peer.pendingRemoval) {
            connectionQueueRef.current.push(peerId);
          }
        }
      }, CONNECTION_TIMEOUT);

      pc.onconnectionstatechange = () => {
        const peer = peersRef.current.get(peerId);
        if (!peer) return;
        
        if (pc.connectionState === 'connected') {
          clearTimeout(connectionTimeout);
          peer.connected = true;
          peer.pendingRemoval = false;
          peer.lastPing = Date.now();
          batchUpdatePeers();
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          clearTimeout(connectionTimeout);
          peer.connected = false;
          batchUpdatePeers();
        }
      };

      const peer: AVPeer = { 
        id: peerId, 
        connection: pc,
        username: peerUsername,
        connected: false,
        lastPing: Date.now(),
        reconnectCount: 0,
        iceBuffer: [],
        isSettingRemoteDesc: false,
        connectionAttemptTime: Date.now(),
      };
      
      peersRef.current.set(peerId, peer);
      batchUpdatePeers();

      if (isInitiator) {
        try {
          makingOfferRef.current.add(peerId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          if (pc.localDescription && clientRef.current?.connected) {
            clientRef.current.publish(
              `xpav/${roomCode}/offer`,
              JSON.stringify({
                type: 'av-offer',
                from: myIdRef.current,
                to: peerId,
                offer: pc.localDescription,
                username: localUsername,
              }),
              { qos: 0 }
            );
          }
        } catch (err) {
          console.error('Offer error:', err);
        } finally {
          makingOfferRef.current.delete(peerId);
        }
      }

      return pc;
    } catch (err) {
      console.error('Error creating peer connection:', err);
      return null;
    }
  };

  const applyBitrateConstraint = (sender: RTCRtpSender, kind: 'audio' | 'video', peerCount: number = 0) => {
    const params = sender.getParameters();
    if (params.encodings && params.encodings[0]) {
      if (kind === 'audio') {
        params.encodings[0].maxBitrate = getAudioBitrate(peerCount);
      } else {
        params.encodings[0].maxBitrate = getVideoBitrate(peerCount);
      }
      sender.setParameters(params).catch(() => {});
    }
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit, from: string, username: string) => {
    const existing = peersRef.current.get(from);
    
    if (existing && makingOfferRef.current.has(from)) {
      if (myIdRef.current < from) {
        return;
      } else {
        makingOfferRef.current.delete(from);
        cleanupPeer(existing);
        peersRef.current.delete(from);
      }
    }

    const pc = await createPeerConnection(from, username, false);
    if (!pc) return;
    
    const peer = peersRef.current.get(from);
    if (peer) peer.isSettingRemoteDesc = true;
    
    try {
      await pc.setRemoteDescription(offer);
      
      if (peer && peer.iceBuffer.length > 0) {
        for (const candidate of peer.iceBuffer) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (e) {}
        }
        peer.iceBuffer = [];
      }
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      if (pc.localDescription && clientRef.current?.connected) {
        clientRef.current.publish(
          `xpav/${roomCode}/answer`,
          JSON.stringify({
            type: 'av-answer',
            from: myIdRef.current,
            to: from,
            answer: pc.localDescription,
          }),
          { qos: 0 }
        );
      }
    } catch (err) {
      console.error('Answer error:', err);
    } finally {
      if (peer) peer.isSettingRemoteDesc = false;
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit, from: string) => {
    makingOfferRef.current.delete(from);
    const peer = peersRef.current.get(from);
    if (peer) {
      try {
        await peer.connection.setRemoteDescription(answer);
        
        if (peer.iceBuffer.length > 0) {
          for (const candidate of peer.iceBuffer) {
            try {
              await peer.connection.addIceCandidate(candidate);
            } catch (e) {}
          }
          peer.iceBuffer = [];
        }
      } catch (err) {
        console.error('Set remote desc error:', err);
      }
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidateInit, from: string) => {
    const peer = peersRef.current.get(from);
    if (!peer || !candidate) return;
    
    if (!peer.connection.remoteDescription || peer.isSettingRemoteDesc) {
      peer.iceBuffer.push(candidate);
      return;
    }
    
    try {
      await peer.connection.addIceCandidate(candidate);
    } catch (err) {
      console.error('ICE error:', err);
    }
  };

  const audioUnlockedRef = useRef(false);

  const unlockAudioContext = async () => {
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioContextRef.current = new AudioContextClass();
        }
      }
      
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      audioUnlockedRef.current = true;
    } catch (err) {}
  };

  const globalAudioUnlock = async () => {
    if (audioUnlockedRef.current) return;
    await unlockAudioContext();
    
    document.querySelectorAll('audio').forEach((audio) => {
      if (audio.paused || audio.muted) {
        audio.muted = false;
        audio.play().catch(() => {});
      }
    });
    
    audioUnlockedRef.current = true;
  };

  const playAudio = (peerId: string, stream: MediaStream) => {
    const existing = document.getElementById(`av-audio-${peerId}`) as HTMLAudioElement;
    if (existing) {
      existing.pause();
      existing.srcObject = null;
      existing.remove();
    }
    
    const audio = document.createElement('audio');
    audio.id = `av-audio-${peerId}`;
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.volume = 1.0;
    audio.muted = false;
    audio.playsInline = true;
    audio.setAttribute('data-peer-id', peerId);
    audio.style.position = 'fixed';
    audio.style.opacity = '0';
    audio.style.pointerEvents = 'none';
    
    document.body.appendChild(audio);
    
    audio.play().catch(() => {
      audio.muted = true;
    });
  };

  const enableAudio = async (): Promise<boolean> => {
    try {
      setError(null);
      await unlockAudioContext();
      
      if (localStreamsRef.current.audio) {
        localStreamsRef.current.audio.getTracks().forEach(t => t.stop());
        localStreamsRef.current.audio = null;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: getAudioConstraints(),
        video: false,
      });
      
      localStreamsRef.current.audio = stream;
      setIsAudioEnabled(true);
      
      const peerCount = peersRef.current.size;
      const promises = Array.from(peersRef.current.entries()).map(async ([peerId, peer]) => {
        try {
          const senders = peer.connection.getSenders();
          for (const sender of senders) {
            if (sender.track?.kind === 'audio') {
              try {
                peer.connection.removeTrack(sender);
              } catch (e) {}
            }
          }
          
          stream.getAudioTracks().forEach(track => {
            const sender = peer.connection.addTrack(track, stream);
            applyBitrateConstraint(sender, 'audio', peerCount);
          });
        } catch (err) {}
      });
      
      await Promise.all(promises);
      
      setTimeout(() => broadcastJoin(), 1000);
      
      return true;
    } catch (err) {
      setError('Microphone access denied');
      setIsAudioEnabled(false);
      return false;
    }
  };

  const enableVideo = async (): Promise<boolean> => {
    try {
      setError(null);
      const peerCount = peersRef.current.size;
      
      if (localStreamsRef.current.video) {
        localStreamsRef.current.video.getTracks().forEach(t => t.stop());
        localStreamsRef.current.video = null;
        setLocalVideoStream(null);
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: getVideoConstraints(peerCount),
      });
      
      localStreamsRef.current.video = stream;
      setLocalVideoStream(stream);
      setIsVideoEnabled(true);
      
      const promises = Array.from(peersRef.current.entries()).map(async ([peerId, peer]) => {
        try {
          const senders = peer.connection.getSenders();
          for (const sender of senders) {
            if (sender.track?.kind === 'video') {
              try {
                peer.connection.removeTrack(sender);
              } catch (e) {}
            }
          }
          
          stream.getVideoTracks().forEach(track => {
            const sender = peer.connection.addTrack(track, stream);
            applyBitrateConstraint(sender, 'video', peerCount);
          });
        } catch (err) {}
      });
      
      await Promise.all(promises);
      
      setTimeout(() => broadcastJoin(), 1000);
      
      return true;
    } catch (err) {
      setError('Camera access denied');
      setIsVideoEnabled(false);
      return false;
    }
  };

  const disableAudio = () => {
    if (localStreamsRef.current.audio) {
      localStreamsRef.current.audio.getTracks().forEach(t => t.stop());
      localStreamsRef.current.audio = null;
    }
    setIsAudioEnabled(false);
    broadcastLeave();
  };

  const disableVideo = () => {
    if (localStreamsRef.current.video) {
      localStreamsRef.current.video.getTracks().forEach(t => t.stop());
      localStreamsRef.current.video = null;
    }
    setLocalVideoStream(null);
    setIsVideoEnabled(false);
    broadcastLeave();
  };

  const toggleAudio = async (): Promise<boolean> => {
    if (isAudioEnabled) {
      disableAudio();
      return false;
    }
    return await enableAudio();
  };

  const toggleVideo = async (): Promise<boolean> => {
    if (isVideoEnabled) {
      disableVideo();
      return false;
    }
    return await enableVideo();
  };

  const setQuality = (quality: QualityLevel) => {
    currentQualityRef.current = quality;
    setConnectionQuality(quality);
    
    if (isAudioEnabled) enableAudio();
    if (isVideoEnabled) enableVideo();
  };

  const getDiagnostics = async () => {
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      roomCode,
      localUsername,
      myId: myIdRef.current,
      isAudioEnabled,
      isVideoEnabled,
      connectionState,
      connectionQuality,
      mqttConnected: clientRef.current?.connected || false,
      peers: Array.from(peersRef.current.entries()).map(([id, peer]) => ({
        id,
        username: peer.username,
        connected: peer.connected,
        connectionState: peer.connection.connectionState,
        iceState: peer.connection.iceConnectionState,
      })),
    };

    return diagnostics;
  };

  const cleanup = () => {
    wasConnectedRef.current = false;
    broadcastLeave();
    
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    if (healthCheckIntervalRef.current) clearInterval(healthCheckIntervalRef.current);
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    
    // Clear all stats intervals
    statsIntervalsRef.current.forEach(interval => clearInterval(interval));
    statsIntervalsRef.current.clear();
    
    disableAudio();
    disableVideo();
    
    peersRef.current.forEach((peer) => cleanupPeer(peer));
    peersRef.current.clear();
    setPeers(new Map());
    makingOfferRef.current.clear();
    lastIceRestartRef.current.clear();
    connectionQueueRef.current = [];
  };

  return {
    isAudioEnabled,
    isVideoEnabled,
    peers,
    localVideoStream,
    error,
    connectionQuality,
    connectionState,
    isReconnecting,
    lastConnectedAt,
    activePeerCount,
    toggleAudio,
    toggleVideo,
    setQuality,
    getDiagnostics,
    globalAudioUnlock,
  };
}
