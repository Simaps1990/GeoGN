import mongoose, { Schema } from 'mongoose';

export type VehicleTrackVehicleType = 'car' | 'motorcycle' | 'scooter' | 'truck' | 'unknown';
export type VehicleTrackOriginType = 'address' | 'poi';
export type VehicleTrackStatus = 'active' | 'stopped' | 'expired';
export type VehicleTrackAlgorithm = 'mvp_isoline' | 'road_graph';

export interface VehicleTrackOrigin {
  type: VehicleTrackOriginType;
  query: string;
  poiId?: mongoose.Types.ObjectId;
  lng?: number;
  lat?: number;
  when?: Date;
}

export interface VehicleTrackCache {
  computedAt: Date;
  elapsedSeconds: number;
  payloadGeojson: any;
  meta?: any;
}

export interface VehicleTrackDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  label: string;
  vehicleType: VehicleTrackVehicleType;
  origin: VehicleTrackOrigin;
  startedAt: Date;
  maxDurationSeconds: number;
  trafficRefreshSeconds: number;
  status: VehicleTrackStatus;
  algorithm: VehicleTrackAlgorithm;
  lastComputedAt?: Date;
  cache?: VehicleTrackCache;
  createdAt: Date;
  updatedAt: Date;
}

const VehicleTrackSchema = new Schema<VehicleTrackDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
    label: { type: String, required: true },
    vehicleType: {
      type: String,
      required: true,
      enum: ['car', 'motorcycle', 'scooter', 'truck', 'unknown'],
      default: 'unknown',
    },
    origin: {
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
    startedAt: { type: Date, required: true, default: () => new Date() },
    maxDurationSeconds: { type: Number, required: true, default: 3600 },
    trafficRefreshSeconds: { type: Number, required: true, default: 60 },
    status: {
      type: String,
      required: true,
      enum: ['active', 'stopped', 'expired'],
      default: 'active',
    },
    algorithm: {
      type: String,
      required: true,
      enum: ['mvp_isoline', 'road_graph'],
      default: 'mvp_isoline',
    },
    lastComputedAt: { type: Date, required: false },
    cache: {
      type: {
        computedAt: { type: Date, required: false },
        elapsedSeconds: { type: Number, required: false },
        payloadGeojson: { type: Schema.Types.Mixed, required: false },
        // meta contient les informations spécifiques à l'algorithme utilisé
        // pour la piste véhicule, par exemple l'état interne du moteur
        // road_graph (frontier, tiles, traffic cache, etc.).
        meta: { type: Schema.Types.Mixed, required: false },
      },
      required: false,
      default: undefined,
    },
  },
  {
    collection: 'vehicleTracks',
    timestamps: true,
  }
);

VehicleTrackSchema.index({ missionId: 1, status: 1, updatedAt: -1 });
VehicleTrackSchema.index({ missionId: 1, createdAt: -1 });

export const VehicleTrackModel = mongoose.model<VehicleTrackDoc>('VehicleTrack', VehicleTrackSchema);
