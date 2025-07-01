// src/redis.ts
import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';

const redisClient = new Redis({
    host: REDIS_HOST,
    port: 6379,
    enableOfflineQueue: false, // Important for fast failure
});

redisClient.on('connect', () => console.log('Successfully connected to Redis.'));
redisClient.on('error', (error) => console.error('Redis connection error:', error));

// Export the single client instance
export default redisClient;