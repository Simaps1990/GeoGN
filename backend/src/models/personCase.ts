import mongoose, { Schema } from 'mongoose';

export type PersonCaseLastKnownType = 'address' | 'poi';
export type PersonCaseMobility = 'none' | 'bike' | 'scooter' | 'motorcycle' | 'car';
export type PersonCaseSex = 'unknown' | 'female' | 'male';
export type PersonCaseHealthStatus = 'stable' | 'fragile' | 'critique';

export type PersonCaseBodyPart =
  | 'head'
  | 'face'
  | 'neck'
  | 'chest'
  | 'back'
  | 'abdomen'
  | 'pelvis'
  | 'left_arm'
  | 'right_arm'
  | 'left_hand'
  | 'right_hand'
  | 'left_leg'
  | 'right_leg'
  | 'left_foot'
  | 'right_foot';

export interface PersonCaseDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  lastKnown: {
    type: PersonCaseLastKnownType;
    query: string;
    poiId?: mongoose.Types.ObjectId;
    lng?: number;
    lat?: number;
    when?: Date;
  };
  nextClue?: {
    type: PersonCaseLastKnownType;
    query: string;
    poiId?: mongoose.Types.ObjectId;
    lng?: number;
    lat?: number;
    when?: Date;
  };
  mobility: PersonCaseMobility;
  age?: number;
  sex: PersonCaseSex;
  healthStatus: PersonCaseHealthStatus;
  diseases?: string[];
  injuries?: { id: string; locations?: PersonCaseBodyPart[] }[];
  diseasesFreeText?: string;
  injuriesFreeText?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PersonCaseSchema = new Schema<PersonCaseDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true, unique: true },
    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
    lastKnown: {
      type: {
        type: String,
        required: true,
        enum: ['address', 'poi'],
      },
      query: { type: String, required: true },
      poiId: { type: Schema.Types.ObjectId, required: false },
      lng: { type: Number, required: false },
      lat: { type: Number, required: false },
      when: { type: Date, required: false },
    },
    nextClue: {
      type: {
        type: String,
        required: false,
        enum: ['address', 'poi'],
      },
      query: { type: String, required: false },
      poiId: { type: Schema.Types.ObjectId, required: false },
      lng: { type: Number, required: false },
      lat: { type: Number, required: false },
      when: { type: Date, required: false },
    },
    mobility: { type: String, required: true, enum: ['none', 'bike', 'scooter', 'motorcycle', 'car'], default: 'none' },
    age: { type: Number, required: false },
    sex: { type: String, required: true, enum: ['unknown', 'female', 'male'], default: 'unknown' },
    healthStatus: { type: String, required: true, enum: ['stable', 'fragile', 'critique'], default: 'stable' },
    diseases: { type: [String], required: false, default: [] },
    injuries: {
      type: [
        {
          id: { type: String, required: true },
          locations: { type: [String], required: false, default: [] },
        },
      ],
      required: false,
      default: [],
    },
    diseasesFreeText: { type: String, required: false, default: '' },
    injuriesFreeText: { type: String, required: false, default: '' },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'personCases' }
);

export const PersonCaseModel = mongoose.model<PersonCaseDoc>('PersonCase', PersonCaseSchema);
