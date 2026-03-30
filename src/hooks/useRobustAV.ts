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

// Enhanced RTC config - OPTIMIZED for fast connection
// Using trickle ICE for faster establishment
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    // Google's public STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Open Relay - FAST and reliable
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
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    // Twilio's TURN servers (backup)
    {
      urls: 'turn:global.turn.twilio.com:3478?transport=udp',
      username: 'f4b4035eaa76b7a9f187e111a2615b4392f14d4c82c7eb60e47d9a46d95a8519',
      credential: 'WKg7oO/acUNOXqhkC4gkU9Gl1Z6K3w3/S6NhvCyShvI=',
    },
  ],
  bundlePolicy: 'max-bundle' as RTCBundlePolicy,
  rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy,
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 10, // Pre-gather candidates for faster connections
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const connectionStatsRef = useRef<Map<string, any>>(new Map());
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
  const connectionRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
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
      }, 3000); // More frequent pings (every 3 seconds)
      
      if (healthCheckIntervalRef.current) clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = setInterval(() => {
        checkConnectionHealth();
      }, 5000); // Check health every 5 seconds

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
      }, 5000); // Check every 5 seconds for faster recovery

      // Connection refresh interval - keeps connections alive every 30 seconds
      if (connectionRefreshIntervalRef.current) clearInterval(connectionRefreshIntervalRef.current);
      connectionRefreshIntervalRef.current = setInterval(() => {
        peersRef.current.forEach((peer, peerId) => {
          if (peer.connected) {
            sendConnectionRefresh(peerId);
          }
        });
      }, 30000);
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

    // Check heartbeat - SHORTER timeout (12 seconds)
    if (timeSinceLastPing > 12000) {
      heartbeatMissedCountRef.current++;
      console.log('💓 Heartbeat missed:', heartbeatMissedCountRef.current);
      
      if (heartbeatMissedCountRef.current > 2) {
        console.log('❌ Too many missed heartbeats - forcing reconnect');
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

  // Send connection refresh to keep ICE alive
  const sendConnectionRefresh = (peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer || !clientRef.current?.connected) return;
    
    // Send a new offer to refresh the connection
    if (peer.connection.connectionState === 'connected') {
      peer.connection.createOffer({ iceRestart: true })
        .then(offer => peer.connection.setLocalDescription(offer))
        .then(() => {
          clientRef.current?.publish(
            `xpav/${roomCode}/offer`,
            JSON.stringify({
              type: 'av-offer',
              from: myIdRef.current,
              to: peerId,
              offer: peer.connection.localDescription,
              username: localUsername,
              quality: currentQualityRef.current,
            })
          );
          console.log('🔄 Sent connection refresh to:', peerId);
        })
        .catch(err => console.error('Connection refresh failed:', err));
    }
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
      // SHORTER timeouts for faster detection of issues
      const timeout = peer.connected ? 20000 : 15000; // 20s for connected, 15s for connecting
      
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

      // Add local audio tracks if available
      if (localStreamsRef.current.audio) {
        localStreamsRef.current.audio.getAudioTracks().forEach(track => {
          const sender = pc.addTrack(track, localStreamsRef.current.audio!);
          applyBitrateConstraint(sender, 'audio', currentQualityRef.current);
        });
      }

      // Add local video tracks if available
      if (localStreamsRef.current.video) {
        localStreamsRef.current.video.getVideoTracks().forEach(track => {
          const sender = pc.addTrack(track, localStreamsRef.current.video!);
          applyBitrateConstraint(sender, 'video', currentQualityRef.current);
        });
      }

      // IMPORTANT: Add transceivers to receive audio/video from remote peer
      // This ensures we can receive even if we don't send
      const senders = pc.getSenders();
      const hasAudioSender = senders.some(s => s.track?.kind === 'audio');
      const hasVideoSender = senders.some(s => s.track?.kind === 'video');

      if (!hasAudioSender) {
        // Add recvonly transceiver for audio to receive remote audio
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }
      if (!hasVideoSender) {
        // Add recvonly transceiver for video to receive remote video
        pc.addTransceiver('video', { direction: 'recvonly' });
      }

      // TRICKLE ICE: Send offer immediately, candidates separately
      pc.onnegotiationneeded = async () => {
        try {
          if (makingOfferRef.current.has(peerId)) return;
          await new Promise(r => setTimeout(r, Math.random() * 100));
          if (makingOfferRef.current.has(peerId)) return;
          
          makingOfferRef.current.add(peerId);
          const offer = await pc.createOffer();
          
          if (pc.signalingState !== 'stable') {
            makingOfferRef.current.delete(peerId);
            return;
          }
          
          await pc.setLocalDescription(offer);
          
          // TRICKLE ICE: Send offer immediately without waiting for ICE gathering
          // Candidates will be sent via onicecandidate as they arrive
          const offerToSend = pc.localDescription;
          if (offerToSend && clientRef.current?.connected) {
            clientRef.current.publish(
              `xpav/${roomCode}/offer`,
              JSON.stringify({
                type: 'av-offer',
                from: myIdRef.current,
                to: peerId,
                offer: offerToSend,
                username: localUsername,
                quality: currentQualityRef.current,
              })
            );
            console.log('📤 Sent offer (trickle ICE) to:', peerId);
          }
        } catch (err) {
          console.error('Renegotiation error:', err);
        } finally {
          makingOfferRef.current.delete(peerId);
        }
      };

      // TRICKLE ICE: Send candidates immediately as they arrive
      pc.onicecandidate = (event) => {
        if (event.candidate && clientRef.current?.connected) {
          console.log('📤 Sending ICE candidate to:', peerId, event.candidate.type);
          clientRef.current.publish(
            `xpav/${roomCode}/ice`,
            JSON.stringify({
              type: 'av-ice',
              from: myIdRef.current,
              to: peerId,
              candidate: event.candidate,
            })
          );
        } else if (!event.candidate) {
          console.log('✅ ICE gathering complete for:', peerId);
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
        console.log('Received track from:', peerId, 'kind:', event.track.kind, 'streams:', event.streams.length);
        
        // Get or create a stream for this peer
        const peer = peersRef.current.get(peerId);
        if (!peer) return;
        
        // Use the provided stream or create one from the track
        let stream: MediaStream;
        if (event.streams && event.streams[0]) {
          stream = event.streams[0];
        } else {
          // Create a new stream if none provided (older browsers)
          stream = new MediaStream([event.track]);
        }
        
        if (event.track.kind === 'audio') {
          console.log('Setting up audio for peer:', peerId);
          peer.audioStream = stream;
          // Delay slightly to ensure DOM is ready
          setTimeout(() => playAudio(peerId, stream), 100);
        } else if (event.track.kind === 'video') {
          console.log('Setting up video for peer:', peerId);
          peer.videoStream = stream;
        }
        
        peer.connected = true;
        peer.lastPing = Date.now();
        peersRef.current.set(peerId, peer);
        setPeers(new Map(peersRef.current));
        
        reconnectAttemptsRef.current.set(peerId, 0);
        stableConnectionRef.current.set(peerId, true);
      };

      // Connection timeout - force reconnect if not connected within 15 seconds
      const connectionTimeout = setTimeout(() => {
        if (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting') {
          console.log('⏱️ Connection timeout for:', peerId, '- forcing reconnect');
          reconnectPeer(peerId);
        }
      }, 15000);

      pc.onconnectionstatechange = () => {
        console.log('Connection state for', peerId, ':', pc.connectionState);
        const peer = peersRef.current.get(peerId);
        
        if (peer) {
          if (pc.connectionState === 'connected') {
            clearTimeout(connectionTimeout);
            peer.connected = true;
            peer.lastPing = Date.now();
            reconnectAttemptsRef.current.set(peerId, 0);
            stableConnectionRef.current.set(peerId, true);
            
            if (peer.statsInterval) clearInterval(peer.statsInterval);
            peer.statsInterval = setInterval(() => {
              monitorConnectionQuality(peerId);
            }, 10000);
            
            console.log('✅ Peer connected:', peerId);
            
          } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            clearTimeout(connectionTimeout);
            peer.connected = false;
            if (peer.statsInterval) clearInterval(peer.statsInterval);
            
            console.log('❌ Peer connection failed/closed:', peerId);
            if (pc.connectionState === 'failed') {
              setTimeout(() => reconnectPeer(peerId), 500);
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
          // TRICKLE ICE: Create and send offer immediately
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          // Send offer immediately - don't wait for ICE gathering
          const offerToSend = pc.localDescription;
          if (offerToSend && clientRef.current?.connected) {
            clientRef.current.publish(
              `xpav/${roomCode}/offer`,
              JSON.stringify({
                type: 'av-offer',
                from: myIdRef.current,
                to: peerId,
                offer: offerToSend,
                username: localUsername,
                quality: currentQualityRef.current,
              })
            );
            console.log('📤 Sent initial offer (trickle ICE) to:', peerId);
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
    
    // Even if we don't have local streams yet, we should accept the offer
    // to be able to receive audio/video from the other peer
    if (!localStreamsRef.current.audio && !localStreamsRef.current.video) {
      console.log('No local streams yet, but accepting offer to receive media from:', from);
      // We still proceed - we'll add transceivers for receiving
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
      console.log('Set remote description for offer from:', from);
      
      // Process buffered ICE candidates
      if (peer && peer.iceBuffer.length > 0) {
        console.log('Processing', peer.iceBuffer.length, 'buffered ICE candidates');
        for (const candidate of peer.iceBuffer) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (e) {
            console.error('Buffered ICE error:', e);
          }
        }
        peer.iceBuffer = [];
      }
      
      // TRICKLE ICE: Create and send answer immediately
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('Created and set local answer for:', from);
      
      // Send answer immediately - don't wait for ICE gathering
      const answerToSend = pc.localDescription;
      if (answerToSend && clientRef.current?.connected) {
        clientRef.current.publish(
          `xpav/${roomCode}/answer`,
          JSON.stringify({
            type: 'av-answer',
            from: myIdRef.current,
            to: from,
            answer: answerToSend,
            quality: currentQualityRef.current,
          })
        );
        console.log('📤 Sent answer (trickle ICE) to:', from);
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

  // Track if audio has been globally unlocked
  const audioUnlockedRef = useRef(false);

  // Unlock audio context - CRITICAL for browsers that block audio
  const unlockAudioContext = async () => {
    try {
      if (!audioContextRef.current) {
        // @ts-ignore - webkitAudioContext for Safari
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          audioContextRef.current = new AudioContextClass();
        }
      }
      
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
        console.log('✅ Audio context resumed successfully');
      }
      
      audioUnlockedRef.current = true;
    } catch (err) {
      console.log('Audio context unlock failed:', err);
    }
  };

  // Global audio unlock - call this on ANY user interaction
  const globalAudioUnlock = async () => {
    if (audioUnlockedRef.current) return;
    
    console.log('🔓 Attempting global audio unlock...');
    await unlockAudioContext();
    
    // Try to unlock all existing audio elements
    document.querySelectorAll('audio').forEach((audio) => {
      if (audio.paused || audio.muted) {
        audio.muted = false;
        audio.play().catch(() => {});
      }
    });
    
    audioUnlockedRef.current = true;
  };

  const playAudio = (peerId: string, stream: MediaStream) => {
    console.log('🔊 Setting up audio playback for peer:', peerId);
    console.log('Stream info:', {
      id: stream.id,
      active: stream.active,
      audioTracks: stream.getAudioTracks().length,
      trackInfo: stream.getAudioTracks().map(t => ({ enabled: t.enabled, muted: t.muted, readyState: t.readyState }))
    });
    
    // Stop any existing audio for this peer
    const existing = document.getElementById(`av-audio-${peerId}`) as HTMLAudioElement;
    if (existing) {
      console.log('Removing existing audio element for peer:', peerId);
      existing.pause();
      existing.srcObject = null;
      existing.remove();
    }
    
    // Create new audio element
    const audio = document.createElement('audio');
    audio.id = `av-audio-${peerId}`;
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.volume = 1.0;
    // IMPORTANT: Start unmuted - browsers allow this if user has already interacted
    audio.muted = false;
    audio.playsInline = true; // Important for iOS
    audio.setAttribute('data-peer-id', peerId);
    audio.style.position = 'fixed';
    audio.style.opacity = '0';
    audio.style.pointerEvents = 'none';
    
    // Add to body first, then play
    document.body.appendChild(audio);
    
    const tryPlay = async (attempt = 1) => {
      try {
        await audio.play();
        console.log('✅ Audio playing successfully from:', peerId);
      } catch (err) {
        console.warn(`⚠️ Audio play failed (attempt ${attempt}):`, err);
        
        if (attempt < 3) {
          // Retry with slight delay
          setTimeout(() => tryPlay(attempt + 1), 500);
        } else {
          console.log('🔇 Audio blocked by autoplay policy - will retry on user interaction');
          // Keep the element but muted until user interacts
          audio.muted = true;
        }
      }
    };
    
    // Try to play immediately
    tryPlay();
    
    // Listen for track events
    stream.getAudioTracks().forEach(track => {
      track.onended = () => {
        console.log('Audio track ended for peer:', peerId);
      };
      track.onmute = () => {
        console.log('Audio track muted for peer:', peerId);
      };
      track.onunmute = () => {
        console.log('Audio track unmuted for peer:', peerId);
        if (audio.paused || audio.muted) {
          audio.muted = false;
          audio.play().catch(console.error);
        }
      };
    });
  };

  const enableAudio = async (targetQuality?: QualityLevel): Promise<boolean> => {
    try {
      setError(null);
      
      // CRITICAL: Unlock audio context first (required by browsers)
      await unlockAudioContext();
      
      const quality = targetQuality || currentQualityRef.current;
      console.log('Enabling audio with quality:', quality);
      
      // Check if we already have permission
      try {
        const permissions = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        console.log('Microphone permission state:', permissions.state);
      } catch (e) {
        // Permission API not supported, continue anyway
      }
      
      // Stop and remove existing audio tracks from all peer connections
      if (localStreamsRef.current.audio) {
        localStreamsRef.current.audio.getTracks().forEach(t => t.stop());
        localStreamsRef.current.audio = null;
      }
      
      // Get new audio stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: getAudioConstraints(quality),
        video: false,
      });
      
      localStreamsRef.current.audio = stream;
      setIsAudioEnabled(true);
      
      // Add tracks to all existing peer connections and renegotiate
      const addPromises = Array.from(peersRef.current.entries()).map(async ([peerId, peer]) => {
        try {
          // Remove existing audio senders first
          const senders = peer.connection.getSenders();
          for (const sender of senders) {
            if (sender.track?.kind === 'audio') {
              try {
                peer.connection.removeTrack(sender);
              } catch (e) {
                console.log('Error removing audio sender:', e);
              }
            }
          }
          
          // Add new audio track
          stream.getAudioTracks().forEach(track => {
            const sender = peer.connection.addTrack(track, stream);
            applyBitrateConstraint(sender, 'audio', quality);
          });
          
          // Trigger renegotiation
          makingOfferRef.current.add(peerId);
          const offer = await peer.connection.createOffer();
          await peer.connection.setLocalDescription(offer);
          await waitForIceGathering(peer.connection, 4000);
          
          const finalOffer = peer.connection.localDescription;
          if (finalOffer && clientRef.current?.connected) {
            clientRef.current.publish(
              `xpav/${roomCode}/offer`,
              JSON.stringify({
                type: 'av-offer',
                from: myIdRef.current,
                to: peerId,
                offer: finalOffer,
                username: localUsername,
                quality: quality,
              })
            );
          }
          makingOfferRef.current.delete(peerId);
        } catch (err) {
          console.error('Error adding audio to peer', peerId, ':', err);
          makingOfferRef.current.delete(peerId);
        }
      });
      
      await Promise.all(addPromises);
      
      // Announce presence to new peers (with slight delay to ensure MQTT ready)
      setTimeout(() => {
        broadcastJoin();
        console.log('📢 Broadcasted audio join');
      }, 500);
      
      return true;
    } catch (err) {
      console.error('❌ Audio error:', err);
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
      
      // Stop and remove existing video tracks
      if (localStreamsRef.current.video) {
        localStreamsRef.current.video.getTracks().forEach(t => t.stop());
        localStreamsRef.current.video = null;
        setLocalVideoStream(null);
      }
      
      if (quality === 'audio-only') {
        setIsVideoEnabled(false);
        return true;
      }
      
      // Get new video stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: getVideoConstraints(quality, isMobileRef.current),
      });
      
      localStreamsRef.current.video = stream;
      setLocalVideoStream(stream);
      setIsVideoEnabled(true);
      
      // Add tracks to all existing peer connections and renegotiate
      const addPromises = Array.from(peersRef.current.entries()).map(async ([peerId, peer]) => {
        try {
          // Remove existing video senders first
          const senders = peer.connection.getSenders();
          for (const sender of senders) {
            if (sender.track?.kind === 'video') {
              try {
                peer.connection.removeTrack(sender);
              } catch (e) {
                console.log('Error removing video sender:', e);
              }
            }
          }
          
          // Add new video track
          stream.getVideoTracks().forEach(track => {
            const sender = peer.connection.addTrack(track, stream);
            applyBitrateConstraint(sender, 'video', quality);
          });
          
          // Trigger renegotiation
          makingOfferRef.current.add(peerId);
          const offer = await peer.connection.createOffer();
          await peer.connection.setLocalDescription(offer);
          await waitForIceGathering(peer.connection, 4000);
          
          const finalOffer = peer.connection.localDescription;
          if (finalOffer && clientRef.current?.connected) {
            clientRef.current.publish(
              `xpav/${roomCode}/offer`,
              JSON.stringify({
                type: 'av-offer',
                from: myIdRef.current,
                to: peerId,
                offer: finalOffer,
                username: localUsername,
                quality: quality,
              })
            );
          }
          makingOfferRef.current.delete(peerId);
        } catch (err) {
          console.error('Error adding video to peer', peerId, ':', err);
          makingOfferRef.current.delete(peerId);
        }
      });
      
      await Promise.all(addPromises);
      
      // Announce presence to new peers (with slight delay to ensure MQTT ready)
      setTimeout(() => {
        broadcastJoin();
        console.log('📢 Broadcasted video join');
      }, 500);
      
      return true;
    } catch (err) {
      console.error('❌ Video error:', err);
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

  // Diagnostic function to help troubleshoot connection issues
  const getDiagnostics = async () => {
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      roomCode,
      localUsername,
      myId: myIdRef.current,
      isAudioEnabled,
      isVideoEnabled,
      connectionState,
      connectionQuality,
      isReconnecting,
      mqttConnected: clientRef.current?.connected || false,
      peers: Array.from(peersRef.current.entries()).map(([id, peer]) => ({
        id,
        username: peer.username,
        connected: peer.connected,
        connectionState: peer.connection.connectionState,
        iceState: peer.connection.iceConnectionState,
        signalingState: peer.connection.signalingState,
        hasAudioStream: !!peer.audioStream,
        hasVideoStream: !!peer.videoStream,
        lastPing: peer.lastPing,
      })),
    };

    // Check for audio elements
    const audioElements = document.querySelectorAll('audio');
    diagnostics.audioElements = Array.from(audioElements).map((el: HTMLAudioElement) => ({
      id: el.id,
      paused: el.paused,
      muted: el.muted,
      volume: el.volume,
      readyState: el.readyState,
      networkState: el.networkState,
      srcObject: el.srcObject ? {
        active: (el.srcObject as MediaStream).active,
        tracks: (el.srcObject as MediaStream).getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
        }))
      } : null,
    }));

    // Get detailed ICE stats for each peer
    for (const [peerId, peer] of peersRef.current.entries()) {
      try {
        const stats = await peer.connection.getStats();
        const peerStats: any = { id: peerId };
        stats.forEach((report: any) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            peerStats.iceCandidatePair = {
              localCandidateId: report.localCandidateId,
              remoteCandidateId: report.remoteCandidateId,
              currentRoundTripTime: report.currentRoundTripTime,
            };
          }
          if (report.type === 'remote-inbound-rtp') {
            peerStats.remoteInbound = {
              kind: report.kind,
              packetsReceived: report.packetsReceived,
              packetsLost: report.packetsLost,
              jitter: report.jitter,
            };
          }
        });
        diagnostics.peerStats = diagnostics.peerStats || [];
        diagnostics.peerStats.push(peerStats);
      } catch (e) {
        console.error('Error getting stats for peer', peerId, ':', e);
      }
    }

    console.log('=== AV DIAGNOSTICS ===', diagnostics);
    return diagnostics;
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
    if (connectionRefreshIntervalRef.current) clearInterval(connectionRefreshIntervalRef.current);
    
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
    getDiagnostics,
    globalAudioUnlock,
  };
}
