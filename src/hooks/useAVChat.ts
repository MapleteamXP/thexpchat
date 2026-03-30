import { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

interface AVPeer {
  id: string;
  connection: RTCPeerConnection;
  audioStream?: MediaStream;
  videoStream?: MediaStream;
  username: string;
}

interface LocalStreams {
  audio: MediaStream | null;
  video: MediaStream | null;
}

// Optimized RTC config for low latency
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

export function useAVChat(roomCode: string, localUsername: string, isActive: boolean) {
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [peers, setPeers] = useState<Map<string, AVPeer>>(new Map());
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const localStreamsRef = useRef<LocalStreams>({ audio: null, video: null });
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const myIdRef = useRef<string>(`av-${Math.random().toString(36).substr(2, 9)}`);
  const peersRef = useRef<Map<string, AVPeer>>(new Map());

  // Connect to MQTT for AV signaling
  useEffect(() => {
    if (!isActive || !roomCode) return;

    const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
      clientId: myIdRef.current,
      clean: true,
      connectTimeout: 15000,
      reconnectPeriod: 3000,
    });
    
    clientRef.current = client;

    client.on('connect', () => {
      console.log('AV MQTT connected');
      client.subscribe(`xpav/${roomCode}/#`);
    });

    client.on('message', async (_topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        if (data.from === myIdRef.current) return;

        switch (data.type) {
          case 'av-join':
            if (localStreamsRef.current.audio || localStreamsRef.current.video) {
              await createPeerConnection(data.from, data.username, true);
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
        }
      } catch (e) {
        console.error('AV message error:', e);
      }
    });

    return () => {
      cleanup();
      client.end();
    };
  }, [isActive, roomCode]);

  const publish = (type: string, data: any) => {
    const client = clientRef.current;
    if (!client?.connected) return;
    
    client.publish(
      `xpav/${roomCode}/${type}`,
      JSON.stringify({
        type,
        from: myIdRef.current,
        ...data,
        timestamp: Date.now(),
      })
    );
  };

  const createPeerConnection = async (peerId: string, peerUsername: string, isInitiator: boolean): Promise<RTCPeerConnection> => {
    console.log('Creating AV peer:', peerId, 'initiator:', isInitiator);
    
    // Close existing
    const existing = peersRef.current.get(peerId);
    if (existing) {
      existing.connection.close();
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);

    // Add audio tracks with 384kbps constraint
    if (localStreamsRef.current.audio) {
      localStreamsRef.current.audio.getAudioTracks().forEach(track => {
        // Apply bitrate constraint
        const sender = pc.addTrack(track, localStreamsRef.current.audio!);
        const params = sender.getParameters();
        if (params.encodings && params.encodings[0]) {
          params.encodings[0].maxBitrate = 384000; // 384 kbps
        }
      });
    }

    // Add video tracks
    if (localStreamsRef.current.video) {
      localStreamsRef.current.video.getVideoTracks().forEach(track => {
        pc.addTrack(track, localStreamsRef.current.video!);
      });
    }

    // ICE handling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        publish('av-ice', { to: peerId, candidate: event.candidate });
      }
    };

    // Handle remote streams
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      const peer = peersRef.current.get(peerId);
      
      if (peer) {
        if (event.track.kind === 'audio') {
          peer.audioStream = stream;
          playAudio(peerId, stream);
        } else if (event.track.kind === 'video') {
          peer.videoStream = stream;
        }
        peersRef.current.set(peerId, peer);
        setPeers(new Map(peersRef.current));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('AV state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        const peer = peersRef.current.get(peerId);
        if (peer) {
          // Already handled in ontrack
        }
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        peersRef.current.delete(peerId);
        setPeers(new Map(peersRef.current));
      }
    };

    const peer: AVPeer = { 
      id: peerId, 
      connection: pc,
      username: peerUsername,
    };
    peersRef.current.set(peerId, peer);
    setPeers(new Map(peersRef.current));

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        publish('av-offer', { to: peerId, offer, username: localUsername });
      } catch (err) {
        console.error('Offer error:', err);
      }
    }

    return pc;
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit, from: string, username: string) => {
    if (!localStreamsRef.current.audio && !localStreamsRef.current.video) return;
    
    const pc = await createPeerConnection(from, username, false);
    
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      publish('av-answer', { to: from, answer });
    } catch (err) {
      console.error('Answer error:', err);
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit, from: string) => {
    const peer = peersRef.current.get(from);
    if (peer) {
      try {
        await peer.connection.setRemoteDescription(answer);
      } catch (err) {
        console.error('Set remote desc error:', err);
      }
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidateInit, from: string) => {
    const peer = peersRef.current.get(from);
    if (peer) {
      try {
        await peer.connection.addIceCandidate(candidate);
      } catch (err) {
        console.error('ICE error:', err);
      }
    }
  };

  const playAudio = (peerId: string, stream: MediaStream) => {
    // Remove existing audio element
    const existing = document.getElementById(`av-audio-${peerId}`);
    if (existing) existing.remove();
    
    const audio = document.createElement('audio');
    audio.id = `av-audio-${peerId}`;
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.volume = 1.0;
    document.body.appendChild(audio);
  };

  // Enable audio (384kbps optimized)
  const enableAudio = async (): Promise<boolean> => {
    try {
      setError(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2,
        },
        video: false,
      });
      
      localStreamsRef.current.audio = stream;
      setIsAudioEnabled(true);
      
      // Announce and connect to existing peers
      publish('av-join', { username: localUsername });
      
      return true;
    } catch (err) {
      console.error('Audio error:', err);
      setError('Microphone access denied');
      return false;
    }
  };

  // Enable video
  const enableVideo = async (): Promise<boolean> => {
    try {
      setError(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        },
      });
      
      localStreamsRef.current.video = stream;
      setLocalVideoStream(stream);
      setIsVideoEnabled(true);
      
      // Announce and connect
      publish('av-join', { username: localUsername });
      
      return true;
    } catch (err) {
      console.error('Video error:', err);
      setError('Camera access denied');
      return false;
    }
  };

  // Disable audio
  const disableAudio = () => {
    if (localStreamsRef.current.audio) {
      localStreamsRef.current.audio.getTracks().forEach(t => t.stop());
      localStreamsRef.current.audio = null;
    }
    setIsAudioEnabled(false);
  };

  // Disable video
  const disableVideo = () => {
    if (localStreamsRef.current.video) {
      localStreamsRef.current.video.getTracks().forEach(t => t.stop());
      localStreamsRef.current.video = null;
    }
    setLocalVideoStream(null);
    setIsVideoEnabled(false);
  };

  // Toggle audio
  const toggleAudio = async (): Promise<boolean> => {
    if (isAudioEnabled) {
      disableAudio();
      return false;
    }
    return await enableAudio();
  };

  // Toggle video
  const toggleVideo = async (): Promise<boolean> => {
    if (isVideoEnabled) {
      disableVideo();
      return false;
    }
    return await enableVideo();
  };

  // Cleanup
  const cleanup = () => {
    disableAudio();
    disableVideo();
    
    peersRef.current.forEach((peer) => {
      peer.connection.close();
      const audio = document.getElementById(`av-audio-${peer.id}`);
      if (audio) audio.remove();
    });
    peersRef.current.clear();
    setPeers(new Map());
  };

  return {
    isAudioEnabled,
    isVideoEnabled,
    localVideoStream,
    peers,
    error,
    toggleAudio,
    toggleVideo,
  };
}
