import test from "node:test";
import assert from "node:assert/strict";
import {INVITE_KINDS,prepareInviteContract,planInviteAcceptance,validateImmutableInvite} from "../partner/invite-contract.mjs";

const now=Date.parse("2026-10-29T00:00:00Z");
const inviter={uid:"owner",emailLower:"owner@example.com",companyId:"hub",
 companyRole:"owner",active:true,latestMemberVerified:true,canCreateInvite:true};
const hubCompany={id:"hub",ownerUid:"owner",active:true,ownerUidVerified:true};
const draft=(kind=INVITE_KINDS.INTERNAL,changes={})=>
 prepareInviteContract({kind,inviter,hubCompany,recipientEmail:"JOIN@example.COM",
  role:"leader",nowMs:now,...changes});
const recipient={uid:"receiver",emailLower:"join@example.com",emailVerified:true,
 active:true,latestUserVerified:true,companyId:null};
test("invite creator chooses own member vs isolated partner org with no implicit finance",()=>{
 const internal=draft();
 const partner=draft(INVITE_KINDS.PARTNER);
 assert.equal(internal.kind,"internal_member");
 assert.equal(partner.kind,"partner_company");
 assert.equal(partner.role,"leader");
 assert.equal(partner.catalogSourceCompanyId,"hub");
 assert.equal(partner.ownProductDefaultVisibility,"private");
 assert.equal(partner.partnerCountOnly,true);
 assert.equal(partner.canViewRevenue,false);assert.equal(partner.canViewUnitPrice,false);
 assert.equal(partner.expiresAtMs-now,30*60*1000);
 assert(Object.isFrozen(partner));
});
test("partner invite requires verified company owner even when leader can invite employees",()=>{
 for(const override of [
  {inviter:{...inviter,companyRole:"member",canCreateInvite:true}},
  {inviter:{...inviter,uid:"someoneElse"}},
  {inviter:{...inviter,latestMemberVerified:false}},
  {hubCompany:{...hubCompany,ownerUidVerified:false}},
  {hubCompany:{...hubCompany,active:false}},
  {inviter:{...inviter,companyId:"other"}},
  {expiresInMinutes:7*24*60},
  {recipientEmail:"owner@example.com"},
  {recipientEmail:"invalid"},
 ]){
  assert.throws(()=>draft(INVITE_KINDS.PARTNER,override),/Invitation denied/);
 }
 const leader={...inviter,uid:"leader",emailLower:"leader@example.com",
  companyRole:"member",canCreateInvite:true};
 assert.equal(draft(INVITE_KINDS.INTERNAL,{inviter:leader}).kind,INVITE_KINDS.INTERNAL);
});
test("new partner acceptance creates a separate company with count-only privileges",()=>{
 const p=planInviteAcceptance({
  contract:draft(INVITE_KINDS.PARTNER),recipient,nowMs:now+1000,newPartnerCompanyId:"partner123"
 });
 assert.equal(p.operation,"create_isolated_partner_company");
 assert.equal(p.companyId,"partner123");assert.equal(p.hubCompanyId,"hub");
 assert.equal(p.accessKind,"partner");assert.equal(p.companyKind,"partner");
 assert.equal(p.canViewRevenue,false);assert.equal(p.canViewUnitPrice,false);
 assert.equal(p.financialAccessDenied,true);
 assert.equal(p.crossCompanyCountSharingApproved,false);
 assert.equal(p.ownProductDefaultVisibility,"private");
});
test("self invite never creates a new company or financial grant",()=>{
 const p=planInviteAcceptance({contract:draft(),recipient,nowMs:now+1000});
 assert.equal(p.operation,"join_existing_company");
 assert.equal(p.targetCompanyId,"hub");assert.equal(p.canViewRevenue,false);
});
test("expired, wrong email, stale token, reused invite and existing company refused",()=>{
 for(const changes of [
  {verifiedToken:false},
  {recipient:{...recipient,emailLower:"other@example.com"}},
  {recipient:{...recipient,emailVerified:false}},
  {recipient:{...recipient,active:false}},
  {recipient:{...recipient,latestUserVerified:false}},
  {recipient:{...recipient,companyId:"existingCompany"}},
  {nowMs:now+30*60*1000},
  {contract:{...draft(INVITE_KINDS.PARTNER),linkStatus:"accepted"}},
  {newPartnerCompanyId:"hub"}
 ]){
  assert.throws(()=>planInviteAcceptance({
   contract:draft(INVITE_KINDS.PARTNER),recipient,verifiedToken:true,
   nowMs:now+1000,newPartnerCompanyId:"p123",...changes
  }),/Invitation denied/);
 }
});
test("immutable invite purpose cannot be changed from internal to partner on acceptance",()=>{
 const before={...draft(),status:"pending"};
 const after={...before,status:"accepted",acceptedBy:"receiver"};
 assert.equal(validateImmutableInvite(before,after),true);
 for(const invalid of [
  {...after,kind:"partner_company"},
  {...after,role:"owner"},
  {...after,hubCompanyId:"other"},
  {...after,canViewRevenue:true},
  {...after,canViewUnitPrice:true},
  {...after,catalogSourceCompanyId:"other"}
 ])assert.throws(()=>validateImmutableInvite(before,invalid),/Invitation denied/);
});
