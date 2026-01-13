import mongoose, { Schema } from 'mongoose';

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface MissionInviteDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  invitedUserId: mongoose.Types.ObjectId;
  status: InviteStatus;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}

const MissionInviteSchema = new Schema<MissionInviteDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    invitedBy: { type: Schema.Types.ObjectId, required: true, index: true },
    invitedUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, required: true, enum: ['pending', 'accepted', 'declined', 'revoked'], default: 'pending', index: true },
    token: { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true, index: true },
  },
  { collection: 'missionInvites' }
);

MissionInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
MissionInviteSchema.index({ invitedUserId: 1, status: 1 });
MissionInviteSchema.index({ missionId: 1, status: 1 });

export const MissionInviteModel = mongoose.model<MissionInviteDoc>('MissionInvite', MissionInviteSchema);
