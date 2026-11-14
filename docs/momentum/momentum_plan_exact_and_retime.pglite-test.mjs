import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
const sql = fs.readFileSync("/home/claude/m1/repo/docs/momentum/momentum_plan_exact_and_retime.sql.PROPOSED","utf8").replace(/revoke all[\s\S]*$/,"");
await db.exec(`
create table integration_settings(key text primary key, value text);
create table scheduled_group_posts(id uuid primary key default gen_random_uuid(), last_attempt_at timestamptz);
create table content_items(id uuid primary key default gen_random_uuid(), status text, version int default 1, source_changed boolean default false, held boolean default false);
create table content_deliveries(id uuid primary key default gen_random_uuid(), content_item_id uuid, destination_name text, destination_jid text, order_index int, planned_at timestamptz, post_id uuid, status text default 'planned', idempotency_key text unique, last_error text);
create table content_audit_log(id bigserial primary key, at timestamptz default now(), actor text, event text, detail jsonb);
create or replace function public.momentum_min_interval() returns interval language plpgsql stable set search_path = public as $$
declare v text; n int;
begin select value into v from integration_settings where key = 'momentum_min_interval_minutes';
  begin n := trim(v)::int; exception when others then n := null; end;
  if n is null or n < 5 then n := 120; end if; return make_interval(mins => n); end $$;
insert into integration_settings values ('momentum_min_interval_minutes','120'),
 ('momentum_nugget_target_groups','[{"name":"A","jid":"1@g.us"},{"name":"B","jid":"2@g.us"},{"name":"C","jid":"3@g.us"}]');
`);
await db.exec(sql);
const ok = (c,m)=>{ if(!c){ console.log("FAIL",m); process.exitCode=1 } else console.log("PASS",m) };
const err = async (q)=>{ try{ await db.query(q); return null }catch(e){ return e.message } };
const D = "2030-01-"; // far future, fixed
const dests = `'[{"name":"A","jid":"1@g.us"},{"name":"B","jid":"2@g.us"},{"name":"C","jid":"3@g.us"}]'::jsonb`;
const mkItem = async (st='approved')=> (await db.query(`insert into content_items(status) values ('${st}') returning id`)).rows[0].id;
const t2 = await mkItem(); // teaching 2: existing Wed deliveries at 09:01/11/21 (UTC stand-in)
for (const [k,g,j,m] of [[1,'A','1@g.us','01'],[2,'B','2@g.us','11'],[3,'C','3@g.us','21']])
  await db.query(`insert into content_deliveries(content_item_id,destination_name,destination_jid,order_index,planned_at,idempotency_key) values ('${t2}','${g}','${j}',${k},'${D}09T09:${m}:00Z','${t2}|v1|${j}|1')`);
// 1. plan EARLIER (Monday) while Wednesday exists: exact, no shifting
const n1 = await mkItem();
let r = await db.query(`select * from momentum_plan_exact('${n1}', ${dests}, '${D}07T09:15:00Z', 'test')`);
ok(r.rows.length===3 && r.rows.every(x=>x.outcome==='planned'),'plans 3 deliveries');
const t = (await db.query(`select to_char(planned_at at time zone 'UTC','DD HH24:MI') t from content_deliveries where content_item_id='${n1}' order by order_index`)).rows.map(x=>x.t);
ok(JSON.stringify(t)===JSON.stringify(['07 09:15','07 09:25','07 09:35']),'Monday planned EXACTLY 09:15/25/35 despite later Wednesday ('+t+')');
// 2. idempotent re-run
r = await db.query(`select * from momentum_plan_exact('${n1}', ${dests}, '${D}07T09:15:00Z', 'test')`);
ok(r.rows.every(x=>x.outcome==='already_planned'),'re-run: already_planned');
ok((await db.query(`select count(*) c from content_deliveries where content_item_id='${n1}'`)).rows[0].c==3,'no duplicates');
// 3. conflict inside 120 min refused, nothing half-planned
const n2 = await mkItem();
let e = await err(`select * from momentum_plan_exact('${n2}', ${dests}, '${D}07T10:00:00Z', 'test')`);
ok(e && /slot_conflict/.test(e),'conflict within 120 min refused: '+e);
ok((await db.query(`select count(*) c from content_deliveries where content_item_id='${n2}'`)).rows[0].c==0,'conflict leaves nothing half-planned');
// 4. 120+ min apart is fine
r = await db.query(`select * from momentum_plan_exact('${n2}', ${dests}, '${D}07T11:20:00Z', 'test')`);
ok(r.rows.length===3,'exactly 125 min later accepted');
// 5. unplannable states
const dr = await mkItem('draft'); e = await err(`select * from momentum_plan_exact('${dr}', ${dests}, '${D}10T09:15:00Z')`); ok(e&&/not plannable/.test(e),'draft refused');
const hd = await mkItem(); await db.query(`update content_items set held=true where id='${hd}'`); e = await err(`select * from momentum_plan_exact('${hd}', ${dests}, '${D}10T09:15:00Z')`); ok(e&&/not plannable/.test(e),'held refused');
e = await err(`select * from momentum_plan_exact('${await mkItem()}', '[{"name":"X","jid":"9@g.us"}]'::jsonb, '${D}10T09:15:00Z')`); ok(e&&/destination_not_allowed/.test(e),'non-allowlisted refused');
e = await err(`select * from momentum_plan_exact('${await mkItem()}', ${dests}, now())`); ok(e&&/15 minutes/.test(e),'past/too-soon refused');
// 6. retime Teaching 2 09:01/11/21 -> 09:15/25/35 keeping rows, keys, approval
const before = (await db.query(`select id, idempotency_key from content_deliveries where content_item_id='${t2}' order by order_index`)).rows;
r = await db.query(`select * from momentum_retime_item('${t2}', '${D}09T09:15:00Z', 'test')`);
const after = (await db.query(`select id, idempotency_key, to_char(planned_at at time zone 'UTC','HH24:MI') t from content_deliveries where content_item_id='${t2}' order by order_index`)).rows;
ok(after.map(x=>x.t).join()==='09:15,09:25,09:35','retimed to 09:15/25/35');
ok(JSON.stringify(before.map(x=>[x.id,x.idempotency_key]))===JSON.stringify(after.map(x=>[x.id,x.idempotency_key])),'same delivery rows and idempotency keys (no duplicates)');
ok((await db.query(`select status from content_items where id='${t2}'`)).rows[0].status==='approved','approval untouched');
ok((await db.query(`select count(*) c from content_audit_log where event='retimed'`)).rows[0].c==3,'3 audit rows');
// 7. retime conflict refused, nothing changed
e = await err(`select * from momentum_retime_item('${t2}', '${D}07T09:30:00Z')`); ok(e&&/slot_conflict/.test(e),'retime onto another item\'s slot refused');
ok((await db.query(`select to_char(min(planned_at) at time zone 'UTC','DD HH24:MI') t from content_deliveries where content_item_id='${t2}'`)).rows[0].t==='09 09:15','failed retime changed nothing');
// 8. retime guards
e = await err(`select * from momentum_retime_item('${await mkItem()}', '${D}20T09:15:00Z')`); ok(e&&/no planned deliveries/.test(e),'no planned deliveries refused');
e = await err(`select * from momentum_retime_item('${dr}', '${D}20T09:15:00Z')`); ok(e&&/not retimable/.test(e),'draft not retimable');
await db.query(`update content_deliveries set status='sent' where content_item_id='${t2}' and order_index=1`);
r = await db.query(`select * from momentum_retime_item('${t2}', '${D}09T10:00:00Z')`); ok(r.rows.length===2,'sent deliveries are never moved (only planned)');
