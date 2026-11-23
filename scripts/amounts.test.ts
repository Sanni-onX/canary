import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExactAmount} from '../apps/web/lib/amounts';
test('amount entry preserves exact large integers and rejects rounding, exponents and negative values',()=>{
 assert.equal(parseExactAmount('12345678901234567890.123456',6),12345678901234567890123456n);
 assert.equal(parseExactAmount('0.000001',6),1n);
 for(const value of ['0.0000001','-1','1e6',' 1','1.','0','01.2','NaN'])assert.throws(()=>parseExactAmount(value,6));
 assert.throws(()=>parseExactAmount('1',255));
 assert.throws(()=>parseExactAmount((2n**256n).toString(),0));
});
