import mongoose, { Schema } from 'mongoose';

type GeoPoint = {
  type: 'Point';
  coordinates: [number, number];
};

export interface PositionCurrentDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  loc: GeoPoint;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GeoPointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, required: true, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) =>
          Array.isArray(v) &&
          v.length === 2 &&
          Number.isFinite(v[0]) &&
          v[0] >= -180 &&
          v[0] <= 180 &&
          Number.isFinite(v[1]) &&
          v[1] >= -90 &&
          v[1] <= 90,
        message: 'loc.coordinates must be [lng, lat] within valid ranges',
      },
    },
  },
  { _id: false }
);

const PositionCurrentSchema = new Schema<PositionCurrentDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    loc: { type: GeoPointSchema, required: true },
    speed: { type: Number, required: false },
    heading: { type: Number, required: false },
    accuracy: { type: Number, required: false },
    timestamp: { type: Date, required: true },
  },
  { collection: 'positions_current', timestamps: true }
);

PositionCurrentSchema.index({ missionId: 1, userId: 1 }, { unique: true });
PositionCurrentSchema.index({ loc: '2dsphere' });
PositionCurrentSchema.index({ missionId: 1 });

export const PositionCurrentModel = mongoose.model<PositionCurrentDoc>('PositionCurrent', PositionCurrentSchema);
