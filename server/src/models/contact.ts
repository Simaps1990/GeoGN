import mongoose, { Schema } from 'mongoose';

export interface ContactDoc {
  _id: mongoose.Types.ObjectId;
  ownerUserId: mongoose.Types.ObjectId;
  contactUserId: mongoose.Types.ObjectId;
  alias?: string;
  createdAt: Date;
}

const ContactSchema = new Schema<ContactDoc>(
  {
    ownerUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    contactUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    alias: { type: String, required: false },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'contacts' }
);

ContactSchema.index({ ownerUserId: 1, contactUserId: 1 }, { unique: true });

export const ContactModel = mongoose.model<ContactDoc>('Contact', ContactSchema);
