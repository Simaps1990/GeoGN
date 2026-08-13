import mongoose, { Schema } from 'mongoose';

export type BaptismIcon = 'person' | 'car' | 'house';
export type BaptismDisplayMode = 'colors' | 'tion' | 'both';

type GeoJSONLineString = {
  type: 'LineString';
  coordinates: number[][];
};

export interface BaptismAxis {
  axisId: string;
  color: string;
  name: string | null;
  suggestions: string[];
  geometry: GeoJSONLineString;
  bearing: number;
}

export interface BaptismDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  icon: BaptismIcon;
  point: { lng: number; lat: number };
  pointName: string | null;
  displayMode: BaptismDisplayMode;
  axes: BaptismAxis[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GeoJSONLineStringSchema = new Schema<GeoJSONLineString>(
  {
    type: { type: String, required: true, enum: ['LineString'], default: 'LineString' },
    coordinates: { type: [[Number]], required: true },
  },
  { _id: false }
);

const BaptismAxisSchema = new Schema<BaptismAxis>(
  {
    axisId: { type: String, required: true },
    color: { type: String, required: true },
    name: { type: String, required: false, default: null },
    suggestions: { type: [String], default: [] },
    geometry: { type: GeoJSONLineStringSchema, required: true },
    bearing: { type: Number, required: true },
  },
  { _id: false }
);

const BaptismSchema = new Schema<BaptismDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    icon: { type: String, required: true, enum: ['person', 'car', 'house'] },
    point: {
      type: { lng: Number, lat: Number },
      required: true,
    },
    pointName: { type: String, required: false, default: null },
    displayMode: { type: String, required: true, enum: ['colors', 'tion', 'both'], default: 'colors' },
    axes: { type: [BaptismAxisSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'baptisms' }
);

export const BaptismModel = mongoose.model<BaptismDoc>('Baptism', BaptismSchema);
