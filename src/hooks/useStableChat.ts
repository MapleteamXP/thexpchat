import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  type: 'chat' | 'system' | 'image';
  imageData?: string;
}

interface PeerUser {
  id: string;
  username: string;
  lastSeen: number;
}

// Generate consistent client ID
const generateClientId = () => `xp-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;

export function useStableChat(localUsername: string, roomCode: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<Map<string, PeerUser>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isReady, setIsReady] = useState(false);
  
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const myIdRef = useRef<string>(generateClientId());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const usersRef = useRef<Map<string, PeerUser>>(new Map());

  // Connect to MQTT with reconnection logic
  useEffect(() => {
    if (!roomCode || !localUsername) return;

    const connect = () => {
      setConnectionStatus('connecting');
      
      const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
        clientId: myIdRef.current,
        clean: true,
        connectTimeout: 15000,
        reconnectPeriod: 3000,
        keepalive: 30,
      });
      
      clientRef.current = client;

      client.on('connect', () => {
        console.log('MQTT connected');
        setConnectionStatus('connected');
        setIsReady(true);
        
        // Subscribe to room
        client.subscribe(`xpchat/${roomCode}/#`, (err) => {
          if (!err) {
            // Announce join
            publish('join', { username: localUsername });
            
            // Start ping interval
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = setInterval(() => {
              publish('ping', { timestamp: Date.now() });
            }, 10000);
          }
        });
      });

      client.on('message', (_topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          if (data.from === myIdRef.current) return;
          
          handleMessage(data);
        } catch (e) {
          console.error('Message parse error:', e);
        }
      });

      client.on('disconnect', () => {
        console.log('MQTT disconnected');
        setConnectionStatus('disconnected');
        setIsReady(false);
      });

      client.on('error', (err) => {
        console.error('MQTT error:', err);
        setConnectionStatus('disconnected');
      });

      client.on('offline', () => {
        setConnectionStatus('disconnected');
      });
    };

    connect();

    // Cleanup users who haven't pinged in 30 seconds
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      usersRef.current.forEach((user, id) => {
        if (now - user.lastSeen > 30000) {
          usersRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) {
        setUsers(new Map(usersRef.current));
      }
    }, 5000);

    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      clearInterval(cleanupInterval);
      
      if (clientRef.current?.connected) {
        publish('leave', { username: localUsername });
      }
      clientRef.current?.end();
    };
  }, [roomCode, localUsername]);

  const publish = (type: string, data: any) => {
    const client = clientRef.current;
    if (!client?.connected) return;
    
    client.publish(
      `xpchat/${roomCode}/${type}`,
      JSON.stringify({
        type,
        from: myIdRef.current,
        ...data,
        timestamp: Date.now(),
      })
    );
  };

  const handleMessage = (data: any) => {
    switch (data.type) {
      case 'chat':
        setMessages(prev => [...prev, {
          id: `${data.timestamp}-${data.from}`,
          username: data.username,
          text: data.text,
          timestamp: data.timestamp,
          type: 'chat',
        }]);
        break;
        
      case 'image':
        setMessages(prev => [...prev, {
          id: `${data.timestamp}-${data.from}`,
          username: data.username,
          text: data.text || 'Image',
          timestamp: data.timestamp,
          type: 'image',
          imageData: data.imageData,
        }]);
        break;
        
      case 'join':
        usersRef.current.set(data.from, {
          id: data.from,
          username: data.username,
          lastSeen: Date.now(),
        });
        setUsers(new Map(usersRef.current));
        addSystemMessage(`${data.username} joined`);
        // Respond with presence
        publish('presence', { username: localUsername });
        break;
        
      case 'presence':
        usersRef.current.set(data.from, {
          id: data.from,
          username: data.username,
          lastSeen: Date.now(),
        });
        setUsers(new Map(usersRef.current));
        break;
        
      case 'ping':
        const user = usersRef.current.get(data.from);
        if (user) {
          user.lastSeen = Date.now();
          usersRef.current.set(data.from, user);
          setUsers(new Map(usersRef.current));
        }
        break;
        
      case 'leave':
        usersRef.current.delete(data.from);
        setUsers(new Map(usersRef.current));
        addSystemMessage(`${data.username} left`);
        break;
    }
  };

  const addSystemMessage = (text: string) => {
    setMessages(prev => [...prev, {
      id: `sys-${Date.now()}`,
      username: 'System',
      text,
      timestamp: Date.now(),
      type: 'system',
    }]);
  };

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !isReady) return;
    
    publish('chat', { username: localUsername, text: text.trim() });
    
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}-${myIdRef.current}`,
      username: localUsername,
      text: text.trim(),
      timestamp: Date.now(),
      type: 'chat',
    }]);
  }, [isReady, localUsername, roomCode]);

  const sendImage = useCallback((imageData: string, caption?: string) => {
    if (!isReady) return;
    
    publish('image', { 
      username: localUsername, 
      imageData,
      text: caption || 'Image'
    });
    
    setMessages(prev => [...prev, {
      id: `img-${Date.now()}-${myIdRef.current}`,
      username: localUsername,
      text: caption || 'Image',
      timestamp: Date.now(),
      type: 'image',
      imageData,
    }]);
  }, [isReady, localUsername, roomCode]);

  return {
    messages,
    users,
    userCount: users.size + 1, // +1 for self
    connectionStatus,
    isReady,
    sendMessage,
    sendImage,
  };
}
