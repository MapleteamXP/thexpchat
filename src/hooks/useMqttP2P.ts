import { useState, useEffect, useCallback, useRef } from 'react';
import mqtt from 'mqtt';

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  type: 'chat' | 'system';
}

interface PeerInfo {
  id: string;
  username: string;
  lastSeen: number;
}

export function useMqttP2P(localUsername: string, roomCode: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('connecting');
  const [myId] = useState(() => `user-${Math.random().toString(36).substr(2, 8)}`);
  
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const peersRef = useRef<Map<string, PeerInfo>>(new Map());

  // Connect to MQTT broker
  useEffect(() => {
    if (!roomCode || !localUsername) return;

    setConnectionStatus('connecting');
    
    // Connect to public HiveMQ broker
    const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
      clientId: myId,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
    });
    
    clientRef.current = client;

    client.on('connect', () => {
      console.log('MQTT connected!');
      setIsConnected(true);
      setConnectionStatus('connected');
      
      // Subscribe to room topics
      const roomTopic = `xp-chat/${roomCode}/#`;
      client.subscribe(roomTopic, (err) => {
        if (err) {
          console.error('Subscribe error:', err);
        } else {
          console.log('Subscribed to:', roomTopic);
          
          // Announce our presence
          publishMessage('join', {
            id: myId,
            username: localUsername,
          });
          
          addSystemMessage('Connected! Waiting for others to join...');
        }
      });
    });

    client.on('message', (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        console.log('Received:', topic, data);
        
        // Ignore our own messages
        if (data.id === myId) return;
        
        handleMessage(data);
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    });

    client.on('error', (err) => {
      console.error('MQTT error:', err);
      setConnectionStatus('disconnected');
    });

    client.on('offline', () => {
      console.log('MQTT offline');
      setIsConnected(false);
      setConnectionStatus('disconnected');
    });

    client.on('reconnect', () => {
      console.log('MQTT reconnecting...');
      setConnectionStatus('connecting');
    });

    // Cleanup
    return () => {
      if (client.connected) {
        publishMessage('leave', {
          id: myId,
          username: localUsername,
        });
      }
      client.end();
    };
  }, [roomCode, localUsername, myId]);

  // Handle incoming message
  const handleMessage = (data: any) => {
    switch (data.type) {
      case 'join':
        // Someone joined
        peersRef.current.set(data.id, {
          id: data.id,
          username: data.username,
          lastSeen: Date.now(),
        });
        setPeers(new Map(peersRef.current));
        addSystemMessage(`${data.username} joined!`);
        
        // Respond with our presence
        publishMessage('presence', {
          id: myId,
          username: localUsername,
        });
        break;
        
      case 'presence':
        // Someone is already here
        peersRef.current.set(data.id, {
          id: data.id,
          username: data.username,
          lastSeen: Date.now(),
        });
        setPeers(new Map(peersRef.current));
        break;
        
      case 'chat':
        // Chat message
        setMessages(prev => [...prev, {
          id: `msg-${data.timestamp}-${data.id}`,
          username: data.username,
          text: data.text,
          timestamp: data.timestamp,
          type: 'chat',
        }]);
        break;
        
      case 'leave':
        // Someone left
        peersRef.current.delete(data.id);
        setPeers(new Map(peersRef.current));
        addSystemMessage(`${data.username} left.`);
        break;
    }
  };

  // Publish message to MQTT
  const publishMessage = (type: string, data: any) => {
    const client = clientRef.current;
    if (!client?.connected) return;
    
    const topic = `xp-chat/${roomCode}/${type}`;
    const message = JSON.stringify({
      type,
      ...data,
      timestamp: Date.now(),
    });
    
    client.publish(topic, message);
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
    
    const timestamp = Date.now();
    
    // Add to our own messages
    setMessages(prev => [...prev, {
      id: `msg-${timestamp}-${myId}`,
      username: localUsername,
      text: text.trim(),
      timestamp,
      type: 'chat',
    }]);
    
    // Publish to others
    publishMessage('chat', {
      id: myId,
      username: localUsername,
      text: text.trim(),
    });
  }, [myId, localUsername, roomCode]);

  return {
    messages,
    peers,
    isConnected,
    connectionStatus,
    myId,
    sendMessage,
  };
}
