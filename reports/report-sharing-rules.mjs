/**
 * EMULATOR ONLY. Does not deploy Firestore rules or modify documents.
 * Extends exactly the owner-managed notification settings allowlist.
 */
export function buildReportSharingRules(base){
  if(typeof base!=="string"||!base.includes("rules_version = '2'"))
    throw Error("Unexpected Firestore rules source");
  const marker="match /settings/{settingId}";
  const start=base.indexOf(marker),end=base.indexOf("match /linePairingCodes/",start+1);
  if(start<0||end<0||base.indexOf(marker,start+marker.length)>=0)
    throw Error("Unexpected notification settings block");
  const original="'lineConnectedAt', 'updatedBy', 'updatedAt'";
  let region=base.slice(start,end);
  if(region.split(original).length!==2)throw Error("Unexpected notifications allowlist");
  region=region.replace(original,
    "'lineConnectedAt', 'aggregatePartnerReports', 'linkedCompanyIds', 'partnerTeamIds',\n"+
    "                'linkedHubCompanyId', 'countsShareApproved', 'countsShareLineGroupId',\n"+
    "                'updatedBy', 'updatedAt'");
  const anchor="request.resource.data.lineConnectedAt is timestamp\n              )\n              && request.resource.data.updatedBy == request.auth.uid";
  const extra="request.resource.data.lineConnectedAt is timestamp\n              )\n"+
    "              && (!request.resource.data.keys().hasAny(['aggregatePartnerReports'])\n"+
    "                  || request.resource.data.aggregatePartnerReports is bool)\n"+
    "              && (!request.resource.data.keys().hasAny(['linkedCompanyIds'])\n"+
    "                  || (request.resource.data.linkedCompanyIds is list\n"+
    "                      && request.resource.data.linkedCompanyIds.size() <= 30))\n"+
    "              && (!request.resource.data.keys().hasAny(['partnerTeamIds'])\n"+
    "                  || (request.resource.data.partnerTeamIds is list\n"+
    "                      && request.resource.data.partnerTeamIds.size() <= 100))\n"+
    "              && (!request.resource.data.keys().hasAny(['linkedHubCompanyId'])\n"+
    "                  || (request.resource.data.linkedHubCompanyId is string\n"+
    "                      && request.resource.data.linkedHubCompanyId.size() <= 128))\n"+
    "              && (!request.resource.data.keys().hasAny(['countsShareApproved'])\n"+
    "                  || request.resource.data.countsShareApproved is bool)\n"+
    "              && (!request.resource.data.keys().hasAny(['countsShareLineGroupId'])\n"+
    "                  || (request.resource.data.countsShareLineGroupId is string\n"+
    "                      && request.resource.data.countsShareLineGroupId.size() <= 200))\n"+
    "              && request.resource.data.updatedBy == request.auth.uid";
  if(region.split(anchor).length!==2)throw Error("Unexpected notification validators");
  region=region.replace(anchor,extra);
  return base.slice(0,start)+region+base.slice(end);
}
