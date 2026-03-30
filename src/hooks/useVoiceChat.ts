import { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

interface VoicePeer {
  id: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

export function useVoiceChat(roomCode: string, localUsername: string, isActive: boolean) {
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [peers, setPeers] = useState<Map<string, VoicePeer>>(new Map());
  const [error, setError] = useState<string | null>(null);
  
  const localStreamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const myIdRef = useRef<string>('');
  const peersRef = useRef<Map<string, VoicePeer>>(new Map());

  // Generate unique ID
  useEffect(() => {
    myIdRef.current = `voice-${Math.random().toString(36).substr(2, 8)}`;
  }, []);

  // Connect to MQTT for voice signaling
  useEffect(() => {
    if (!isActive || !roomCode) return;

    const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
      clientId: myIdRef.current,
      clean: true,
      connectTimeout: 10000,
    });
    
    clientRef.current = client;

    client.on('connect', () => {
      console.log('Voice MQTT connected');
      // Subscribe to voice topics for this room
      client.subscribe(`xp-voice/${roomCode}/#`);
    });

    client.on('message', async (_topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        if (data.from === myIdRef.current) return;

        console.log('Voice message:', data.type, 'from:', data.from);

        switch (data.type) {
          case 'voice-join':
            // Someone wants to join voice - create peer connection
            if (localStreamRef.current) {
              await createPeerConnection(data.from, true);
            }
            break;
            
          case 'voice-offer':
            await handleOffer(data.offer, data.from);
            break;
            
          case 'voice-answer':
            await handleAnswer(data.answer, data.from);
            break;
            
          case 'voice-ice':
            await handleIceCandidate(data.candidate, data.from);
            break;
        }
      } catch (err) {
        console.error('Voice message error:', err);
      }
    });

    return () => {
      cleanup();
      client.end();
    };
  }, [isActive, roomCode]);

  // Create peer connection
  const createPeerConnection = async (peerId: string, isInitiator: boolean): Promise<RTCPeerConnection> => {
    console.log('Creating peer connection with:', peerId, 'initiator:', isInitiator);
    
    // Close existing connection if any
    const existing = peersRef.current.get(peerId);
    if (existing) {
      existing.connection.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    });

    // Add local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && clientRef.current?.connected) {
        clientRef.current.publish(
          `xp-voice/${roomCode}/ice`,
          JSON.stringify({
            type: 'voice-ice',
            from: myIdRef.current,
            to: peerId,
            candidate: event.candidate,
          })
        );
      }
    };

    // Handle remote stream - THIS IS WHERE AUDIO COMES IN
    pc.ontrack = (event) => {
      console.log('Received remote track from:', peerId);
      const [stream] = event.streams;
      playRemoteAudio(peerId, stream);
    };

    pc.onconnectionstatechange = () => {
      console.log('Voice connection state with', peerId, ':', pc.connectionState);
    };

    // Store peer
    const peer: VoicePeer = { id: peerId, connection: pc };
    peersRef.current.set(peerId, peer);
    setPeers(new Map(peersRef.current));

    // Create offer if initiator
    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        clientRef.current?.publish(
          `xp-voice/${roomCode}/offer`,
          JSON.stringify({
            type: 'voice-offer',
            from: myIdRef.current,
            to: peerId,
            offer,
          })
        );
        console.log('Sent offer to:', peerId);
      } catch (err) {
        console.error('Error creating voice offer:', err);
      }
    }

    return pc;
  };

  // Handle incoming offer
  const handleOffer = async (offer: RTCSessionDescriptionInit, from: string) => {
    console.log('Received offer from:', from);
    
    // Must have local stream first
    if (!localStreamRef.current) {
      console.log('No local stream, ignoring offer');
      return;
    }

    const pc = await createPeerConnection(from, false);
    
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      clientRef.current?.publish(
        `xp-voice/${roomCode}/answer`,
        JSON.stringify({
          type: 'voice-answer',
          from: myIdRef.current,
          to: from,
          answer,
        })
      );
      console.log('Sent answer to:', from);
    } catch (err) {
      console.error('Error handling voice offer:', err);
    }
  };

  // Handle answer
  const handleAnswer = async (answer: RTCSessionDescriptionInit, from: string) => {
    console.log('Received answer from:', from);
    const peer = peersRef.current.get(from);
    if (peer) {
      try {
        await peer.connection.setRemoteDescription(answer);
        console.log('Set remote description for:', from);
      } catch (err) {
        console.error('Error setting remote description:', err);
      }
    }
  };

  // Handle ICE candidate
  const handleIceCandidate = async (candidate: RTCIceCandidateInit, from: string) => {
    const peer = peersRef.current.get(from);
    if (peer) {
      try {
        await peer.connection.addIceCandidate(candidate);
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  };

  // Play remote audio
  const playRemoteAudio = (peerId: string, stream: MediaStream) => {
    console.log('Playing audio from:', peerId);
    
    // Create audio element
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.volume = 1.0;
    audio.id = `audio-${peerId}`;
    document.body.appendChild(audio);
    
    // Update peer with stream
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.stream = stream;
      peersRef.current.set(peerId, peer);
      setPeers(new Map(peersRef.current));
    }
  };

  // Enable voice
  const enableVoice = async (): Promise<boolean> => {
    try {
      setError(null);
      console.log('Enabling voice...');
      
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
      console.log('Voice enabled, local stream obtained');
      
      // Announce presence to existing peers
      clientRef.current?.publish(
        `xp-voice/${roomCode}/join`,
        JSON.stringify({
          type: 'voice-join',
          from: myIdRef.current,
          username: localUsername,
        })
      );
      console.log('Announced voice join');
      
      return true;
    } catch (err) {
      console.error('Error enabling voice:', err);
      setError('Microphone access denied. Please allow permissions.');
      return false;
    }
  };

  // Disable voice
  const disableVoice = () => {
    console.log('Disabling voice...');
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    // Remove audio elements
    peersRef.current.forEach((peer) => {
      const audio = document.getElementById(`audio-${peer.id}`);
      if (audio) {
        audio.remove();
      }
      peer.connection.close();
    });
    peersRef.current.clear();
    setPeers(new Map());
    
    setIsVoiceEnabled(false);
    setError(null);
    console.log('Voice disabled');
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
    disableVoice();
  };

  return {
    isVoiceEnabled,
    peers,
    error,
    toggleVoice,
  };
}
