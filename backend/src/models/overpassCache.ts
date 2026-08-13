import mongoose, { Schema } from 'mongoose';

export interface OverpassCacheDoc {
  _id: mongoose.Types.ObjectId;
  key: string;
  elements: unknown[];
  expiresAt: Date;
  purgeAt: Date;
}

const OverpassCacheSchema = new Schema<OverpassCacheDoc>(
  {
    key: { type: String, required: true, unique: true },
    elements: { type: [Schema.Types.Mixed], required: true },
    // Date "fraîcheur" : au-delà, on retente les miroirs — mais on garde le
    // document pour le stale-serving (voir routes/overpass.ts) si la cascade échoue.
    expiresAt: { type: Date, required: true },
    // Date de purge réelle = expiresAt + fenêtre stale (90 j). C'est CE champ qui
    // porte le TTL Mongo, pas expiresAt : on ne veut jamais que Mongo supprime le
    // document tant qu'il peut encore servir de secours.
    purgeAt: { type: Date, required: true },
  },
  { collection: 'overpass_cache' }
);

OverpassCacheSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const OverpassCacheModel = mongoose.model<OverpassCacheDoc>('OverpassCache', OverpassCacheSchema);
