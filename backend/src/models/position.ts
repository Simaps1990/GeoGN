import mongoose, { Schema } from 'mongoose';

type GeoPoint = {
  type: 'Point';
  coordinates: [number, number];
};

export interface PositionDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  loc: GeoPoint;
  speed?: number;
  heading?: number;
  accuracy?: number;
  createdAt: Date;
}

const GeoPointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, required: true, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false }
);

const PositionSchema = new Schema<PositionDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    loc: { type: GeoPointSchema, required: true },
    speed: { type: Number, required: false },
    heading: { type: Number, required: false },
    accuracy: { type: Number, required: false },
    createdAt: { type: Date, required: true, default: () => new Date(), index: true },
  },
  { collection: 'positions' }
);

PositionSchema.index({ loc: '2dsphere' });
PositionSchema.index({ missionId: 1, userId: 1, createdAt: 1 });
// TTL 90 jours — MongoDB purge automatiquement les documents en arrière-plan
PositionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const PositionModel = mongoose.model<PositionDoc>('Position', PositionSchema);
