import test from 'node:test';
import assert from 'node:assert/strict';
import {operationNotification} from '../client/src/lib/operation-notifications.js';
test('supervisor receives business notifications but not GPS or reconciliation spam',()=>{
 assert.equal(operationNotification({type:'rep.tracking.updated',userId:1}),null);
 assert.equal(operationNotification({type:'system.reconcile-required'}),null);
 for(const type of ['attendance.changed','rep.visit.submitted','rep.machine.location-requested','rep.machine.correction-submitted','rep.visit.reviewed']) {
  const notification=operationNotification({id:7,type,userId:1,action:'out'});assert.equal(notification.id,7);assert.ok(notification.text);assert.ok(notification.href.startsWith('/'));
 }
 assert.match(operationNotification({type:'attendance.changed',action:'out'}).text,/الانصراف/);
});
