import mongoose, { Schema } from 'mongoose';

export type MissionRole = 'admin' | 'member' | 'viewer';

export interface MissionMemberDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: MissionRole;
  color: string;
  assignedSectorId?: mongoose.Types.ObjectId;
  joinedAt?: Date;
  removedAt?: Date | null;
  isActive: boolean;
}

const MissionMemberSchema = new Schema<MissionMemberDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    role: { type: String, required: true, enum: ['admin', 'member', 'viewer'] },
    color: { type: String, required: true },
    assignedSectorId: { type: Schema.Types.ObjectId, required: false },
    joinedAt: { type: Date, required: false },
    removedAt: { type: Date, required: false, default: null },
    isActive: { type: Boolean, required: true, default: false },
  },
  { collection: 'missionMembers' }
);

MissionMemberSchema.index({ missionId: 1, userId: 1 }, { unique: true });

export const MissionMemberModel = mongoose.model<MissionMemberDoc>('MissionMember', MissionMemberSchema);
