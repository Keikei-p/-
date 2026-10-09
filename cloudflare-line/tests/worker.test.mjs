import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSendReminderAt,
  buildReminderOnlyMessage,
  teamForDate,
  missingFromSnapshot,
  pushRetry,
  freeLineGuard
} from '../src/index.js';

test('19:00 start repeats hourly on the same day and stops at midnight', () => {
  assert.equal(shouldSendReminderAt('19:00','18:55'),false);
  assert.equal(shouldSendReminderAt('19:00','19:00'),true);
  assert.equal(shouldSendReminderAt('19:00','19:03'),true); // delayed Cron
  assert.equal(shouldSendReminderAt('19:00','19:05'),false);
  assert.equal(shouldSendReminderAt('19:00','19:30'),false);
  assert.equal(shouldSendReminderAt('19:00','20:00'),true);
  assert.equal(shouldSendReminderAt('19:00','23:00'),true);
  assert.equal(shouldSendReminderAt('19:00','00:00'),false);
  assert.equal(shouldSendReminderAt('19:30','20:30'),true);
  assert.equal(shouldSendReminderAt('19:32','20:32'),false);
  assert.equal(shouldSendReminderAt('garbage','19:00'),false);
});

test('team transfer history is used without mutating a permanent assignment', () => {
  const m={
    teamId:'new',
    teamHistory:[
      {effectiveDate:'2026-10-05',fromTeamId:'old',toTeamId:'new'}
    ]
  };
  const before=JSON.stringify(m);
  assert.equal(teamForDate(m,'2026-10-04'),'old');
  assert.equal(teamForDate(m,'2026-10-05'),'new');
  assert.equal(JSON.stringify(m),before);
});

test('team-any mode clears the reminder after a single report, individual mode does not', () => {
  const members=[
    {id:'u1',name:'一郎',teamId:'a',active:true},
    {id:'u2',name:'次郎',teamId:'a',active:true},
    {id:'u3',name:'退職',teamId:'a',active:false}
  ];
  const teams=[{id:'a',name:'1班'}];
  const date='2026-10-10';
  const noReports=missingFromSnapshot(members,teams,[],date,'team_any');
  assert.equal(noReports.length,1);
  assert.equal(noReports[0].expected,2);
  const records=[{id:'r1',uid:'u1',teamId:'a',date,reportStatus:'submitted'}];
  assert.equal(missingFromSnapshot(members,teams,records,date,'team_any').length,0);
  const individual=missingFromSnapshot(members,teams,records,date,'individual');
  assert.equal(individual.length,1);
  assert.equal(individual[0].reported,1);
  assert.equal(individual[0].expected,2);
  assert.equal(missingFromSnapshot(members,teams,[...records,{id:'r2',uid:'u2',teamId:'a',date}],date,'individual').length,0);
});

test('reminder text omits all financial and performance data', () => {
  const text=buildReminderOnlyMessage([
    {teamName:'1班',reported:0,expected:12,revenue:999999},
    {teamName:'1班'},
    {teamName:'2班'}
  ]);
  assert.match(text,/1班・2班/);
  assert.doesNotMatch(text,/999999|12件|円|売上金額|商材別/);
});

test('LINE push retries use one idempotency key and a 409 accepted response counts as success', async () => {
  const original=globalThis.fetch;
  const calls=[];
  try {
    globalThis.fetch=async (url,opt)=>{
      calls.push({url,headers:opt.headers,body:opt.body});
      if(calls.length===1)return new Response('temporary',{status:500});
      return new Response(JSON.stringify({message:'The retry key is already accepted'}),{
        status:409,
        headers:{'x-line-accepted-request-id':'accepted-id'}
      });
    };
    const attempts=await pushRetry({LINE_CHANNEL_ACCESS_TOKEN:'fake'},'group','確認');
    assert.equal(attempts,2);
    assert.equal(calls.length,2);
    assert.equal(calls[0].headers['X-Line-Retry-Key'],calls[1].headers['X-Line-Retry-Key']);
    assert.match(calls[0].headers['X-Line-Retry-Key'],/^[0-9a-f-]{36}$/);
  } finally {
    globalThis.fetch=original;
  }
});

test('LINE send is blocked before the monthly free cap', async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async url=>{
      if(String(url).endsWith('/quota/consumption'))return Response.json({totalUsage:178});
      if(String(url).endsWith('/members/count'))return Response.json({count:4});
      throw new Error('Unexpected network call: '+url);
    };
    const guard=await freeLineGuard({LINE_CHANNEL_ACCESS_TOKEN:'fake'},'group');
    assert.equal(guard.allowed,false);
    assert.equal(guard.cap,180);
  } finally {
    globalThis.fetch=original;
  }
});
