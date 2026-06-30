import mongoose from 'mongoose';

export async function connectMongo(mongoUri: string) {
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  });
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}
