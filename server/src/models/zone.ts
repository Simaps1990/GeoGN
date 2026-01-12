import mongoose, { Schema } from 'mongoose';

type Circle = {
  center: { lng: number; lat: number };
  radiusMeters: number;
};

type GeoJSONPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

export type ZoneType = 'circle' | 'polygon';

export interface ZoneSector {
  sectorId: mongoose.Types.ObjectId;
  color: string;
  geometry: GeoJSONPolygon;
}

export interface ZoneGrid {
  rows: number;
  cols: number;
  orientation?: 'vertical' | 'diag45';
}

export interface ZoneDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  title: string;
  comment?: string;
  color: string;
  type: ZoneType;
  circle?: Circle;
  polygon?: GeoJSONPolygon;
  sectors?: ZoneSector[];
  grid?: ZoneGrid;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GeoJSONPolygonSchema = new Schema<GeoJSONPolygon>(
  {
    type: { type: String, required: true, enum: ['Polygon'], default: 'Polygon' },
    coordinates: { type: [[[Number]]], required: true },
  },
  { _id: false }
);

const ZoneSectorSchema = new Schema<ZoneSector>(
  {
    sectorId: { type: Schema.Types.ObjectId, required: true },
    color: { type: String, required: true },
    geometry: { type: GeoJSONPolygonSchema, required: true },
  },
  { _id: false }
);

const ZoneGridSchema = new Schema<ZoneGrid>(
  {
    rows: { type: Number, required: true, min: 1, max: 26 },
    cols: { type: Number, required: true, min: 1, max: 26 },
    orientation: { type: String, required: false, enum: ['vertical', 'diag45'] },
  },
  { _id: false }
);

const ZoneSchema = new Schema<ZoneDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true },
    comment: { type: String, required: false, default: '' },
    color: { type: String, required: true, default: '#22c55e' },
    type: { type: String, required: true, enum: ['circle', 'polygon'] },
    circle: {
      type: {
        center: { lng: Number, lat: Number },
        radiusMeters: Number,
      },
      required: false,
    },
    polygon: { type: GeoJSONPolygonSchema, required: false },
    sectors: { type: [ZoneSectorSchema], required: false },
    grid: { type: ZoneGridSchema, required: false },
    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'zones' }
);

ZoneSchema.index({ polygon: '2dsphere' });
ZoneSchema.index({ 'sectors.geometry': '2dsphere' });

export const ZoneModel = mongoose.model<ZoneDoc>('Zone', ZoneSchema);
