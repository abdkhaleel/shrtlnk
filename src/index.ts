import Fastify, { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';

import cassandraClient, { connectAndInitializeCassandra } from './cassandra';
import redisClient from './redis';
import { kafkaProducer } from './kafka';

const server: FastifyInstance = Fastify({
  logger: true,
});

// --- API ENDPOINTS ---

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
        server.log.error(`Redis error: ${error}`);
    }

    server.log.info(`CACHE MISS: ${shortCode} not found in Redis. Querying Cassandra...`);
    const query = 'SELECT long_url FROM links WHERE short_code = ?';
    const result = await cassandraClient.execute(query, [shortCode], { prepare: true });

    if (result.rowLength > 0) {
        const longUrl = result.rows[0].long_url;
        server.log.info(`DB HIT: Redirecting ${shortCode} to ${longUrl}`);
        redisClient.set(shortCode, longUrl, 'EX', 3600);
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


// --- START SERVER ---
const start = async () => {
    try {
        await connectAndInitializeCassandra();
        await kafkaProducer.connect();
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