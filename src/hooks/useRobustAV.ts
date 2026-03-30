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
  statsInterval?: NodeJS.Timeout;
  iceBuffer: RTCIceCandidateInit[];
  iceReconnectTimeout?: NodeJS.Timeout;
  isSettingRemoteDesc: boolean;
}

interface LocalStreams {
  audio: MediaStream | null;
  video: MediaStream | null;
}

type QualityLevel = 'high' | 'medium' | 'low' | 'audio-only';
type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'failed';

// Enhanced RTC config with more TURN servers for better connectivity
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
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
    {
      urls: 'turn:relay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle' as RTCBundlePolicy,
  rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy,
  iceTransportPolicy: 'all',
};

// Adaptive audio constraints
const getAudioConstraints = (quality: QualityLevel): MediaTrackConstraints => ({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: quality === 'high' ? 48000 : 44100,
  channelCount: quality === 'audio-only' ? 1 : 2,
});

// Adaptive video constraints
const getVideoConstraints = (quality: QualityLevel, isMobile: boolean): MediaTrackConstraints => {
  const constraints: MediaTrackConstraints = {
    facingMode: 'user',
  };

  if (quality === 'high' && !isMobile) {
    constraints.width = { ideal: 1280, max: 1920 };
    constraints.height = { ideal: 720, max: 1080 };
    constraints.frameRate = { ideal: 30, max: 30 };
  } else if (quality === 'medium' || isMobile) {
    constraints.width = { ideal: 640, max: 1280 };
    constraints.height = { ideal: 480, max: 720 };
    constraints.frameRate = { ideal: 24, max: 24 };
  } else {
    constraints.width = { ideal: 480, max: 640 };
    constraints.height = { ideal: 360, max: 480 };
    constraints.frameRate = { ideal: 15, max: 15 };
  }

  return constraints;
};

const getAudioBitrate = (quality: QualityLevel): number => {
  switch (quality) {
    case 'high': return 256000;
    case 'medium': return 128000;
    case 'low': return 64000;
    case 'audio-only': return 64000;
    default: return 128000;
  }
};

const getVideoBitrate = (quality: QualityLevel): number => {
  switch (quality) {
    case 'high': return 1500000;
    case 'medium': return 800000;
    case 'low': return 400000;
    default: return 800000;
  }
};

// Exponential backoff with jitter for reconnection
const getReconnectDelay = (attempt: number): number => {
  const baseDelay = 1000;
  const maxDelay = 30000;
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = Math.random() * 1000;
  return exponentialDelay + jitter;
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
  
  const localStreamsRef = useRef<LocalStreams>({ audio: null, video: null });
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const myIdRef = useRef<string>(`av-${Math.random().toString(36).substr(2, 9)}`);
  const peersRef = useRef<Map<string, AVPeer>>(new Map());
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const qualityMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const isMobileRef = useRef<boolean>(false);
  const networkQualityRef = useRef<{ packetsLost: number; jitter: number; rtt: number }>({ packetsLost: 0, jitter: 0, rtt: 0 });
  const makingOfferRef = useRef<Set<string>>(new Set());
  const stableConnectionRef = useRef<Map<string, boolean>>(new Map());
  const lastIceRestartRef = useRef<Map<string, number>>(new Map());
  const qualityChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentQualityRef = useRef<QualityLevel>('medium');
  
  // Auto-reconnect refs
  const mqttReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionRecoveryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isReconnectingRef = useRef<boolean>(false);
  const wasConnectedRef = useRef<boolean>(false);
  const pendingReconnectPeersRef = useRef<Set<string>>(new Set());
  const heartbeatMissedCountRef = useRef<number>(0);
  const lastPingReceivedRef = useRef<number>(Date.now());

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      isMobileRef.current = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    };
    checkMobile();
  }, []);

  // Keep ref in sync with state
  useEffect(() => {
    currentQualityRef.current = connectionQuality;
  }, [connectionQuality]);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      console.log('Network is online - attempting reconnect');
      if (wasConnectedRef.current && !clientRef.current?.connected) {
        attemptMqttReconnect();
      }
    };

    const handleOffline = () => {
      console.log('Network is offline');
      setConnectionState('disconnected');
      setIsReconnecting(true);
      isReconnectingRef.current = true;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Visibility change handling (tab switching)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('Tab hidden - maintaining connection');
      } else {
        console.log('Tab visible - checking connection health');
        // Check if we need to reconnect when coming back to tab
        if (wasConnectedRef.current && !clientRef.current?.connected) {
          attemptMqttReconnect();
        }
        // Verify peer connections
        peersRef.current.forEach((peer, peerId) => {
          if (!peer.connected) {
            pendingReconnectPeersRef.current.add(peerId);
          }
        });
        processPendingPeerReconnects();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Monitor connection quality
  const monitorConnectionQuality = useCallback(async (peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer || !peer.connection || peer.connection.connectionState !== 'connected') return;

    try {
      const stats = await peer.connection.getStats();
      let packetsLost = 0;
      let packetsReceived = 1;
      let jitter = 0;
      let rtt = 0;

      stats.forEach((report: any) => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsLost = report.packetsLost || 0;
          packetsReceived = report.packetsReceived || 1;
          jitter = report.jitter || 0;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = report.currentRoundTripTime || 0;
        }
      });

      const lossRate = packetsLost / (packetsLost + packetsReceived);
      networkQualityRef.current = { packetsLost: lossRate, jitter, rtt };

      if (lossRate > 0.08 || rtt > 0.4) {
        setConnectionQuality('low');
      } else if (lossRate > 0.03 || rtt > 0.2) {
        setConnectionQuality('medium');
      } else {
        setConnectionQuality('high');
      }
    } catch (e) {
      console.log('Stats error:', e);
    }
  }, []);

  // Attempt MQTT reconnection with exponential backoff
  const attemptMqttReconnect = useCallback(() => {
    if (isReconnectingRef.current) return;
    isReconnectingRef.current = true;
    setIsReconnecting(true);
    setConnectionState('reconnecting');

    const attempt = async () => {
      if (!wasConnectedRef.current) return;
      
      try {
        console.log('Attempting MQTT reconnection...');
        
        // Clean up old connection
        if (clientRef.current) {
          clientRef.current.end(true);
        }

        // Create new client
        const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
          clientId: myIdRef.current,
          clean: true,
          connectTimeout: 30000,
          reconnectPeriod: 5000,
          keepalive: 30,
        });
        
        clientRef.current = client;

        client.on('connect', () => {
          console.log('MQTT reconnected successfully');
          isReconnectingRef.current = false;
          setIsReconnecting(false);
          setConnectionState('connected');
          setLastConnectedAt(Date.now());
          heartbeatMissedCountRef.current = 0;
          
          if (mqttReconnectTimeoutRef.current) {
            clearTimeout(mqttReconnectTimeoutRef.current);
            mqttReconnectTimeoutRef.current = null;
          }

          client.subscribe(`xpav/${roomCode}/#`);
          
          // Re-announce presence if AV is active
          if (localStreamsRef.current.audio || localStreamsRef.current.video) {
            setTimeout(() => {
              broadcastJoin();
              // Reconnect all peers
              peersRef.current.forEach((_, peerId) => {
                reconnectPeer(peerId);
              });
            }, 500);
          }
        });

        client.on('error', (err) => {
          console.error('MQTT error:', err);
        });

        client.on('close', () => {
          console.log('MQTT connection closed');
          if (!isReconnectingRef.current && wasConnectedRef.current) {
            scheduleReconnect();
          }
        });

        setupClientHandlers(client);
        
      } catch (err) {
        console.error('Reconnection attempt failed:', err);
        scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      const attempts = reconnectAttemptsRef.current.get('mqtt') || 0;
      reconnectAttemptsRef.current.set('mqtt', attempts + 1);
      const delay = getReconnectDelay(attempts);
      
      console.log(`Scheduling reconnect attempt ${attempts + 1} in ${delay}ms`);
      
      mqttReconnectTimeoutRef.current = setTimeout(() => {
        isReconnectingRef.current = false;
        attempt();
      }, delay);
    };

    attempt();
  }, [roomCode]);

  // Process pending peer reconnects
  const processPendingPeerReconnects = useCallback(() => {
    pendingReconnectPeersRef.current.forEach((peerId) => {
      const peer = peersRef.current.get(peerId);
      if (peer && !peer.connected) {
        reconnectPeer(peerId);
      }
    });
    pendingReconnectPeersRef.current.clear();
  }, []);

  // Setup MQTT client handlers
  const setupClientHandlers = (client: mqtt.MqttClient) => {
    client.on('message', async (_topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        if (data.from === myIdRef.current) return;

        switch (data.type) {
          case 'av-join':
            if (localStreamsRef.current.audio || localStreamsRef.current.video) {
              setTimeout(() => {
                initiateConnection(data.from, data.username);
              }, Math.random() * 500 + 100);
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
          case 'av-reconnect':
            await handleReconnectRequest(data.from, data.username);
            break;
          case 'av-quality-change':
            console.log('Peer changed quality:', data.quality);
            break;
          case 'av-leave':
            handlePeerLeave(data.from);
            break;
        }
      } catch (e) {
        console.error('AV message error:', e);
      }
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
      reconnectPeriod: 5000,
      keepalive: 30,
    });
    
    clientRef.current = client;

    client.on('connect', () => {
      console.log('AV MQTT connected');
      setConnectionState('connected');
      setIsReconnecting(false);
      setLastConnectedAt(Date.now());
      isReconnectingRef.current = false;
      heartbeatMissedCountRef.current = 0;
      reconnectAttemptsRef.current.set('mqtt', 0);
      
      client.subscribe(`xpav/${roomCode}/#`);
      
      if (localStreamsRef.current.audio || localStreamsRef.current.video) {
        setTimeout(() => {
          broadcastJoin();
          peersRef.current.forEach((peer, peerId) => {
            if (!peer.connected) {
              reconnectPeer(peerId);
            }
          });
        }, 500);
      }
      
      // Setup intervals
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        broadcastPing();
      }, 5000);
      
      if (healthCheckIntervalRef.current) clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = setInterval(() => {
        checkConnectionHealth();
      }, 8000);

      if (qualityMonitorRef.current) clearInterval(qualityMonitorRef.current);
      qualityMonitorRef.current = setInterval(() => {
        peersRef.current.forEach((peer, peerId) => {
          if (peer.connected) {
            monitorConnectionQuality(peerId);
          }
        });
      }, 15000);

      // Connection recovery interval - checks overall connection health
      if (connectionRecoveryIntervalRef.current) clearInterval(connectionRecoveryIntervalRef.current);
      connectionRecoveryIntervalRef.current = setInterval(() => {
        performConnectionRecovery();
      }, 10000);
    });

    client.on('disconnect', () => {
      console.log('AV MQTT disconnected');
      setConnectionState('disconnected');
      setIsReconnecting(true);
      if (!isReconnectingRef.current) {
        attemptMqttReconnect();
      }
    });

    client.on('error', (err) => {
      console.error('AV MQTT error:', err);
      setConnectionState('failed');
    });

    client.on('reconnect', () => {
      console.log('AV MQTT reconnecting...');
      setConnectionState('reconnecting');
      setIsReconnecting(true);
    });

    client.on('offline', () => {
      console.log('AV MQTT offline');
      setConnectionState('disconnected');
      if (!isReconnectingRef.current) {
        attemptMqttReconnect();
      }
    });

    setupClientHandlers(client);

    return () => {
      wasConnectedRef.current = false;
      cleanup();
      client.end();
    };
  }, [isActive, roomCode, attemptMqttReconnect, monitorConnectionQuality]);

  // Connection recovery - comprehensive health check
  const performConnectionRecovery = () => {
    const now = Date.now();
    const timeSinceLastPing = now - lastPingReceivedRef.current;
    
    // Check if MQTT is connected
    if (!clientRef.current?.connected) {
      console.log('Connection recovery: MQTT not connected');
      if (!isReconnectingRef.current) {
        attemptMqttReconnect();
      }
      return;
    }

    // Check heartbeat
    if (timeSinceLastPing > 20000) {
      heartbeatMissedCountRef.current++;
      console.log('Heartbeat missed:', heartbeatMissedCountRef.current);
      
      if (heartbeatMissedCountRef.current > 3) {
        console.log('Too many missed heartbeats - forcing reconnect');
        if (!isReconnectingRef.current) {
          attemptMqttReconnect();
        }
      }
    } else {
      heartbeatMissedCountRef.current = 0;
    }

    // Check peer connections
    peersRef.current.forEach((peer, peerId) => {
      const pc = peer.connection;
      
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log('Connection recovery: Peer connection failed for', peerId);
        pendingReconnectPeersRef.current.add(peerId);
      }
      
      if (pc.iceConnectionState === 'failed') {
        console.log('Connection recovery: ICE failed for', peerId);
        const lastRestart = lastIceRestartRef.current.get(peerId) || 0;
        if (now - lastRestart > 15000) {
          lastIceRestartRef.current.set(peerId, now);
          try {
            pc.restartIce();
          } catch (e) {
            pendingReconnectPeersRef.current.add(peerId);
          }
        }
      }
    });

    // Process any pending reconnects
    if (pendingReconnectPeersRef.current.size > 0) {
      processPendingPeerReconnects();
    }
  };

  const broadcastPing = () => {
    if (!clientRef.current?.connected) return;
    
    lastPingReceivedRef.current = Date.now();
    
    clientRef.current.publish(
      `xpav/${roomCode}/ping`,
      JSON.stringify({
        type: 'av-ping',
        from: myIdRef.current,
        timestamp: Date.now(),
        quality: connectionQuality,
        hasAudio: !!localStreamsRef.current.audio,
        hasVideo: !!localStreamsRef.current.video,
      })
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
      })
    );
  };

  const handlePing = (from: string) => {
    lastPingReceivedRef.current = Date.now();
    
    const peer = peersRef.current.get(from);
    if (peer) {
      peer.lastPing = Date.now();
      peersRef.current.set(from, peer);
      
      if (!peer.connected && (localStreamsRef.current.audio || localStreamsRef.current.video)) {
        const stable = stableConnectionRef.current.get(from);
        if (!stable) {
          stableConnectionRef.current.set(from, true);
        } else {
          setTimeout(() => reconnectPeer(from), 500);
        }
      }
    }
  };

  const handlePeerLeave = (from: string) => {
    console.log('Peer left AV:', from);
    const peer = peersRef.current.get(from);
    if (peer) {
      cleanupPeer(peer);
      peersRef.current.delete(from);
      setPeers(new Map(peersRef.current));
      reconnectAttemptsRef.current.delete(from);
      makingOfferRef.current.delete(from);
      stableConnectionRef.current.delete(from);
      lastIceRestartRef.current.delete(from);
    }
  };

  const cleanupPeer = (peer: AVPeer) => {
    try {
      if (peer.statsInterval) clearInterval(peer.statsInterval);
      if (peer.iceReconnectTimeout) clearTimeout(peer.iceReconnectTimeout);
      peer.connection.close();
    } catch (e) {}
    const audioEl = document.getElementById(`av-audio-${peer.id}`);
    if (audioEl) audioEl.remove();
  };

  const checkConnectionHealth = () => {
    const now = Date.now();
    let needsUpdate = false;
    
    peersRef.current.forEach((peer, peerId) => {
      const timeout = peer.connected ? 45000 : 30000;
      
      if (now - peer.lastPing > timeout) {
        console.log('Peer stale, marking disconnected:', peerId);
        peer.connected = false;
        peersRef.current.set(peerId, peer);
        needsUpdate = true;
        stableConnectionRef.current.delete(peerId);
        
        const attempts = reconnectAttemptsRef.current.get(peerId) || 0;
        if (attempts < 10 && (localStreamsRef.current.audio || localStreamsRef.current.video)) {
          pendingReconnectPeersRef.current.add(peerId);
        }
      }
      
      const pc = peer.connection;
      if (pc) {
        const lastRestart = lastIceRestartRef.current.get(peerId) || 0;
        const canRestart = now - lastRestart > 15000;
        
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          console.log('Connection failed for:', peerId);
          peer.connected = false;
          peersRef.current.set(peerId, peer);
          needsUpdate = true;
          pendingReconnectPeersRef.current.add(peerId);
        }
        
        if (pc.iceConnectionState === 'failed' && canRestart) {
          console.log('ICE failed for:', peerId, '- restarting ICE');
          lastIceRestartRef.current.set(peerId, now);
          try {
            pc.restartIce();
          } catch (e) {
            pendingReconnectPeersRef.current.add(peerId);
          }
        }
      }
    });
    
    if (needsUpdate) {
      setPeers(new Map(peersRef.current));
    }
    
    // Process pending reconnects
    if (pendingReconnectPeersRef.current.size > 0) {
      processPendingPeerReconnects();
    }
  };

  const reconnectPeer = (peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    
    const attempts = reconnectAttemptsRef.current.get(peerId) || 0;
    if (attempts > 10) {
      console.log('Max reconnection attempts reached for:', peerId);
      // Reset and try again after longer delay
      setTimeout(() => {
        reconnectAttemptsRef.current.set(peerId, 0);
        reconnectPeer(peerId);
      }, 60000);
      return;
    }
    
    reconnectAttemptsRef.current.set(peerId, attempts + 1);
    makingOfferRef.current.delete(peerId);
    stableConnectionRef.current.delete(peerId);
    
    cleanupPeer(peer);
    
    peersRef.current.delete(peerId);
    setPeers(new Map(peersRef.current));
    
    const delay = getReconnectDelay(attempts);
    console.log(`Reconnecting to peer ${peerId} in ${delay}ms (attempt ${attempts + 1})`);
    
    setTimeout(() => {
      if ((localStreamsRef.current.audio || localStreamsRef.current.video) && clientRef.current?.connected) {
        initiateConnection(peerId, peer.username);
      } else {
        // Re-queue if not ready
        pendingReconnectPeersRef.current.add(peerId);
      }
    }, delay);
  };

  const handleReconnectRequest = async (from: string, username: string) => {
    console.log('Received reconnect request from:', from);
    handlePeerLeave(from);
    
    if ((localStreamsRef.current.audio || localStreamsRef.current.video) && clientRef.current?.connected) {
      await createPeerConnection(from, username, true);
    }
  };

  const initiateConnection = (peerId: string, peerUsername: string) => {
    if (makingOfferRef.current.has(peerId)) {
      console.log('Already making offer to', peerId, '- skipping');
      return;
    }
    if (!clientRef.current?.connected) {
      console.log('MQTT not connected, queueing peer reconnect');
      pendingReconnectPeersRef.current.add(peerId);
      return;
    }
    createPeerConnection(peerId, peerUsername, true);
  };

  const createPeerConnection = async (peerId: string, peerUsername: string, isInitiator: boolean): Promise<RTCPeerConnection | null> => {
    console.log('Creating AV peer:', peerId, 'initiator:', isInitiator);
    
    const existing = peersRef.current.get(peerId);
    if (existing) {
      cleanupPeer(existing);
      peersRef.current.delete(peerId);
      makingOfferRef.current.delete(peerId);
    }

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);

      if (localStreamsRef.current.audio) {
        localStreamsRef.current.audio.getAudioTracks().forEach(track => {
          const sender = pc.addTrack(track, localStreamsRef.current.audio!);
          applyBitrateConstraint(sender, 'audio', currentQualityRef.current);
        });
      }

      if (localStreamsRef.current.video) {
        localStreamsRef.current.video.getVideoTracks().forEach(track => {
          const sender = pc.addTrack(track, localStreamsRef.current.video!);
          applyBitrateConstraint(sender, 'video', currentQualityRef.current);
        });
      }

      pc.onnegotiationneeded = async () => {
        try {
          if (makingOfferRef.current.has(peerId)) return;
          await new Promise(r => setTimeout(r, Math.random() * 200));
          if (makingOfferRef.current.has(peerId)) return;
          
          makingOfferRef.current.add(peerId);
          const offer = await pc.createOffer();
          
          if (pc.signalingState !== 'stable') {
            makingOfferRef.current.delete(peerId);
            return;
          }
          
          await pc.setLocalDescription(offer);
          await waitForIceGathering(pc, 4000);
          
          const finalOffer = pc.localDescription;
          if (finalOffer && clientRef.current?.connected) {
            clientRef.current.publish(
              `xpav/${roomCode}/offer`,
              JSON.stringify({
                type: 'av-offer',
                from: myIdRef.current,
                to: peerId,
                offer: finalOffer,
                username: localUsername,
                quality: currentQualityRef.current,
              })
            );
          }
        } catch (err) {
          console.error('Renegotiation error:', err);
        } finally {
          makingOfferRef.current.delete(peerId);
        }
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
            })
          );
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('ICE state for', peerId, ':', pc.iceConnectionState);
        const now = Date.now();
        const lastRestart = lastIceRestartRef.current.get(peerId) || 0;
        
        if (pc.iceConnectionState === 'failed' && now - lastRestart > 15000) {
          console.log('ICE failed for', peerId, '- restarting ICE');
          lastIceRestartRef.current.set(peerId, now);
          try {
            pc.restartIce();
          } catch (e) {
            reconnectPeer(peerId);
          }
        } else if (pc.iceConnectionState === 'disconnected') {
          console.log('ICE disconnected for', peerId);
          const timeout = setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
              reconnectPeer(peerId);
            }
          }, 8000);
          peer.iceReconnectTimeout = timeout as any;
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          if (peer.iceReconnectTimeout) {
            clearTimeout(peer.iceReconnectTimeout);
            peer.iceReconnectTimeout = undefined;
          }
          lastIceRestartRef.current.delete(peerId);
        }
      };

      pc.ontrack = (event) => {
        console.log('Received track from:', peerId, 'kind:', event.track.kind);
        const [stream] = event.streams;
        const peer = peersRef.current.get(peerId);
        
        if (peer) {
          if (event.track.kind === 'audio') {
            peer.audioStream = stream;
            playAudio(peerId, stream);
          } else if (event.track.kind === 'video') {
            peer.videoStream = stream;
          }
          peer.connected = true;
          peer.lastPing = Date.now();
          peersRef.current.set(peerId, peer);
          setPeers(new Map(peersRef.current));
          
          reconnectAttemptsRef.current.set(peerId, 0);
          stableConnectionRef.current.set(peerId, true);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('Connection state for', peerId, ':', pc.connectionState);
        const peer = peersRef.current.get(peerId);
        
        if (peer) {
          if (pc.connectionState === 'connected') {
            peer.connected = true;
            peer.lastPing = Date.now();
            reconnectAttemptsRef.current.set(peerId, 0);
            stableConnectionRef.current.set(peerId, true);
            
            if (peer.statsInterval) clearInterval(peer.statsInterval);
            peer.statsInterval = setInterval(() => {
              monitorConnectionQuality(peerId);
            }, 10000);
            
          } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            peer.connected = false;
            if (peer.statsInterval) clearInterval(peer.statsInterval);
            
            if (pc.connectionState === 'failed') {
              setTimeout(() => reconnectPeer(peerId), 1000);
            }
          }
          
          peersRef.current.set(peerId, peer);
          setPeers(new Map(peersRef.current));
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
      };
      peersRef.current.set(peerId, peer);
      setPeers(new Map(peersRef.current));

      if (isInitiator) {
        try {
          makingOfferRef.current.add(peerId);
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);
          
          await waitForIceGathering(pc, 5000);
          
          const finalOffer = pc.localDescription;
          if (finalOffer && clientRef.current?.connected) {
            clientRef.current.publish(
              `xpav/${roomCode}/offer`,
              JSON.stringify({
                type: 'av-offer',
                from: myIdRef.current,
                to: peerId,
                offer: finalOffer,
                username: localUsername,
                quality: currentQualityRef.current,
              })
            );
            console.log('Sent offer to:', peerId);
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

  const applyBitrateConstraint = (sender: RTCRtpSender, kind: 'audio' | 'video', quality?: QualityLevel) => {
    const params = sender.getParameters();
    const targetQuality = quality || currentQualityRef.current;
    if (params.encodings && params.encodings[0]) {
      if (kind === 'audio') {
        params.encodings[0].maxBitrate = getAudioBitrate(targetQuality);
        params.encodings[0].priority = 'high';
      } else {
        params.encodings[0].maxBitrate = getVideoBitrate(targetQuality);
        params.encodings[0].priority = 'medium';
      }
      sender.setParameters(params).catch(console.error);
    }
  };

  const waitForIceGathering = (pc: RTCPeerConnection, timeout: number): Promise<void> => {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      
      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        }
      };
      
      pc.addEventListener('icegatheringstatechange', checkState);
      setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, timeout);
    });
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit, from: string, username: string) => {
    console.log('Received offer from:', from);
    
    if (!localStreamsRef.current.audio && !localStreamsRef.current.video) {
      console.log('No local streams, ignoring offer');
      return;
    }

    const existing = peersRef.current.get(from);
    
    if (existing && makingOfferRef.current.has(from)) {
      if (myIdRef.current < from) {
        console.log('Glare detected, my ID is lower. Ignoring offer.');
        return;
      } else {
        console.log('Glare detected, my ID is higher. Switching to answerer.');
        makingOfferRef.current.delete(from);
        cleanupPeer(existing);
        peersRef.current.delete(from);
      }
    }

    const pc = await createPeerConnection(from, username, false);
    if (!pc) return;
    
    const peer = peersRef.current.get(from);
    if (peer) {
      peer.isSettingRemoteDesc = true;
    }
    
    try {
      await pc.setRemoteDescription(offer);
      
      if (peer && peer.iceBuffer.length > 0) {
        for (const candidate of peer.iceBuffer) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (e) {
            console.error('Buffered ICE error:', e);
          }
        }
        peer.iceBuffer = [];
      }
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      await waitForIceGathering(pc, 5000);
      
      const finalAnswer = pc.localDescription;
      if (finalAnswer && clientRef.current?.connected) {
        clientRef.current.publish(
          `xpav/${roomCode}/answer`,
          JSON.stringify({
            type: 'av-answer',
            from: myIdRef.current,
            to: from,
            answer: finalAnswer,
            quality: currentQualityRef.current,
          })
        );
        console.log('Sent answer to:', from);
      }
    } catch (err) {
      console.error('Answer error:', err);
    } finally {
      if (peer) {
        peer.isSettingRemoteDesc = false;
      }
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit, from: string) => {
    console.log('Received answer from:', from);
    makingOfferRef.current.delete(from);
    const peer = peersRef.current.get(from);
    if (peer) {
      try {
        await peer.connection.setRemoteDescription(answer);
        console.log('Set remote description for:', from);
        
        if (peer.iceBuffer.length > 0) {
          for (const candidate of peer.iceBuffer) {
            try {
              await peer.connection.addIceCandidate(candidate);
            } catch (e) {
              console.error('Buffered ICE error:', e);
            }
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

  const playAudio = (peerId: string, stream: MediaStream) => {
    const existing = document.getElementById(`av-audio-${peerId}`);
    if (existing) existing.remove();
    
    const audio = document.createElement('audio');
    audio.id = `av-audio-${peerId}`;
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.volume = 1.0;
    audio.muted = false;
    
    const tryPlay = () => {
      audio.play().catch(err => {
        console.log('Audio play failed, will retry on interaction:', err);
      });
    };
    
    tryPlay();
    
    const interactionHandler = () => {
      tryPlay();
      document.removeEventListener('click', interactionHandler);
      document.removeEventListener('touchstart', interactionHandler);
    };
    
    document.addEventListener('click', interactionHandler, { once: true });
    document.addEventListener('touchstart', interactionHandler, { once: true });
    
    document.body.appendChild(audio);
    console.log('Playing audio from:', peerId);
  };

  const enableAudio = async (targetQuality?: QualityLevel): Promise<boolean> => {
    try {
      setError(null);
      const quality = targetQuality || currentQualityRef.current;
      console.log('Enabling audio with quality:', quality);
      
      if (localStreamsRef.current.audio) {
        localStreamsRef.current.audio.getTracks().forEach(t => {
          t.stop();
          peersRef.current.forEach((peer) => {
            const senders = peer.connection.getSenders();
            senders.forEach(sender => {
              if (sender.track && sender.track.kind === 'audio') {
                try {
                  peer.connection.removeTrack(sender);
                } catch (e) {}
              }
            });
          });
        });
        localStreamsRef.current.audio = null;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: getAudioConstraints(quality),
        video: false,
      });
      
      localStreamsRef.current.audio = stream;
      setIsAudioEnabled(true);
      
      peersRef.current.forEach((peer) => {
        stream.getTracks().forEach(track => {
          const sender = peer.connection.addTrack(track, stream);
          applyBitrateConstraint(sender, 'audio', quality);
        });
      });
      
      broadcastJoin();
      
      return true;
    } catch (err) {
      console.error('Audio error:', err);
      setError('Microphone access denied');
      setIsAudioEnabled(false);
      return false;
    }
  };

  const enableVideo = async (targetQuality?: QualityLevel): Promise<boolean> => {
    try {
      setError(null);
      const quality = targetQuality || currentQualityRef.current;
      console.log('Enabling video with quality:', quality);
      
      if (localStreamsRef.current.video) {
        localStreamsRef.current.video.getTracks().forEach(t => {
          t.stop();
          peersRef.current.forEach((peer) => {
            const senders = peer.connection.getSenders();
            senders.forEach(sender => {
              if (sender.track && sender.track.kind === 'video') {
                try {
                  peer.connection.removeTrack(sender);
                } catch (e) {}
              }
            });
          });
        });
        localStreamsRef.current.video = null;
        setLocalVideoStream(null);
      }
      
      if (quality === 'audio-only') {
        setIsVideoEnabled(false);
        return true;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: getVideoConstraints(quality, isMobileRef.current),
      });
      
      localStreamsRef.current.video = stream;
      setLocalVideoStream(stream);
      setIsVideoEnabled(true);
      
      peersRef.current.forEach((peer) => {
        stream.getTracks().forEach(track => {
          const sender = peer.connection.addTrack(track, stream);
          applyBitrateConstraint(sender, 'video', quality);
        });
      });
      
      broadcastJoin();
      
      return true;
    } catch (err) {
      console.error('Video error:', err);
      setError('Camera access denied');
      setIsVideoEnabled(false);
      return false;
    }
  };

  const broadcastJoin = () => {
    if (clientRef.current?.connected) {
      clientRef.current.publish(
        `xpav/${roomCode}/join`,
        JSON.stringify({
          type: 'av-join',
          from: myIdRef.current,
          username: localUsername,
          quality: currentQualityRef.current,
        })
      );
    }
  };

  const disableAudio = () => {
    console.log('Disabling audio...');
    
    if (localStreamsRef.current.audio) {
      localStreamsRef.current.audio.getTracks().forEach(t => t.stop());
      localStreamsRef.current.audio = null;
    }
    setIsAudioEnabled(false);
    broadcastLeave();
  };

  const disableVideo = () => {
    console.log('Disabling video...');
    
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
    if (qualityChangeTimeoutRef.current) {
      clearTimeout(qualityChangeTimeoutRef.current);
    }
    
    qualityChangeTimeoutRef.current = setTimeout(() => {
      currentQualityRef.current = quality;
      setConnectionQuality(quality);
      
      if (clientRef.current?.connected) {
        clientRef.current.publish(
          `xpav/${roomCode}/quality`,
          JSON.stringify({
            type: 'av-quality-change',
            from: myIdRef.current,
            quality: quality,
          })
        );
      }
      
      if (isAudioEnabled) {
        enableAudio(quality);
      }
      if (isVideoEnabled) {
        enableVideo(quality);
      }
    }, 300);
  };

  const cleanup = () => {
    console.log('Cleaning up AV...');
    
    wasConnectedRef.current = false;
    broadcastLeave();
    
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    if (healthCheckIntervalRef.current) clearInterval(healthCheckIntervalRef.current);
    if (qualityMonitorRef.current) clearInterval(qualityMonitorRef.current);
    if (qualityChangeTimeoutRef.current) clearTimeout(qualityChangeTimeoutRef.current);
    if (mqttReconnectTimeoutRef.current) clearTimeout(mqttReconnectTimeoutRef.current);
    if (connectionRecoveryIntervalRef.current) clearInterval(connectionRecoveryIntervalRef.current);
    
    disableAudio();
    disableVideo();
    
    peersRef.current.forEach((peer) => {
      cleanupPeer(peer);
    });
    peersRef.current.clear();
    setPeers(new Map());
    makingOfferRef.current.clear();
    stableConnectionRef.current.clear();
    lastIceRestartRef.current.clear();
    pendingReconnectPeersRef.current.clear();
    currentQualityRef.current = 'medium';
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
    toggleAudio,
    toggleVideo,
    setQuality,
  };
}
