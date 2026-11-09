"use strict";
// Count-only standings. Never accept or serialize sales, prices, cashback, UIDs.
function ranked(rows,{nameKey="name",countKey="totalCount"}={}){
 if(!Array.isArray(rows))throw Error("COUNT_RANK_INVALID");
 const safe=rows.map(row=>{
  const name=row?.[nameKey],count=row?.[countKey];
  if(typeof name!=="string"||!name.trim()||!Number.isSafeInteger(count)||count<0)
   throw Error("COUNT_RANK_INVALID");
  return {name:name.trim(),count};
 }).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"ja"));
 let last=-1,rank=0;
 return safe.map((row,i)=>{if(row.count!==last){rank=i+1;last=row.count;}return {...row,rank};});
}
function jointCountRankings({companies,teams,people,direct}){
 const directTeams=Array.isArray(direct?.teams)?direct.teams:[];
 const directPeople=direct?.peopleVerified===true&&Array.isArray(direct?.people)?direct.people:[];
 const teamsAll=[...teams.map(x=>({name:x.companyName+" / "+x.name,totalCount:x.totalCount})),
  ...directTeams.map(x=>({name:"直営 / "+x.name,totalCount:x.totalCount}))];
 const peopleAll=[...people.map(x=>({name:x.companyName+" / "+x.name,totalCount:x.totalCount})),
  ...directPeople.map(x=>({name:"直営 / "+x.name,totalCount:x.totalCount}))];
 return {companies:ranked([...companies,{name:"直営",totalCount:direct.totalCount}]),teams:ranked(teamsAll),people:ranked(peopleAll),peopleComplete:direct.peopleVerified===true&&companies.every(x=>x.peopleVerified===true)};
}
module.exports={ranked,jointCountRankings};
