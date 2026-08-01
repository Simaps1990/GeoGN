import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { PersonCaseModel } from './personCase.js';
import { VehicleTrackModel } from './vehicleTrack.js';

// "Camion" est désormais une vraie valeur de personCase.mobility (avant, l'UI la
// mappait silencieusement sur 'car' tout en créant une piste vehicleType 'truck').
test("personCase.mobility accepts 'truck' and still rejects unknown values", () => {
  const base = {
    missionId: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(),
    lastKnown: { type: 'address', query: '1 rue de la Paix' },
    sex: 'unknown',
    healthStatus: 'stable',
  };

  for (const mobility of ['none', 'bike', 'scooter', 'motorcycle', 'car', 'truck']) {
    const err = new PersonCaseModel({ ...base, mobility }).validateSync();
    assert.equal(err?.errors?.mobility, undefined, `mobility '${mobility}' should be valid`);
  }

  const bad = new PersonCaseModel({ ...base, mobility: 'helicopter' }).validateSync();
  assert.ok(bad?.errors?.mobility, "mobility 'helicopter' should be rejected");
});

// Le facteur de vitesse vélo se déduit du vehicleType : encore faut-il que 'bike'
// soit une valeur stockable (avant ce correctif, un vélo était persisté 'motorcycle').
test("vehicleTrack.vehicleType accepts 'bike' and still rejects unknown values", () => {
  const base = {
    missionId: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(),
    label: 'Vélo',
    origin: { type: 'address', query: '1 rue de la Paix' },
  };

  for (const vehicleType of ['car', 'motorcycle', 'scooter', 'truck', 'bike', 'unknown']) {
    const err = new VehicleTrackModel({ ...base, vehicleType }).validateSync();
    assert.equal(err?.errors?.vehicleType, undefined, `vehicleType '${vehicleType}' should be valid`);
  }

  const bad = new VehicleTrackModel({ ...base, vehicleType: 'tank' }).validateSync();
  assert.ok(bad?.errors?.vehicleType, "vehicleType 'tank' should be rejected");
});
