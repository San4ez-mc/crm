const path=require('path');
const root=path.join(__dirname,'..','apps','api','src','lib')+path.sep; // запуск: node scripts/test-np-stages.cjs (БД і НП підмінені)
const Module=require('module'); const origResolve=Module._resolveFilename;
const stubs={'@crm/db':null,'@crm/logger':{info(){},warn(){}}};
const names=['Презентація товару','Замовлення прийняте','Замовлення оформлене в постачальника','Відправлено','Посилка зберігається на пошті','Не забрав на пошті','Клієнт забрав на пошті','Повернення/обмін','Скасовано'];
const stages=names.map((n,i)=>({id:'s'+i,name:n,pipelineId:'p1',order:i}));
const byName=(n)=>stages.find(s=>s.name===n);
let orders=[], updates=[], npDocs={};
stubs['@crm/db']={db:{
 tenant:{findUnique:async()=>({novaPoshtaApiKey:'k'})},
 pipeline:{findMany:async()=>[{id:'p1',stages}]},
 order:{findMany:async()=>orders,update:async({where,data})=>{updates.push({id:where.id,...data})}},
 stage:{findUnique:async({where})=>stages.find(s=>s.id===where.id)||null},
}};
Module._load=((orig)=>function(req,...a){ if(stubs[req]) return stubs[req]; return orig.call(this,req,...a);})(Module._load);
global.fetch=async(url,opts)=>{const b=JSON.parse(opts.body);return {ok:true,json:async()=>({success:true,data:b.methodProperties.Documents.map(d=>npDocs[d.DocumentNumber])})};};
const np=require(root+'novaPoshta.js'); const ops=require(root+'orderOps.js');
const mk=(id,stage,ttn,isRefused=false)=>({id,ttn:[ttn],ttnStatus:'x',isRefused,stageId:byName(stage).id,stage:{name:stage},contactName:id,buyer:null});
(async()=>{
 const cases=[
  ['supplier+код4 → Відправлено','Замовлення оформлене в постачальника',{StatusCode:'4',Status:'в дорозі'},false,'Відправлено'],
  ['supplier+код1 → без руху','Замовлення оформлене в постачальника',{StatusCode:'1',Status:'створена'},false,null],
  ['Відправлено+код7 → Зберігається','Відправлено',{StatusCode:'7',Status:'у відділенні'},false,'Посилка зберігається на пошті'],
  ['Не забрав(старий arrived)+код7 → Зберігається','Не забрав на пошті',{StatusCode:'7',Status:'у відділенні'},false,'Посилка зберігається на пошті'],
  ['Не забрав+isRefused+код7(нова ТТН) → лишається','Не забрав на пошті',{StatusCode:'7',Status:'у відділенні'},true,null],
  ['Зберігається+код102 → Не забрав','Посилка зберігається на пошті',{StatusCode:'102',Status:'відмова'},false,'Не забрав на пошті'],
  ['Відправлено+код102 → Не забрав','Відправлено',{StatusCode:'102',Status:'відмова'},false,'Не забрав на пошті'],
  ['Не забрав+код9 → Клієнт забрав','Не забрав на пошті',{StatusCode:'9',Status:'отримано'},false,'Клієнт забрав на пошті'],
  ['Повернення/обмін+код102 → Не забрав','Повернення/обмін',{StatusCode:'102',Status:'відмова'},false,'Не забрав на пошті'],
  ['Клієнт забрав+код102 → лишається','Клієнт забрав на пошті',{StatusCode:'102',Status:'відмова'},false,null],
  ['Прийняте+код5 → Відправлено','Замовлення прийняте',{StatusCode:'5',Status:'в дорозі'},false,'Відправлено'],
 ];
 let fail=0;
 for(const [name,stage,doc,ref,want] of cases){
  orders=[mk('o1',stage,'T1',ref)]; npDocs={T1:{Number:'T1',...doc}}; updates=[];
  await np.syncTtnStatuses('t');
  const got=updates[0]&&updates[0].stageId?stages.find(s=>s.id===updates[0].stageId).name:null;
  const ok=got===want; if(!ok)fail++; console.log(ok?'OK  ':'FAIL',name,'→',got);
 }
 // shippedStagePatch
 const sp=async(stage,old,nw)=>{const o={stageId:stage?byName(stage).id:null}; const r=await ops.shippedStagePatch('t',o,old,nw); return r.stageId?stages.find(s=>s.id===r.stageId).name:null;};
 const t2=[['Замовлення прийняте',[],['A'],'Замовлення оформлене в постачальника'],['Замовлення оформлене в постачальника',[],['A'],null],['Відправлено',[],['A'],null],['Посилка зберігається на пошті',[],['A'],null],['Клієнт забрав на пошті',[],['A'],null],['Скасовано',[],['A'],null],['Очікуємо дані та оплату'.replace('Очікуємо дані та оплату','Презентація товару'),[],['A'],'Замовлення оформлене в постачальника'],[null,[],['A'],'Замовлення оформлене в постачальника'],['Замовлення прийняте',['A'],['A'],null]];
 for(const [st,o,n,want] of t2){const got=await sp(st,o,n);const ok=got===want;if(!ok)fail++;console.log(ok?'OK  ':'FAIL','TTN при стадії',st,'→',got);}
 console.log(fail?('FAILED '+fail):'ALL OK');
})();
