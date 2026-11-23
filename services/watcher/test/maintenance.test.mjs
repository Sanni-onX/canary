import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planMaintenance} from '../src/maintenance.ts';
const coverage=(status,expiryHeight)=>({status,expiryHeight,remainingBlocks:'1000',openedHeight:'1',reason:'fixture'});
test('maintenance schedules before expiry, marks overdue and preserves unknown states',()=>{
 const jobs=planMaintenance([{index:0,coverage:coverage('Covered','3000')},{index:1,coverage:coverage('Expiring','2000')},{index:2,coverage:coverage('Lapsed','100')},{index:3,coverage:coverage('Unknown',null)},{index:4,coverage:coverage('Retired','100')}],1000n);
 assert.deepEqual(jobs.map(job=>job.state),['scheduled','due','overdue','investigate']);
 assert.equal(jobs[0].replaceByHeight,'1800');
 assert.equal(jobs[2].replaceByHeight,'0');
 assert.match(jobs[0].action,/fresh/);
});
