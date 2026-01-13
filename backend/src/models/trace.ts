import mongoose, { Schema } from 'mongoose';

type GeoPoint = {
  type: 'Point';
  coordinates: [number, number];
};

export interface TraceDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  color: string;
  loc: GeoPoint;
  createdAt: Date;
  expiresAt: Date;
}

const GeoPointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, required: true, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false }
);

const TraceSchema = new Schema<TraceDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    color: { type: String, required: true },
    loc: { type: GeoPointSchema, required: true },
    createdAt: { type: Date, required: true, default: () => new Date(), index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { collection: 'traces' }
);

TraceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
TraceSchema.index({ missionId: 1, userId: 1, createdAt: 1 });
TraceSchema.index({ loc: '2dsphere' });

export const TraceModel = mongoose.model<TraceDoc>('Trace', TraceSchema);
