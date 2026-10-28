import {writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const payload={
 schemaVersion:1,company:{id:"example-company",name:"テスト会社"},period:"2026-10",periodMode:"month",
 summary:{dailyRecords:1,count:5,revenue:50000,warningCount:0},warnings:[],
 original:{
  records:[{id:"example-company_u1_2026-10-27",companyId:"example-company",uid:"u1",date:"2026-10-27",
   teamId:"team1",totalCount:5,totalRevenue:50000,
   results:{p1:{productId:"p1",count:5,revenuePerUnit:10000}},
   createdAt:{seconds:1793059200,nanoseconds:0}}],
  products:[{id:"p1",companyId:"example-company",name:"テスト商材",revenue:10000}],
  teams:[{id:"team1",companyId:"example-company",name:"テスト班"}],
  recordCorrections:[{id:"change1",companyId:"example-company",
   recordId:"example-company_u1_2026-10-27",recordDate:"2026-10-27",changedByUid:"owner",
   before:{totalCount:4,totalRevenue:40000},after:{totalCount:5,totalRevenue:50000}}]
 }
};
const checksum=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
writeFileSync(process.argv[2]||"/tmp/sales-archive-test.json",JSON.stringify({
 kind:"sales-archive",version:1,checksumAlgorithm:"SHA-256",checksum,payload
},null,2));
console.log("Synthetic archive generated; does not contain customer data.");
