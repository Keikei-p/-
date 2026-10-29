/** Admin-only partner activation for ALREADY invited and team-assigned Leaders.
 * No Auth user creation, email invitation, role elevation or historical edits.
 * Returned Firestore writes update ONLY accessKind and are preconditioned on
 * server updateTime so a concurrent user/team change cannot be stamped.
 */
export function partnerActivationWrites({policy,targetUid,user,member,team}){
  const validId=x=>typeof x==="string" && /^[A-Za-z0-9_-]{1,128}$/.test(x);
  if(!policy?.isOwner || policy?.isPartner || !validId(policy?.companyId) ||
      !validId(policy?.uid) || !validId(targetUid) || targetUid===policy.uid)
    throw Error("partner_activation_forbidden");
  const cid=policy.companyId;
  if(!user || !member || !team || user.active===false || member.active===false ||
      team.active===false || user.companyId!==cid || member.companyId!==cid ||
      team.companyId!==cid || user.uid!==targetUid || member.uid!==targetUid ||
      user.companyRole!=="member" || member.companyRole!=="member" ||
      user.role!=="leader" || member.role!=="leader" ||
      !validId(user.teamId) || member.teamId!==user.teamId || team.id!==user.teamId)
    throw Error("partner_target_not_ready");
  if(!user.recordVersion || !member.recordVersion)
    throw Error("partner_target_requires_version");
  if((user.accessKind && user.accessKind!=="partner") ||
     (member.accessKind && member.accessKind!=="partner"))
    throw Error("partner_access_kind_conflict");
  if(user.accessKind==="partner" && member.accessKind==="partner")return [];
  return [
    ["users/"+targetUid,user],
    ["companies/"+cid+"/members/"+targetUid,member]
  ].filter(([,source])=>source.accessKind!=="partner").map(([path,source])=>({
    update:{name:"projects/sales-management-cc116/databases/(default)/documents/"+path,
      fields:{accessKind:{stringValue:"partner"}}},
    updateMask:{fieldPaths:["accessKind"]},
    currentDocument:{updateTime:source.recordVersion}
  }));
}
