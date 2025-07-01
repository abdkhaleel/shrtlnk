// src/consumer.ts
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';

// This is a separate process. Let's create a new Kafka client for it.
const kafka = new Kafka({
  clientId: 'shrtlnk-consumer',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const consumer: Consumer = kafka.consumer({ groupId: 'shrtlnk-group' });
const topic = 'shrtlnk-events';

const runConsumer = async () => {
  try {
    await consumer.connect();
    console.log('Analytics consumer connected to Kafka');
    await consumer.subscribe({ topic, fromBeginning: true });
    console.log(`Subscribed to topic: ${topic}`);
    await consumer.run({
      eachMessage: async ({ message }: EachMessagePayload) => {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString());
        console.log('--- NEW EVENT RECEIVED ---');
        console.log(event);
        console.log('--------------------------');
      },
    });
  } catch (error) {
    console.error('Error in analytics consumer:', error);
    process.exit(1);
  }
};

runConsumer();