import mongoose from 'mongoose';

export async function connectMongo(mongoUri: string) {
  // Without a listener, an 'error' emitted after connect() resolves (e.g. a
  // background autoIndex build failing on pre-existing duplicate data) is an
  // unhandled EventEmitter error and crashes the whole process.
  mongoose.connection.on('error', (err) => {
    console.error('[mongo] connection error', err);
  });

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  });
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}
