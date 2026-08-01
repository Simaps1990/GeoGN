import mongoose, { Schema } from 'mongoose';

export interface UserDoc {
  _id: mongoose.Types.ObjectId;
  appUserId: string;
  displayName: string;
  email?: string;
  phone?: string;
  passwordHash: string;
  createdAt: Date;
  passwordChangedAt: Date;
}

const UserSchema = new Schema<UserDoc>(
  {
    appUserId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true },
    email: { type: String, required: false, unique: true, sparse: true },
    phone: { type: String, required: false },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    passwordChangedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'users' }
);

export const UserModel = mongoose.model<UserDoc>('User', UserSchema);
