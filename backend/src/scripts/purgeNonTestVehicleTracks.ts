import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../db.js';
import '../models/index.js';
import { VehicleTrackModel, HuntIsochroneModel } from '../models/index.js';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function getMongoUri(): string {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Missing MONGO_URI');
  }
  return uri;
}

async function main() {
  const apply = hasFlag('--apply');
  const yes = hasFlag('--yes');

  if (apply && !yes) {
    throw new Error('Refusing to apply without --yes');
  }

  const mongoUri = getMongoUri();
  await connectMongo(mongoUri);

  try {
    const filter: any = {
      $and: [
        { algorithm: { $ne: 'road_graph' } },
        { label: { $not: /TEST/i } },
      ],
    };

    const trackCount = await VehicleTrackModel.countDocuments(filter);
    const sample = await VehicleTrackModel.find(filter)
      .select({ _id: 1, missionId: 1, label: 1, vehicleType: 1, algorithm: 1, status: 1, createdAt: 1 })
      .limit(10)
      .lean();

    const ids = (await VehicleTrackModel.find(filter).select({ _id: 1 }).lean()).map((d: any) => d._id);
    const isochroneCount = ids.length
      ? await HuntIsochroneModel.countDocuments({ trackId: { $in: ids } })
      : 0;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          mode: apply ? 'APPLY' : 'DRY_RUN',
          filter: { algorithm: '!= road_graph', label: 'NOT /TEST/i' },
          vehicleTracksMatched: trackCount,
          huntIsochronesMatched: isochroneCount,
          sample,
        },
        null,
        2
      )
    );

    if (!apply) {
      return;
    }

    const delIso = ids.length ? await HuntIsochroneModel.deleteMany({ trackId: { $in: ids } }) : null;
    const delTracks = await VehicleTrackModel.deleteMany(filter);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          deleted: {
            vehicleTracks: delTracks.deletedCount ?? 0,
            huntIsochrones: delIso?.deletedCount ?? 0,
          },
        },
        null,
        2
      )
    );
  } finally {
    await disconnectMongo();
    await mongoose.disconnect().catch(() => undefined);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
