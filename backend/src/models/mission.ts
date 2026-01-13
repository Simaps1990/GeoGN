import mongoose, { Schema } from 'mongoose';

export type MissionStatus = 'draft' | 'active' | 'closed';
export type MapStyle = 'streets' | 'satellite';

export interface MissionDoc {
  _id: mongoose.Types.ObjectId;
  title: string;
  createdBy: mongoose.Types.ObjectId;
  status: MissionStatus;
  mapStyle: MapStyle;
  traceRetentionSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

const MissionSchema = new Schema<MissionDoc>(
  {
    title: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, required: true, enum: ['draft', 'active', 'closed'], index: true },
    mapStyle: { type: String, required: true, enum: ['streets', 'satellite'], default: 'streets' },
    // Default trace retention: 24h (86400s). TTL + snapshot window rely on this.
    traceRetentionSeconds: { type: Number, required: true, default: 86400 },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'missions' }
);

export const MissionModel = mongoose.model<MissionDoc>('Mission', MissionSchema);
