import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const R="/home/claude/m1/repo/docs/momentum/";
const strip=s=>s;
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;

create table integration_settings(key text primary key, value text);
create table scheduled_group_posts(id uuid primary key default gen_random_uuid(), last_attempt_at timestamptz, target_group_jid text, status text);
create table maytapi_messages(id uuid primary key default gen_random_uuid(), conversation_key text, direction text, received_at timestamptz);
create table content_items(id uuid primary key default gen_random_uuid(), status text, version int default 1, source_changed boolean default false, held boolean default false, body text);
create table content_deliveries(id uuid primary key default gen_random_uuid(), content_item_id uuid, destination_name text, destination_jid text, order_index int, planned_at timestamptz, post_id uuid, status text default 'planned', idempotency_key text unique, last_error text);
create table content_audit_log(id bigserial primary key, at timestamptz default now(), actor text, event text, detail jsonb);
create or replace function public.momentum_min_interval() returns interval language sql stable as $$ select interval '120 minutes' $$;
insert into integration_settings values ('momentum_nugget_target_groups','[{"name":"A","jid":"1@g.us"},{"name":"B","jid":"2@g.us"},{"name":"C","jid":"3@g.us"}]');
`);
await db.exec(strip(fs.readFileSync(R+"momentum_plan_exact_and_retime.sql.PROPOSED","utf8")));
await db.exec(strip(fs.readFileSync(R+"momentum_distribution_memory.sql.PROPOSED","utf8")));
const ok=(c,m)=>{ if(!c){console.log("FAIL",m);process.exitCode=1} else console.log("PASS",m)};
const err=async q=>{try{await db.query(q);return null}catch(e){return e.message}};
const mk=async(st='approved')=>(await db.query(`insert into content_items(status,body) values ('${st}','x') returning id`)).rows[0].id;
const D="2030-01-07T";
const n1=await mk('draft'), n2=await mk('approved');
const rec=(item,jid,st,conf,ev,at='2026-11-14T13:09:00Z',origin='manual_whatsapp',stmt='null')=>`select * from momentum_record_distribution('${item}','${jid}','${origin}','${ev}','${st}','${conf}',${at?`'${at}'`:'null'},null,${stmt},'tester')`;
// record verified (acceptance: manual post in group 1)
let r=(await db.query(rec(n1,'1@g.us','verified','confirmed','screenshot DM 15:09 14 Nov',undefined,'external_evidence',`'Vanto: I posted Nugget 1 in Duplication Movement at 15:09'`))).rows[0];
ok(r.outcome==='recorded','verified record created');
// idempotent
r=(await db.query(rec(n1,'1@g.us','verified','confirmed','screenshot DM 15:09 14 Nov',undefined,'external_evidence',`'Vanto: I posted Nugget 1 in Duplication Movement at 15:09'`))).rows[0];
ok(r.outcome==='already_recorded','repeat = already_recorded');
r=(await db.query(rec(n1,'1@g.us','verified','exact','hub_post:abc12345'))).rows[0];
ok(r.outcome==='already_verified','second verified evidence for same item+group not duplicated');
ok((await db.query(`select count(*)::int c from content_distributions where content_item_id='${n1}'`)).rows[0].c===1,'exactly 1 row');
// per group isolation
ok((await db.query(`select count(*)::int c from content_distributions where content_item_id='${n1}' and group_jid<>'1@g.us'`)).rows[0].c===0,'no record for other groups');
// guards
ok(/not an allow-listed/.test(await err(rec(n1,'9@g.us','verified','exact','abcdefg')) ?? ''),'non-allow-listed group refused');
ok(/needs the actual distribution time/.test(await err(rec(n1,'2@g.us','verified','exact','abcdefg',null)) ?? ''),'verified needs time');
ok(/future/.test(await err(rec(n1,'2@g.us','verified','exact','abcdefg','2099-01-01T00:00:00Z')) ?? ''),'future time refused');
ok(/statement/.test(await err(rec(n1,'2@g.us','verified','confirmed','abcdefg',undefined,'external_evidence')) ?? ''),'external needs statement');
ok(/evidence/.test(await err(rec(n1,'2@g.us','verified','exact','ab')) ?? ''),'evidence required');
ok(/candidate cannot/.test(await err(rec(n1,'2@g.us','candidate','exact','abcdefg')) ?? ''),'candidate cannot be exact');
// candidate then upgrade
r=(await db.query(rec(n1,'2@g.us','candidate','approximate','maytapi:m1',null))).rows[0]; ok(r.outcome==='recorded','candidate recorded');
r=(await db.query(rec(n1,'2@g.us','candidate','approximate','maytapi:m1',null))).rows[0]; ok(r.outcome==='already_recorded','candidate idempotent');
r=(await db.query(rec(n1,'2@g.us','verified','normalised','maytapi:m1'))).rows[0]; ok(r.outcome==='upgraded','candidate upgraded to verified by same evidence');
// retract + reinstate
const id1=(await db.query(`select id from content_distributions where content_item_id='${n1}' and group_jid='2@g.us'`)).rows[0].id;
r=(await db.query(`select * from momentum_retract_distribution('${id1}','mistaken','tester')`)).rows[0]; ok(r.outcome==='retracted','retracted');
r=(await db.query(`select * from momentum_retract_distribution('${id1}','mistaken','tester')`)).rows[0]; ok(r.outcome==='already_retracted','retract idempotent');
ok(/reason/.test(await err(`select * from momentum_retract_distribution('${id1}','','t')`)??''),'retract needs reason');
r=(await db.query(rec(n1,'2@g.us','verified','normalised','maytapi:m1'))).rows[0]; ok(r.outcome==='reinstated','reinstated');
// audit
const ev=(await db.query(`select event, count(*)::int c from content_audit_log group by 1`)).rows; console.log(JSON.stringify(ev));
ok(ev.find(e=>e.event==='distribution_recorded').c>=2,'audit rows for records');
// planning: n2 approved, verified in group1 -> refused
await db.query(rec(n2,'1@g.us','verified','confirmed','shot 1234',undefined,'external_evidence',`'Vanto confirmed posting it'`));
const dests=`'[{"name":"A","jid":"1@g.us"},{"name":"B","jid":"2@g.us"},{"name":"C","jid":"3@g.us"}]'::jsonb`;
let e=await err(`select * from momentum_plan_exact('${n2}', ${dests}, '${D}09:15:00Z','t')`); ok(/already_distributed: A/.test(e??''),'plan refuses verified group: '+e);
ok((await db.query(`select count(*)::int c from content_deliveries where content_item_id='${n2}'`)).rows[0].c===0,'nothing half-planned');
// partial plan with explicit slots keeps allow-list order_index
const part=`'[{"name":"B","jid":"2@g.us","at":"${D}09:25:00Z"},{"name":"C","jid":"3@g.us","at":"${D}09:35:00Z"}]'::jsonb`;
r=await db.query(`select * from momentum_plan_exact('${n2}', ${part}, '${D}09:25:00Z','t')`); ok(r.rows.length===2&&r.rows.every(x=>x.outcome==='planned'),'partial plan for the 2 other groups');
const t=(await db.query(`select destination_jid j, order_index o, to_char(planned_at at time zone 'UTC','HH24:MI') t from content_deliveries where content_item_id='${n2}' order by order_index`)).rows;
ok(JSON.stringify(t.map(x=>[x.j,x.o,x.t]))===JSON.stringify([['2@g.us',2,'09:25'],['3@g.us',3,'09:35']]),'slots 09:25/09:35 and order_index 2,3 kept');
r=await db.query(`select * from momentum_plan_exact('${n2}', ${part}, '${D}09:25:00Z','t')`); ok(r.rows.every(x=>x.outcome==='already_planned'),'re-plan idempotent');
// no-"at" path unchanged
const n3=await mk(); r=await db.query(`select * from momentum_plan_exact('${n3}', ${dests}, '${D}13:00:00Z','t')`);
ok(JSON.stringify((await db.query(`select to_char(planned_at at time zone 'UTC','HH24:MI') t from content_deliveries where content_item_id='${n3}' order by order_index`)).rows.map(x=>x.t))==='["13:00","13:10","13:20"]','legacy path: first_at + 10 min x index');
// coverage
await db.query(`insert into maytapi_messages(conversation_key,direction,received_at) values ('2@g.us','inbound','2026-11-13T10:00:00Z'),('2@g.us','inbound','2026-11-01T10:00:00Z')`);
const cov=(await db.query(`select * from momentum_distribution_coverage()`)).rows;
ok(cov.length===3 && cov.find(c=>c.group_jid==='2@g.us').inbound_messages==2n+0n||Number(cov.find(c=>c.group_jid==='2@g.us').inbound_messages)===2,'coverage counts');
ok(cov.every(c=>Number(c.outbound_messages)===0),'outbound not captured');
// existing retime still works
const t2=await mk(); await db.query(`insert into content_deliveries(content_item_id,destination_name,destination_jid,order_index,planned_at,idempotency_key) values ('${t2}','A','1@g.us',1,'2030-02-01T09:01:00Z','k1'),('${t2}','B','2@g.us',2,'2030-02-01T09:11:00Z','k2')`);
r=await db.query(`select * from momentum_retime_item('${t2}','2030-02-01T09:15:00Z','t')`); ok(r.rows.length===2,'retime unaffected');
