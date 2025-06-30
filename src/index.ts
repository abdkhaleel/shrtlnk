import Fastify, { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import cassandra from 'cassandra-driver';
import { nanoid } from 'nanoid';
import Redis from 'ioredis';

//Initialize Fastify server
const server: FastifyInstance = Fastify({
  logger: true,
});

// cassandra setup
const cassandraClient = new cassandra.Client({
    contactPoints: [process.env.CASSANDRA_HOST || 'localhost'], //from docker-compose env
    localDataCenter: 'datacenter1', //default for cassandra docker image
    keyspace: 'shrtlnk_keyspace', 
});

// Redis setup
const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost', //from docker-compose env
    port: 6379,
    enableOfflineQueue: false, //disable offline queue for better performance
});

// --------API Endpoints--------

// 1.Endpoint to create a new short link
interface ShortenRequestBody{
    longUrl: string;
}

server.post<{ Body: ShortenRequestBody }>('/api/shorten', async (request, reply) => {
    const { longUrl } = request.body;

    if (!longUrl) {
        return reply.status(400).send({error: 'longUrl is required'});
    }

    //generate a unique short link ID
    const shortCode = nanoid(8);

    const query = 'INSERT INTO links (short_code, long_url, created_at) VALUES (?, ?, ?)';

    const params = [shortCode, longUrl, new Date()];

    try{
        await cassandraClient.execute(query, params, { prepare: true });
        server.log.info(`Created short link: ${shortCode} -> ${longUrl}`);

        reply.status(201).send({
            shortUrl: `http://localhost:3000/${shortCode}`,
            shortCode: shortCode,
        });
    } catch (error) {
        server.log.error(error);
        reply.status(500).send({ error: 'Internal server error' });
    }
});

// 2.Endpoint to redirect to the original long URL
interface RedirectParams {
    shortCode: string;
}

server.get<{ Params: RedirectParams}>('/:shortCode', async (request, reply) => {
    const { shortCode } = request.params;

    try{
        const cachedUrl = await redisClient.get(shortCode);
        if(cachedUrl){
            server.log.info(`CACHE HIT: Found ${shortCode} in Redis.` );
            return reply.redirect(302, cachedUrl);
        }
    } catch (error) {
        server.log.info(`CACHE MISS: ${shortCode} not found in Redis. Querying Cassandra...`);
    }

    const query = 'SELECT long_url FROM links WHERE short_code = ?';
    const params = [shortCode];

    try {
        const result = await cassandraClient.execute(query, params, { prepare: true });

        if(result.rowLength > 0) {
            const longUrl = result.rows[0].long_url;
            server.log.info(`DB HIT: Redirecting ${shortCode} to ${longUrl}`);

            await redisClient.set(shortCode, longUrl, 'EX', 3600);
            server.log.info(`CACHE SET: Saved ${shortCode} to Redis.`);
            //preform 302 found redirect
            return reply.redirect(302, longUrl);
        } else {
            server.log.warn(`DB MISS: Short code ${shortCode} not found in Cassandra.`);
            return reply.status(404).send({ error: 'Short code not found' });
        }
    } catch (error) {
        server.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
    }
});

// ---START SERVER---
const start = async () => {
    try{
        await cassandraClient.connect();
        server.log.info('Successfully connected to Cassandra.');

        redisClient.on('connect', () => server.log.info('Successfully connected to Redis.'));
        redisClient.on('error', (error) => server.log.error('Redis connection error:', error));

        await server.listen({ port: 3000, host: '0.0.0.0' });
        const address = server.server.address();
        const port = typeof address == 'string'? address: address?.port;
        server.log.info(`Server listening on port ${port}`);
    } catch (error) {
        server.log.error(error);
        await cassandraClient.shutdown();
        await redisClient.quit();
        process.exit(1);
    }
};

start();