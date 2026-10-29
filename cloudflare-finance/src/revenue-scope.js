// This reproduces the existing browser's canCurrentUserViewRevenueForRecord:
// - Leader: any date from the CURRENT team only
// - Explicitly granted ordinary member: the team assigned ON the record date
// The chart's stricter scope-start calculation must not replace record access.

// Shared GET and POST response authorization. Never infer permission from UI state.
export function visibleMoney(policy,record) {
  if(!policy.canViewRevenue)return false;
  if(policy.isOwner)return true;
  if(!record || !record.teamId || typeof record.date!=="string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.date))return false;
  if(policy.isLeader)return Boolean(policy.teamId && record.teamId===policy.teamId);
  const history=policy.teamHistory||[];
  let assigned=policy.teamId;
  if(history.length){
    assigned=history[0].fromTeamId??null;
    for(const change of history){
      if(change.effectiveDate<=record.date)assigned=change.toTeamId??null;
    }
  }
  return Boolean(assigned && assigned===record.teamId);
}
