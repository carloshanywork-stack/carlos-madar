import assert from 'node:assert/strict';
import test from 'node:test';
import { groupRouteMachinesByRegion } from '../client/src/modules/rep/route-folders.js';

test('rep folders remain alphabetical by region and machine name regardless of GPS or approval state', () => {
  const route = [
    { regionName: 'الزمالك', machines: [
      { cardId: 3, machineCode: 'M-3', arabicName: 'يوسف', isLocationLocked: false },
      { cardId: 2, machineCode: 'M-2', arabicName: 'أحمد', latitude: 30, longitude: 31, isLocationLocked: true },
    ] },
    { regionName: 'الدقي', machines: [
      { cardId: 4, machineCode: 'M-4', arabicName: 'محمد', isLocationLocked: false },
      { cardId: 1, machineCode: 'M-1', arabicName: 'أحمد', isLocationLocked: true },
    ] },
  ];
  const folders = groupRouteMachinesByRegion(route);
  assert.deepEqual(folders.map(({ regionName }) => regionName), ['الدقي', 'الزمالك']);
  assert.deepEqual(folders[0].machines.map(({ cardId }) => cardId), [1, 4]);
  assert.deepEqual(folders[1].machines.map(({ cardId }) => cardId), [2, 3]);
  assert.equal(folders[1].machines[1].isLocationLocked, false);
  assert.deepEqual(groupRouteMachinesByRegion(route, (machine) => machine.cardId === 3)
    .map(({ regionName, machines }) => [regionName, machines[0].cardId]), [['الزمالك', 3]]);
});
