/******************************************************
 * TARGETED DUPLICATE EVIDENCE PREVIEW - READ ONLY
 * Target: Pradeep Anna Team -> Incentive Backend - Private
 * Requires PromotionDuplicateResolutionPreview_v1 helpers to remain installed.
 * No writes / deletes / approvals.
 ******************************************************/

function previewDuplicateEvidence_Amulya(){
  return PDPR_previewCandidateEvidence_(
    "Amulya Bellam Chowdary",
    "Bristol Myers Squibb"
  );
}

function previewDuplicateEvidence_Jeshwanth(){
  return PDPR_previewCandidateEvidence_(
    "Jeshwanth reddy yannam",
    "McCain foods"
  );
}

function PDPR_previewCandidateEvidence_(candidate, client){

  const candidateKey = PDPR_normalizeIdentity_(candidate);
  const clientKey = PDPR_normalizeIdentity_(PDPR_cleanClient_(client));

  const rawRecords = loadRawData();
  const teamRecords = loadTeamData();

  function sameCandidateClient_(record){
    if(!record) return false;

    return (
      PDPR_normalizeIdentity_(record.candidate) === candidateKey &&
      PDPR_normalizeIdentity_(PDPR_cleanClient_(record.client)) === clientKey
    );
  }

  function sortRecords_(a, b){
    const aDate = a.dateObj instanceof Date ? a.dateObj.getTime() : 0;
    const bDate = b.dateObj instanceof Date ? b.dateObj.getTime() : 0;

    if(aDate !== bDate) return aDate - bDate;

    const aRound = Number(a.roundNo || 0);
    const bRound = Number(b.roundNo || 0);

    if(aRound !== bRound) return aRound - bRound;

    return String(a.time || "").localeCompare(String(b.time || ""));
  }

  const teamEvidence = teamRecords
    .filter(sameCandidateClient_)
    .sort(sortRecords_)
    .map(function(record){
      return {
        date: PDPR_dateKey_(record.dateObj),
        round: record.round || "",
        roundNo: Number(record.roundNo || 0),
        time: record.time || "",
        handler: record.handler || "",
        status: record.status || "",
        validOwner: PDPR_validTeamOwner_(record),
        isLoopInterview: PDPR_isLoop_(record)
      };
    });

  const rawEvidence = rawRecords
    .filter(sameCandidateClient_)
    .sort(sortRecords_)
    .map(function(record){
      return {
        date: PDPR_dateKey_(record.dateObj),
        round: record.round || "",
        roundNo: Number(record.roundNo || 0),
        time: record.time || "",
        isLoopInterview: PDPR_isLoop_(record),
        originalText: record.originalText || ""
      };
    });

  const result = {
    ok: true,
    readOnly: true,
    candidate: candidate,
    client: client,
    teamEvidence: teamEvidence,
    rawEvidence: rawEvidence
  };

  Logger.log("========== TARGETED DUPLICATE EVIDENCE ==========");
  Logger.log(JSON.stringify(result, null, 2));
  Logger.log("=================================================");

  return result;
}

/******************************************************
 * TEAM-FIRST PROMOTION MODEL v1.4 - READ ONLY TESTS
 ******************************************************/
function testPromotionBusinessRulesV14(){

  function rec(candidate,client,roundNo,date,time,handler,text,isLoop){
    return {
      candidate:candidate,
      client:client,
      round: roundNo===999 ? "Final" : roundNo + (roundNo===1?"st":roundNo===2?"nd":roundNo===3?"rd":"th") + " Round",
      roundNo:roundNo,
      dateObj:date,
      time:time||"",
      handler:handler||"",
      originalText:text||"",
      isLoopInterview:!!isLoop
    };
  }

  const jananiTeam = [rec("Janani Priya k","Savvy Wealth",4,new Date(2026,7,25),"7:30 PM","Pradeep")];
  const jananiRaw = [
    rec("Janani Priya k","Savvy Wealth",4,new Date(2026,7,25),"7:30 PM"),
    rec("Janani Priya k","Savvy Wealth",5,new Date(2026,7,28),"9:45 PM","","Prep Call"),
    rec("Janani Priya k","Savvy Wealth",6,new Date(2026,8,2),"7:30 PM")
  ];
  const janani = buildPromotionHistory(jananiRaw,jananiTeam);

  const vivekTeam = [rec("Vivek Maddukuru","Sparq",2,new Date(2026,7,19),"9:00 PM","Bharat")];
  const vivekRaw = [
    rec("Vivek Maddukuru","Sparq",3,new Date(2026,7,22),"10:00 PM"),
    rec("Vivek Maddukuru","Sparq",4,new Date(2026,7,27),"9:30 PM"),
    rec("Vivek Maddukuru","Sparq",5,new Date(2026,8,1),"10:30 PM","","Vivek – Interview – Sparq – 10:30 PM IST – Duration: 60 Mins (5th Round)"),
    rec("Vivek Maddukuru","Sparq",5,new Date(2026,8,2),"12:30 AM","","Vivek – Interview – Sparq – 12:30 AM IST – Duration: 60 Mins (5th Round) (reschedule from sept 1)")
  ];
  const effectiveVivek = PROMO_getEffectiveRawRecords_(vivekRaw);
  const vivek = buildPromotionHistory(vivekRaw,vivekTeam);

  const meghanaTeam = [rec("Meghana chittepu","Comcast",1,new Date(2026,7,17),"8:30 PM","Karthik")];
  const meghanaRaw = [
    rec("Meghana chittepu","Comcast",2,new Date(2026,7,25),"2:00 AM"),
    rec("Meghana chittepu","Comcast",3,new Date(2026,8,2),"8:30 PM")
  ];
  const meghana = buildPromotionHistory(meghanaRaw,meghanaTeam);

  const skipTeam = [rec("Skip Candidate","Client X",1,new Date(2026,7,1),"8:00 PM","Naresh")];
  const skipRaw = [rec("Skip Candidate","Client X",3,new Date(2026,7,5),"8:00 PM")];
  const skip = buildPromotionHistory(skipRaw,skipTeam);

  const sameRoundTeam = [rec("Aparna Veldurti","workday",2,new Date(2026,8,1),"9:30 PM","Pradeep")];
  const sameRoundRaw = [rec("Aparna Veldurti","workday",2,new Date(2026,8,1),"9:30 PM")];
  const sameRound = buildPromotionHistory(sameRoundRaw,sameRoundTeam);

  const sameDayTeam = [rec("Mounika","Intel",2,new Date(2026,7,13),"8:30 PM","Venkatesh")];
  const sameDayRaw = [rec("Mounika","Intel",3,new Date(2026,7,13),"11:30 PM")];
  const sameDay = buildPromotionHistory(sameDayRaw,sameDayTeam);

  const loopRaw = [rec("Mounika","Intel",3,new Date(2026,7,13),"11:30 PM","","Loop Interview",true)];
  const loop = buildPromotionHistory(loopRaw,sameDayTeam);

  const keyA = ["Promotion","Example Candidate","Client X","1st Round","2nd Round",new Date(2026,7,1),new Date(2026,7,5),"Handler",100,"Pending"];
  const keyB = ["Promotion","Example Candidate","Client X","1st Round","5th Round",new Date(2026,7,1),new Date(2026,7,20),"Handler",100,"Pending"];

  const checks = [
    {name:"Janani 4th -> any higher creates one",ok:janani.length===1},
    {name:"Janani earliest higher is 5th",ok:janani[0] && Number(janani[0].promotionRoundNo)===5},
    {name:"Janani amount from 4th is 500",ok:janani[0] && getPromotionAmount(janani[0].previousRoundNo,janani[0].promotionRoundNo)===500},
    {name:"Vivek one incentive despite 3rd/4th/5th",ok:vivek.length===1},
    {name:"Vivek earliest higher is 3rd",ok:vivek[0] && Number(vivek[0].promotionRoundNo)===3},
    {name:"Rescheduled Sep1 5th suppressed",ok:effectiveVivek.filter(function(r){return Number(r.roundNo)===5;}).length===1 && PROMO_dateKey_(effectiveVivek.filter(function(r){return Number(r.roundNo)===5;})[0].dateObj)==="2026-09-02"},
    {name:"Meghana 1st -> higher amount 100",ok:meghana[0] && getPromotionAmount(meghana[0].previousRoundNo,meghana[0].promotionRoundNo)===100},
    {name:"1st -> 3rd still 100",ok:skip[0] && Number(skip[0].promotionRoundNo)===3 && getPromotionAmount(skip[0].previousRoundNo,skip[0].promotionRoundNo)===100},
    {name:"same Team 2nd + Raw 2nd is not promotion",ok:sameRound.length===0},
    {name:"same-day different round non-loop not auto promotion",ok:sameDay.length===0},
    {name:"same-day Loop higher round allowed",ok:loop.length===1},
    {name:"same handled Team call logical key ignores later evidence",ok:PB_buildLogicalPromotionKey_(keyA)===PB_buildLogicalPromotionKey_(keyB)}
  ];

  const passed = checks.filter(function(x){return x.ok;}).length;
  const result = {ok:passed===checks.length,pass:passed===checks.length,passed:passed,total:checks.length,checks:checks};
  Logger.log(JSON.stringify(result,null,2));
  return result;
}

