import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';

const redisClient = new Redis({
    host: REDIS_HOST,
    port: 6379,
    enableOfflineQueue: false, 
});

redisClient.on('connect', () => console.log('Successfully connected to Redis.'));
redisClient.on('error', (error) => console.error('Redis connection error:', error));

export default redisClient;