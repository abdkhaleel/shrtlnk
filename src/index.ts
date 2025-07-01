import Fastify, { FastifyInstance } from 'fastify';
import cassandra from 'cassandra-driver';
import { nanoid } from 'nanoid';
import Redis from 'ioredis';
import { kafkaProducer } from './kafka';

const server: FastifyInstance = Fastify({
  logger: true,
});

const cassandraClient = new cassandra.Client({
    contactPoints: [process.env.CASSANDRA_HOST || 'localhost'],
    localDataCenter: 'datacenter1',
});

const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: 6379,
    enableOfflineQueue: false,
});

// ---START SERVER---
const start = async () => {
    try {
        await cassandraClient.connect();
        server.log.info('Successfully connected to Cassandra.');

        // In-app migration: Create keyspace and table if they don't exist
        await cassandraClient.execute(`
            CREATE KEYSPACE IF NOT EXISTS shrtlnk_keyspace WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
        `);
        await cassandraClient.execute(`
            CREATE TABLE IF NOT EXISTS shrtlnk_keyspace.links (
                short_code text PRIMARY KEY,
                long_url text,
                created_at timestamp
            );
        `);
        server.log.info('Ensured keyspace and table exist.');

        // Use the keyspace for all subsequent queries
        cassandraClient.keyspace = 'shrtlnk_keyspace';

        redisClient.on('connect', () => server.log.info('Successfully connected to Redis.'));
        redisClient.on('error', (error) => server.log.error('Redis connection error:', error));

        await kafkaProducer.connect();
        server.log.info('Successfully connected to Kafka.');

        await server.listen({ port: 3000, host: '0.0.0.0' });
        server.log.info(`Server listening on port 3000`);
    } catch (error) {
        server.log.error({msg: 'Startup Error', err: error});
        await cassandraClient.shutdown();
        await redisClient.quit();
        await kafkaProducer.disconnect();
        process.exit(1);
    }
};

start();

// --- API Endpoints (No changes needed below) ---

interface ShortenRequestBody {
    longUrl: string;
}

server.post<{ Body: ShortenRequestBody }>('/api/shorten', async (request, reply) => {
    const { longUrl } = request.body;
    if (!longUrl) { return reply.status(400).send({error: 'longUrl is required'}); }

    const shortCode = nanoid(8);
    const query = 'INSERT INTO links (short_code, long_url, created_at) VALUES (?, ?, ?)';
    const params = [shortCode, longUrl, new Date()];

    try {
        await cassandraClient.execute(query, params, { prepare: true });
        server.log.info(`Created short link: ${shortCode} -> ${longUrl}`);
        await kafkaProducer.send({
            topic: 'shrtlnk-events',
            messages: [{ value: JSON.stringify({ event: 'created', shortCode, longUrl, timestamp: new Date().toISOString() }) }]
        });
        reply.status(201).send({ shortUrl: `http://localhost:3000/${shortCode}`, shortCode });
    } catch (error) {
        server.log.error(error);
        reply.status(500).send({ error: 'Internal server error' });
    }
});

interface RedirectParams {
    shortCode: string;
}

server.get<{ Params: RedirectParams }>('/:shortCode', async (request, reply) => {
    const { shortCode } = request.params;
    try {
        const cachedUrl = await redisClient.get(shortCode);
        if (cachedUrl) {
            server.log.info(`CACHE HIT: Found ${shortCode} in Redis.`);
            await kafkaProducer.send({
                topic: 'shrtlnk-events',
                messages: [{ value: JSON.stringify({ event: 'accessed', shortCode, longUrl: cachedUrl, cache: true, timestamp: new Date().toISOString() }) }]
            });
            return reply.redirect(302, cachedUrl);
        }
    } catch (error) {
        server.log.info(`CACHE MISS: ${shortCode} not found in Redis. Querying Cassandra...`);
    }

    const query = 'SELECT long_url FROM links WHERE short_code = ?';
    const result = await cassandraClient.execute(query, [shortCode], { prepare: true });
    if (result.rowLength > 0) {
        const longUrl = result.rows[0].long_url;
        server.log.info(`DB HIT: Redirecting ${shortCode} to ${longUrl}`);
        await redisClient.set(shortCode, longUrl, 'EX', 3600);
        server.log.info(`CACHE SET: Saved ${shortCode} to Redis.`);
        await kafkaProducer.send({
            topic: 'shrtlnk-events',
            messages: [{ value: JSON.stringify({ event: 'accessed', shortCode, longUrl, cache: false, timestamp: new Date().toISOString() }) }]
        });
        return reply.redirect(302, longUrl);
    } else {
        server.log.warn(`DB MISS: Short code ${shortCode} not found in Cassandra.`);
        return reply.status(404).send({ error: 'Short code not found' });
    }
});