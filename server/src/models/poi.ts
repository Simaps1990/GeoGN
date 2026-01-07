import mongoose, { Schema } from 'mongoose';

type GeoPoint = {
  type: 'Point';
  coordinates: [number, number];
};

export type PoiType = 'zone_a_verifier' | 'doute' | 'cible_trouvee' | 'danger' | 'autre';

export interface PoiDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  type: PoiType;
  title: string;
  icon: string;
  color: string;
  comment: string;
  loc: GeoPoint;
  createdAt: Date;
  deletedAt?: Date;
}

const GeoPointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, required: true, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false }
);

const PoiSchema = new Schema<PoiDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, required: true, enum: ['zone_a_verifier', 'doute', 'cible_trouvee', 'danger', 'autre'] },
    title: { type: String, required: true },
    icon: { type: String, required: true, default: 'marker' },
    color: { type: String, required: true, default: '#f97316' },
    comment: { type: String, required: true },
    loc: { type: GeoPointSchema, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    deletedAt: { type: Date, required: false },
  },
  { collection: 'pois' }
);

PoiSchema.index({ loc: '2dsphere' });

export const PoiModel = mongoose.model<PoiDoc>('Poi', PoiSchema);
