import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  type: 'chat' | 'system' | 'image' | 'voice' | 'file';
  imageData?: string;
  voiceData?: string;
  voiceDuration?: number;
  fileData?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}

interface PeerUser {
  id: string;
  username: string;
  lastSeen: number;
}

// Single global chat room
export const GLOBAL_ROOM = 'XPchat';

// Generate consistent client ID
const generateClientId = () => `xp-${Math.random().toString(36).substr(2, 9)}-${Date.now().toString(36).substr(-4)}`;

// Message batching configuration
const BATCH_SIZE = 10;
const BATCH_INTERVAL = 100;

export function useStableChat(localUsername: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<Map<string, PeerUser>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isReady, setIsReady] = useState(false);
  
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const myIdRef = useRef<string>(generateClientId());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const usersRef = useRef<Map<string, PeerUser>>(new Map());
  
  // Message batching refs
  const messageBufferRef = useRef<ChatMessage[]>([]);
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const lastPublishTimeRef = useRef<number>(0);
  const publishQueueRef = useRef<Array<{type: string, data: any}>>([]);
  const isProcessingQueueRef = useRef(false);

  // Process batched messages
  const flushMessageBuffer = useCallback(() => {
    if (messageBufferRef.current.length === 0) return;
    
    const messagesToAdd = [...messageBufferRef.current];
    messageBufferRef.current = [];
    
    setMessages(prev => {
      // Deduplicate
      const existingIds = new Set(prev.map(m => m.id));
      const newMessages = messagesToAdd.filter(m => !existingIds.has(m.id));
      return [...prev, ...newMessages].slice(-200); // Keep last 200 messages
    });
  }, []);

  // Queue a message for batching
  const queueMessage = useCallback((message: ChatMessage) => {
    // Check for duplicates
    if (processedMessageIdsRef.current.has(message.id)) return;
    processedMessageIdsRef.current.add(message.id);
    
    // Limit processed IDs set size
    if (processedMessageIdsRef.current.size > 500) {
      const iterator = processedMessageIdsRef.current.values();
      for (let i = 0; i < 100; i++) {
        const value = iterator.next().value;
        if (value) processedMessageIdsRef.current.delete(value);
      }
    }
    
    messageBufferRef.current.push(message);
    
    if (messageBufferRef.current.length >= BATCH_SIZE) {
      flushMessageBuffer();
    } else {
      if (batchTimeoutRef.current) clearTimeout(batchTimeoutRef.current);
      batchTimeoutRef.current = setTimeout(flushMessageBuffer, BATCH_INTERVAL);
    }
  }, [flushMessageBuffer]);

  // Throttled publish to prevent MQTT flood
  const throttledPublish = useCallback((type: string, data: any) => {
    publishQueueRef.current.push({ type, data });
    processPublishQueue();
  }, []);

  const processPublishQueue = useCallback(() => {
    if (isProcessingQueueRef.current || publishQueueRef.current.length === 0) return;
    
    const now = Date.now();
    const timeSinceLastPublish = now - lastPublishTimeRef.current;
    const minInterval = 50; // Minimum 50ms between publishes
    
    if (timeSinceLastPublish < minInterval) {
      setTimeout(processPublishQueue, minInterval - timeSinceLastPublish);
      return;
    }
    
    isProcessingQueueRef.current = true;
    const item = publishQueueRef.current.shift();
    
    if (item && clientRef.current?.connected) {
      try {
        clientRef.current.publish(
          `xpchat/${GLOBAL_ROOM}/${item.type}`,
          JSON.stringify({
            type: item.type,
            from: myIdRef.current,
            ...item.data,
            timestamp: Date.now(),
          }),
          { qos: 0, retain: false }
        );
        lastPublishTimeRef.current = Date.now();
      } catch (e) {
        console.error('Publish error:', e);
      }
    }
    
    isProcessingQueueRef.current = false;
    
    if (publishQueueRef.current.length > 0) {
      setTimeout(processPublishQueue, minInterval);
    }
  }, []);

  // Connect to MQTT
  useEffect(() => {
    if (!localUsername) return;

    const connect = () => {
      setConnectionStatus('connecting');
      
      const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
        clientId: myIdRef.current,
        clean: true,
        connectTimeout: 20000,
        reconnectPeriod: 8000,
        keepalive: 60,
        rejectUnauthorized: false,
      });
      
      clientRef.current = client;

      client.on('connect', () => {
        console.log('MQTT connected to', GLOBAL_ROOM);
        setConnectionStatus('connected');
        setIsReady(true);
        
        client.subscribe(`xpchat/${GLOBAL_ROOM}/#`, { qos: 0 }, (err) => {
          if (!err) {
            // Stagger initial announcements
            setTimeout(() => {
              throttledPublish('join', { username: localUsername });
            }, Math.random() * 1000);
            
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = setInterval(() => {
              throttledPublish('ping', { timestamp: Date.now() });
            }, 20000);
          }
        });
      });

      client.on('message', (_topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          if (data.from === myIdRef.current) return;
          
          // Rate limit message processing
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

      client.on('reconnect', () => {
        console.log('MQTT reconnecting...');
        setConnectionStatus('connecting');
      });
    };

    connect();

    // Cleanup users who haven't pinged in 60 seconds
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      usersRef.current.forEach((user, id) => {
        if (now - user.lastSeen > 60000) {
          usersRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) {
        setUsers(new Map(usersRef.current));
      }
    }, 10000);

    return () => {
      if (batchTimeoutRef.current) clearTimeout(batchTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      clearInterval(cleanupInterval);
      
      if (clientRef.current?.connected) {
        throttledPublish('leave', { username: localUsername });
      }
      
      // Final flush
      flushMessageBuffer();
      
      setTimeout(() => {
        clientRef.current?.end(true);
      }, 500);
    };
  }, [localUsername, throttledPublish, flushMessageBuffer]);

  const handleMessage = (data: any) => {
    switch (data.type) {
      case 'chat':
        queueMessage({
          id: `${data.timestamp}-${data.from}`,
          username: data.username,
          text: data.text,
          timestamp: data.timestamp,
          type: 'chat',
        });
        break;
        
      case 'image':
        queueMessage({
          id: `${data.timestamp}-${data.from}`,
          username: data.username,
          text: data.text || 'Image',
          timestamp: data.timestamp,
          type: 'image',
          imageData: data.imageData,
        });
        break;
        
      case 'voice':
        queueMessage({
          id: `${data.timestamp}-${data.from}`,
          username: data.username,
          text: data.text || '🎤 Voice message',
          timestamp: data.timestamp,
          type: 'voice',
          voiceData: data.voiceData,
          voiceDuration: data.voiceDuration || 0,
        });
        break;

      case 'file':
        queueMessage({
          id: `${data.timestamp}-${data.from}`,
          username: data.username,
          text: data.text || '📎 File',
          timestamp: data.timestamp,
          type: 'file',
          fileData: data.fileData,
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType,
        });
        break;
        
      case 'join':
        usersRef.current.set(data.from, {
          id: data.from,
          username: data.username,
          lastSeen: Date.now(),
        });
        setUsers(new Map(usersRef.current));
        addSystemMessage(`${data.username} joined`);
        // Respond with presence after delay
        setTimeout(() => {
          throttledPublish('presence', { username: localUsername });
        }, Math.random() * 2000);
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
    queueMessage({
      id: `sys-${Date.now()}`,
      username: 'System',
      text,
      timestamp: Date.now(),
      type: 'system',
    });
  };

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !isReady) return;
    
    const timestamp = Date.now();
    throttledPublish('chat', { username: localUsername, text: text.trim() });
    
    queueMessage({
      id: `msg-${timestamp}-${myIdRef.current}`,
      username: localUsername,
      text: text.trim(),
      timestamp,
      type: 'chat',
    });
  }, [isReady, localUsername, throttledPublish, queueMessage]);

  const sendImage = useCallback((imageData: string, caption?: string) => {
    if (!isReady) return;
    
    const timestamp = Date.now();
    throttledPublish('image', { 
      username: localUsername, 
      imageData,
      text: caption || 'Image'
    });
    
    queueMessage({
      id: `img-${timestamp}-${myIdRef.current}`,
      username: localUsername,
      text: caption || 'Image',
      timestamp,
      type: 'image',
      imageData,
    });
  }, [isReady, localUsername, throttledPublish, queueMessage]);

  const sendVoice = useCallback((voiceData: string, duration: number, caption?: string) => {
    if (!isReady) return;
    
    const timestamp = Date.now();
    throttledPublish('voice', { 
      username: localUsername, 
      voiceData,
      voiceDuration: duration,
      text: caption || `🎤 Voice message (${duration}s)`
    });
    
    queueMessage({
      id: `voice-${timestamp}-${myIdRef.current}`,
      username: localUsername,
      text: caption || `🎤 Voice message (${duration}s)`,
      timestamp,
      type: 'voice',
      voiceData,
      voiceDuration: duration,
    });
  }, [isReady, localUsername, throttledPublish, queueMessage]);

  const sendFile = useCallback((fileData: string, fileName: string, fileSize: number, fileType: string) => {
    if (!isReady) return;
    
    const timestamp = Date.now();
    throttledPublish('file', { 
      username: localUsername, 
      fileData,
      fileName,
      fileSize,
      fileType,
      text: `📎 ${fileName}`
    });
    
    queueMessage({
      id: `file-${timestamp}-${myIdRef.current}`,
      username: localUsername,
      text: `📎 ${fileName}`,
      timestamp,
      type: 'file',
      fileData,
      fileName,
      fileSize,
      fileType,
    });
  }, [isReady, localUsername, throttledPublish, queueMessage]);

  const clearMessages = useCallback(() => {
    messageBufferRef.current = [];
    processedMessageIdsRef.current.clear();
    setMessages([]);
  }, []);

  return {
    messages,
    users,
    userCount: users.size + 1,
    connectionStatus,
    isReady,
    roomName: GLOBAL_ROOM,
    sendMessage,
    sendImage,
    sendVoice,
    sendFile,
    clearMessages,
  };
}
