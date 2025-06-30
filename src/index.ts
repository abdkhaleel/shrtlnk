import Fastify, { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import cassandra from 'cassandra-driver';
import { nanoid } from 'nanoid';

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

    const query = 'SELECT long_url FROM links WHERE short_code = ?';
    const params = [shortCode];

    try {
        const result = await cassandraClient.execute(query, params, { prepare: true });

        if(result.rowLength > 0) {
            const longUrl = result.rows[0].long_url;
            server.log.info(`Redirecting ${shortCode} to ${longUrl}`);
            //preform 302 found redirect
            return reply.redirect(302, longUrl);
        } else {
            server.log.warn(`Short code ${shortCode} not found`);
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

        await server.listen({ port: 3000, host: '0.0.0.0' });
        const address = server.server.address();
        const port = typeof address == 'string'? address: address?.port;
        server.log.info(`Server listening on port ${port}`);
    } catch (error) {
        server.log.error(error);
        await cassandraClient.shutdown();
        process.exit(1);
    }
};

start();