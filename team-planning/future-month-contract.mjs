/**
 * Future month team/leader assignment — pure contract, no DB reads/writes.
 * A live scheduler MUST authenticate company owner, transact these patches,
 * and record execution status. This module never modifies past records.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DATE=/^\d{4}-\d{2}(-\d{2})?$/;
const stop=c=>{throw Error("FUTURE_TEAM_PLAN_STOP_"+c);};
const checkId=(id,label)=>{if(typeof id!=="string"||!ID.test(id))stop(label);return id;};
const validMonth=x=>{
 if(typeof x!=="string"||!DATE.test(x)||x.length!==7)stop("MONTH");
 const d=new Date(x+"-01T00:00:00Z");
 if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,7)!==x)stop("MONTH");
 return x;
};
const has=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const validRole=x=>x==="leader"||x==="member";

/**
 * Store only requested overrides. Omitted teamId/role means inherit the
 * last effective assignment. Explicit teamId:null means "unassigned".
 * Does not write any current user/team/record/revenue fields.
 */
export function buildMonthlyDraft({actor,companyId,month,overrides=[]}){
 checkId(companyId,"COMPANY");
 validMonth(month);
 if(!actor||actor.serverVerified!==true||actor.companyId!==companyId||
    actor.companyRole!=="owner")stop("OWNER_ONLY");
 if(!Array.isArray(overrides)||overrides.length>200)stop("OVERRIDES");
 const seen=new Set(),items=[];
 for(const row of overrides){
  if(!row||typeof row!=="object"||Array.isArray(row))stop("ROW");
  const keys=Object.keys(row);
  if(keys.some(k=>!["uid","teamId","role"].includes(k))||!has(row,"uid")||
     (!has(row,"teamId")&&!has(row,"role")))stop("FIELDS");
  const uid=checkId(row.uid,"UID");
  if(seen.has(uid))stop("DUPLICATE");seen.add(uid);
  const value={uid};
  if(has(row,"teamId")){
   if(row.teamId!==null)checkId(row.teamId,"TEAM");
   value.teamId=row.teamId;
  }
  if(has(row,"role")){
   if(!validRole(row.role))stop("ROLE");
   value.role=row.role;
  }
  if(value.role==="leader"&&value.teamId===null)stop("LEADER_UNASSIGNED");
  items.push(Object.freeze(value));
 }
 return Object.freeze({companyId,month,planId:companyId+"_"+month,
  state:"draft",items:Object.freeze(items)});
}
export function confirmMonthlyDraft(plan){
 if(!plan||plan.state!=="draft"||!validMonth(plan.month)||
    !Array.isArray(plan.items))stop("CONFIRM");
 return Object.freeze({...plan,state:"confirmed"});
}
/**
 * A caller-supplied clock MUST be derived from Asia/Tokyo, not UTC. Applying
 * early is rejected. This returns patches (not DB mutation).
 *
 * Preserve every pre-existing teamHistory entry, including deleted teams.
 * The existing deployed Rules caps history to 100, so STOP instead of
 * silently losing old history. A separate append-only history migration is
 * required for people exceeding this bound.
 */
export function prepareMonthActivation({plan,jstDate,people,validTeamIds}){
 if(!plan||plan.state!=="confirmed"||!validMonth(plan.month)||
    typeof jstDate!=="string"||!DATE.test(jstDate)||jstDate.length!==10)
    stop("NOT_CONFIRMED_OR_DATE");
 const d=new Date(jstDate+"T00:00:00Z");
 if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==jstDate)
   stop("CLOCK_INVALID");
 const since=plan.month+"-01";
 if(jstDate<since)stop("TOO_EARLY");
 // This schedule is effective on the first of its month. Allowing a later
 // activation would backdate new membership over days of already-saved sales.
 // Any late recovery needs explicit Owner review and independent record audit.
 if(jstDate>since)stop("LATE_ACTIVATION_REQUIRES_MANUAL_REVIEW");
 if(!Array.isArray(people)||!Array.isArray(validTeamIds))stop("INPUTS");
 const available=new Set(validTeamIds.map(x=>checkId(x,"TEAM")));
 const byId=new Map(people.map(p=>[p.uid,p]));
 if(byId.size!==people.length)stop("DUPLICATE_PEOPLE");
 const patches=[];
 for(const item of plan.items){
  const person=byId.get(item.uid);
  if(!person||person.active!==true||person.companyRole==="owner")
    stop("MISSING_OR_OWNER_PERSON");
  const teamId=has(item,"teamId")?item.teamId:(person.teamId??null);
  if(teamId!==null&&!available.has(teamId))stop("NONEXISTENT_TEAM");
  const role=has(item,"role")?item.role:person.role;
  if(!validRole(role)||role==="leader"&&teamId===null)stop("ROLE_TEAM_MISMATCH");
  const previousTeam=person.teamId??null;
  const previousRole=person.role;
  const teamChanges=previousTeam!==teamId;
  const roleChanges=previousRole!==role;
  const history=Array.isArray(person.teamHistory)?
    person.teamHistory.map(entry=>({...entry})):[];
  if(history.some(h=>!h||typeof h.effectiveDate!=="string"))
    stop("CORRUPT_HISTORY");
  // Existing future-dated team history must not be silently overridden.
 // Historical records are immutable: fail rather than create a conflicting
 // timeline with two scheduled assignments effective after this month.
 if(history.some(h=>h.effectiveDate>since))stop("FUTURE_HISTORY_CONFLICT");
 const atDate=history.find(h=>h.effectiveDate===since);
  if(atDate&&atDate.toTeamId!==teamId)stop("CONFLICTING_HISTORY");
  if(teamChanges&&!atDate){
    history.push({effectiveDate:since,fromTeamId:previousTeam,toTeamId:teamId});
    history.sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
  }
  if(history.length>100)stop("HISTORY_CAP_MIGRATION_REQUIRED");
  if(!teamChanges&&!roleChanges)continue;
  // A repeated activation can never replace a newer manual team/role change.
  if(person.lastScheduledPlanId===plan.planId)continue;
  patches.push(Object.freeze({uid:item.uid,teamId,role,
    teamHistory:Object.freeze(history),
    lastScheduledPlanId:plan.planId,companyId:plan.companyId}));
 }
 return Object.freeze({planId:plan.planId,effectiveDate:since,
  patches:Object.freeze(patches)});
}
