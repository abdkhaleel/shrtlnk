import { Kafka, Producer } from 'kafkajs';

const kafka = new Kafka({
    clientId: 'shrtlnk-service',
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

export const kafkaProducer: Producer = kafka.producer();