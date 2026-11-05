import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('pera-bridge.js','utf8'),PERA='https://pera-compass.ajmillertperez562.chatgpt.site';
function harness(saved,grant){
 const values=new Map();if(saved)values.set('crp',JSON.stringify(saved));if(grant)values.set('pera-bridge-approval:v1',JSON.stringify({origin:PERA,source:'reserve',currency:'USD'}));
 const listeners={},messages=[],nodes=[];
 const make=tag=>{const e={tag,style:{},hidden:false,textContent:'',events:{},setAttribute(){},addEventListener(t,f){this.events[t]=f},append(...children){this.children=children},prepend(){}};nodes.push(e);return e};
 const fields=Object.fromEntries(['spend','spendPeriod','assets','t-buffersub'].map(k=>[k,make('input')]));fields['t-buffersub'].textContent='24 months · fixed rule';
 const opener={postMessage:(m,o)=>messages.push({m,o})},window={opener,addEventListener(t,f){listeners[t]=f}};window.top=window;
 const localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 vm.runInNewContext(source,{window,document:{getElementById:id=>fields[id],createElement:make,body:{prepend(){}}},localStorage,Date,Number,Object,Array,String});
 return {messages,values,fields,nodes,window,request(origin=PERA,target=opener,id='request-1234'){listeners.message({origin,source:target,data:{type:'pera-finance:request',version:1,requestId:id}})},click(text){nodes.find(n=>n.textContent===text).events.click()}};
}
test('wrong origin, wrong source, iframe and invalid request IDs never export',()=>{for(const mode of ['origin','source','frame','id']){const h=harness({spend:'6000',assets:'200000'},true);if(mode==='frame')h.window.top={};h.request(mode==='origin'?'https://evil.test':PERA,mode==='source'?{}:h.window.opener,mode==='id'?'bad':'request-1234');assert.equal(h.messages.length,0)}});
test('a source user must approve before first data disclosure',()=>{const h=harness({spend:'6000',spendPeriod:'month',assets:'200000'});h.request();assert.equal(h.messages[0].m.status,'consent-required');assert.equal(h.messages[0].m.payload,undefined);h.click('Connect USD assumptions to Pera Compass');const m=h.messages.at(-1).m;assert.equal(m.type,'pera-finance:snapshot');assert.equal(m.payload.reserve.monthly,6000);assert.equal(m.payload.reserve.currency,'USD');assert.equal(m.payload.assetAssumption,null)});
test('auto-saved default examples never become real assumptions',()=>{const h=harness({spend:'5000',spendPeriod:'month',assets:'200000',dob:'1990-10-04'},true);h.request();assert.equal(h.messages[0].m.status,'no-data');assert.equal(Object.keys(h.messages[0].m.payload).length,0)});
test('trusted user edits can explicitly retain an amount equal to a default',()=>{const h=harness({spend:'5000',spendPeriod:'month',assets:'200000'},true);h.fields.spend.events.input({isTrusted:true});h.request();assert.equal(h.messages[0].m.payload.reserve.monthly,5000);assert.equal(h.messages[0].m.payload.currency,'USD')});
test('programmatic events do not mark default values as user data',()=>{const h=harness({spend:'5000',spendPeriod:'month',assets:'200000'},true);h.fields.spend.events.input({isTrusted:false});h.request();assert.equal(h.messages[0].m.status,'no-data')});
test('annual spending normalizes monthly and sensitive source fields are omitted',()=>{const h=harness({spend:'120000',spendPeriod:'year',assets:'350000',dob:'1990-10-04',token:'SECRET',email:'private@example.test'},true);h.request();const m=h.messages[0].m;assert.equal(m.payload.reserve.monthly,10000);assert.equal(m.payload.assetAssumption,350000);assert.equal(JSON.stringify(m).includes('SECRET'),false);assert.equal(JSON.stringify(m).includes('1990-10-04'),false);assert.equal(JSON.stringify(m).includes('private@example.test'),false);assert.equal(h.messages[0].o,PERA)});
test('revoke prevents further snapshots and reports disconnected state',()=>{const h=harness({spend:'9000',spendPeriod:'month',assets:'200000'},true);h.request();h.click('Disconnect Pera Compass');const count=h.messages.length;h.request();assert.equal(h.messages.length,count+1);assert.equal(h.messages.at(-1).m.status,'consent-required');assert.equal(h.values.has('pera-bridge-approval:v1'),false)});
