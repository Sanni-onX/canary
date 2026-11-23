import {parseUnits} from 'viem';
export function parseExactAmount(input:string,decimals:number):bigint{
 if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Unsupported asset decimals.');
 if(input.length>120)throw new Error('Amount is too large.');
 const match=/^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(input);
 if(!match||(match[2]?.length??0)>decimals)throw new Error(`Enter an exact decimal amount with at most ${decimals} decimal places.`);
 const amount=parseUnits(input,decimals);if(amount<=0n)throw new Error('Enter a positive amount.');if(amount>2n**256n-1n)throw new Error('Amount exceeds the supported range.');return amount;
}
