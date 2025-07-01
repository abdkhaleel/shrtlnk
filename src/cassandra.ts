import cassandra from 'cassandra-driver';

const CASSANDRA_HOST = process.env.CASSANDRA_HOST || 'localhost';
const KEYSPACE = 'shrtlnk_keyspace';

const cassandraClient = new cassandra.Client({
    contactPoints: [CASSANDRA_HOST],
    localDataCenter: 'datacenter1',
});

export const connectAndInitializeCassandra = async () => {
    await cassandraClient.connect();
    console.log('Successfully connected to Cassandra.');

    await cassandraClient.execute(`
        CREATE KEYSPACE IF NOT EXISTS ${KEYSPACE} WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
    `);
    console.log(`Ensured keyspace '${KEYSPACE}' exists.`);
    
    cassandraClient.keyspace = KEYSPACE;
    
    await cassandraClient.execute(`
        CREATE TABLE IF NOT EXISTS links (
            short_code text PRIMARY KEY,
            long_url text,
            created_at timestamp
        );
    `);
    console.log('Ensured table \'links\' exists.');
};

export default cassandraClient;