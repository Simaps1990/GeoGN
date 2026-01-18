import mongoose, { Schema } from 'mongoose';

export interface HuntIsochroneDoc {
  _id: mongoose.Types.ObjectId;
  trackId: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  ts: Date;
  budgetSec: number;
  geojson: any;
  providerMeta?: any;
}

const HuntIsochroneSchema = new Schema<HuntIsochroneDoc>(
  {
    trackId: { type: Schema.Types.ObjectId, required: true, index: true },
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    ts: { type: Date, required: true, default: () => new Date(), index: true },
    budgetSec: { type: Number, required: true },
    geojson: { type: Schema.Types.Mixed, required: true },
    providerMeta: { type: Schema.Types.Mixed, required: false },
  },
  {
    collection: 'huntIsochrones',
  }
);

HuntIsochroneSchema.index({ trackId: 1, ts: -1 });
HuntIsochroneSchema.index({ missionId: 1, ts: -1 });

export const HuntIsochroneModel = mongoose.model<HuntIsochroneDoc>('HuntIsochrone', HuntIsochroneSchema);
