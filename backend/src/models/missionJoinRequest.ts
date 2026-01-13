import mongoose, { Schema } from 'mongoose';

export type MissionJoinRequestStatus = 'pending' | 'accepted' | 'declined';

export interface MissionJoinRequestDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  status: MissionJoinRequestStatus;
  createdAt: Date;
  handledBy?: mongoose.Types.ObjectId | null;
  handledAt?: Date | null;
}

const MissionJoinRequestSchema = new Schema<MissionJoinRequestDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, required: true, enum: ['pending', 'accepted', 'declined'], default: 'pending', index: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    handledBy: { type: Schema.Types.ObjectId, required: false, default: null },
    handledAt: { type: Date, required: false, default: null },
  },
  { collection: 'missionJoinRequests' }
);

MissionJoinRequestSchema.index({ missionId: 1, requestedBy: 1 }, { unique: true });
MissionJoinRequestSchema.index({ missionId: 1, status: 1 });

export const MissionJoinRequestModel = mongoose.model<MissionJoinRequestDoc>('MissionJoinRequest', MissionJoinRequestSchema);
