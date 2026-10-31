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
 // A serialized plan must retain its original company and canonical month ID.
 // Do not generate foreign company patches from a forged confirmed plan.
 if(typeof plan.companyId!=="string"||!ID.test(plan.companyId)||
    plan.planId!==plan.companyId+"_"+plan.month||!Array.isArray(plan.items))
   stop("PLAN_SCOPE");
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
  // Older member snapshots may omit companyId, but any explicit foreign
  // company identifier is a hard stop; never rewrite their team history.
  if(person.companyId!=null&&person.companyId!==plan.companyId)
    stop("FOREIGN_COMPANY_PERSON");
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

/**
 * Additional next-month goal reservation contract. The legacy app already stores
 * count goals in "goals" and money goals in "revenueGoals"; they MUST remain
 * separate. This module only prepares documents for an authenticated Owner's
 * future transaction. Never persist or change any historical sales here.
 *
 * In particular, it is unsafe to write "targetRevenue" into the count goal:
 * partner/leader count views must never receive a price-bearing field.
 */
const own=(x,key)=>Object.prototype.hasOwnProperty.call(x,key);
function isSafeGoalMap(value){
 return value && typeof value==="object"&&!Array.isArray(value)&&
   (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
}
export function buildFutureGoalDraft({actor,companyId,month,goals=[]}){
 checkId(companyId,"COMPANY");validMonth(month);
 if(!actor||actor.serverVerified!==true||actor.companyId!==companyId||
    actor.companyRole!=="owner"||typeof actor.uid!=="string"||!ID.test(actor.uid))
   stop("OWNER_ONLY");
 if(!Array.isArray(goals)||goals.length>100)stop("GOALS");
 const seen=new Set(),items=[];
 for(const row of goals){
   if(!row||typeof row!=="object"||Array.isArray(row)||
      Object.keys(row).some(k=>!["teamId","targets","targetRevenue"].includes(k))||
      !own(row,"teamId")||(!own(row,"targets")&&!own(row,"targetRevenue")))
     stop("GOAL_FIELDS");
   const teamId=checkId(row.teamId,"TEAM");
   if(seen.has(teamId))stop("DUPLICATE_TEAM_GOAL");
   seen.add(teamId);
   const item={teamId};
   if(own(row,"targets")){
     if(!isSafeGoalMap(row.targets)||Object.keys(row.targets).length>100)
       stop("PRODUCT_TARGETS");
     const targets=Object.create(null);
     for(const [pid,n] of Object.entries(row.targets)){
       checkId(pid,"PRODUCT");
       if(!Number.isSafeInteger(n)||n<0||n>999999)stop("COUNT_TARGET");
       // Preserve existing goal format and product IDs, not names or CB.
       if(n>0)targets[pid]=n;
     }
     item.targets=Object.freeze(targets);
   }
   if(own(row,"targetRevenue")){
     if(!Number.isSafeInteger(row.targetRevenue)||row.targetRevenue<0||
        row.targetRevenue>999999999999)stop("REVENUE_TARGET");
     item.targetRevenue=row.targetRevenue;
   }
   items.push(Object.freeze(item));
 }
 return Object.freeze({companyId,month,planId:companyId+"_"+month,
   kind:"team-goals",state:"draft",ownerUid:actor.uid,
   items:Object.freeze(items)});
}
export function confirmFutureGoalDraft(plan){
 if(!plan||plan.kind!=="team-goals"||plan.state!=="draft"||
    !validMonth(plan.month)||!Array.isArray(plan.items)||!plan.companyId||
    !ID.test(plan.companyId))stop("GOALS_CONFIRM");
 return Object.freeze({...plan,state:"confirmed"});
}
/**
 * A future goal is RESERVED before its month begins. Existing goal documents
 * are not overwritten: the UI/admin must explicitly resolve any conflicts.
 * The server must reverify Owner claims, active team membership, existing
 * documents and revision preconditions in one transaction before any writes.
 */
export function prepareFutureGoalReservations({
 plan,jstDate,activeTeamIds,existingGoals=[],existingRevenueGoals=[]
}){
 if(!plan||plan.kind!=="team-goals"||plan.state!=="confirmed"||
   !Array.isArray(plan.items)||typeof plan.companyId!=="string"||
   !ID.test(plan.companyId))stop("GOALS_NOT_CONFIRMED");
 validMonth(plan.month);
 // Fail closed on fabricated/rebound confirmed plans before building any
 // future goal documents. Owner still MUST be reverified by the server.
 if(plan.planId!==plan.companyId+"_"+plan.month||
    typeof plan.ownerUid!=="string"||!ID.test(plan.ownerUid))
   stop("GOAL_PLAN_SCOPE");
 if(typeof jstDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(jstDate)||
   !Number.isFinite(Date.parse(jstDate+"T00:00:00Z"))||
   new Date(jstDate+"T00:00:00Z").toISOString().slice(0,10)!==jstDate)
   stop("GOAL_CLOCK");
 if(jstDate>=plan.month+"-01")stop("GOAL_RESERVATION_TOO_LATE");
 if(!Array.isArray(activeTeamIds)||!Array.isArray(existingGoals)||
    !Array.isArray(existingRevenueGoals))stop("GOAL_INPUTS");
 const teamIds=new Set(activeTeamIds.map(x=>checkId(x,"ACTIVE_TEAM")));
 if(teamIds.size!==activeTeamIds.length)stop("DUPLICATE_ACTIVE_TEAM");
 const countGoals=[],revenueGoals=[],seen=new Set();
 for(const item of plan.items){
   if(!item||Object.keys(item).some(k=>!["teamId","targets","targetRevenue"].includes(k))||
      !ID.test(item.teamId||"")||seen.has(item.teamId)||
      (!own(item,"targets")&&!own(item,"targetRevenue")))
     stop("INVALID_GOAL_ITEM");
   seen.add(item.teamId);
   if(!teamIds.has(item.teamId))stop("INACTIVE_TEAM_GOAL");
   const id=plan.companyId+"_"+item.teamId+"_"+plan.month;
   if(own(item,"targets")){
     if(!isSafeGoalMap(item.targets)||Object.keys(item.targets).length>100)
       stop("INVALID_COUNT_TARGETS");
     const targets=Object.create(null);
     for(const [pid,n] of Object.entries(item.targets)){
       checkId(pid,"PRODUCT");
       if(!Number.isSafeInteger(n)||n<=0||n>999999)
         stop("INVALID_COUNT_TARGET");
       targets[pid]=n;
     }
     if(existingGoals.some(g=>g&&g.id===id||
        g&&g.companyId===plan.companyId&&g.teamId===item.teamId&&g.month===plan.month))
       stop("COUNT_GOAL_ALREADY_EXISTS");
     countGoals.push(Object.freeze({id,companyId:plan.companyId,
       teamId:item.teamId,month:plan.month,targets:Object.freeze(targets)}));
   }
   if(own(item,"targetRevenue")){
     if(!Number.isSafeInteger(item.targetRevenue)||item.targetRevenue<0||
        item.targetRevenue>999999999999)stop("INVALID_REVENUE_TARGET");
     if(existingRevenueGoals.some(g=>g&&g.id===id||
        g&&g.companyId===plan.companyId&&g.teamId===item.teamId&&g.month===plan.month))
       stop("REVENUE_GOAL_ALREADY_EXISTS");
     revenueGoals.push(Object.freeze({id,companyId:plan.companyId,
       teamId:item.teamId,month:plan.month,targetRevenue:item.targetRevenue}));
   }
 }
 return Object.freeze({planId:plan.planId,month:plan.month,
   countGoals:Object.freeze(countGoals),revenueGoals:Object.freeze(revenueGoals)});
}
