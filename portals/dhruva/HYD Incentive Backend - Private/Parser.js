/******************************************************
 * PARSER.GS
 * Version 5.0
 ******************************************************/


/******************************************************
 * LOAD RAW DATA
 ******************************************************/
function loadRawData(){

  const sheet =
    IR_operations_()
      .getSheetByName(
        CONFIG.RAW_SHEET
      );

  if(!sheet){
    throw new Error(
      "HYD Raw Data sheet not found in HYD Incentive Tracker."
    );
  }

  const values =
    sheet.getDataRange().getValues();

  const records = [];
  let currentDate = null;

  for(let i=0;i<values.length;i++){

    const colB = values[i][1];

    if(colB instanceof Date){
      currentDate = new Date(colB);
      continue;
    }

    if(!colB || !(currentDate instanceof Date))
      continue;

    const interview =
      parseInterview(colB);

    if(!interview)
      continue;

    interview.dateObj =
      new Date(currentDate);

    interview.dateText =
      formatDate(currentDate);

    records.push(interview);
  }

  return records;
}

function loadTeamData(){

  const sheet =
    IR_operations_()
      .getSheetByName(
        CONFIG.TEAM_SHEET
      );

  if(!sheet){
    throw new Error(
      "HYD Team Data sheet not found in HYD Incentive Tracker."
    );
  }

  const values =
    sheet.getDataRange().getValues();

  const records = [];
  let currentDate = null;

  for(let i=0;i<values.length;i++){

    const colA = values[i][0];
    const colB = values[i][1];
    const colC = values[i][2];
    const colD = values[i][3];
    const colE = values[i][4];

    //------------------------------------------------
    // Date header
    //------------------------------------------------

    if(colA && !colB){
      currentDate =
        parseSheetDate(colA);
      continue;
    }

    if(!colB)
      continue;

    const interview =
      parseInterview(colB);

    if(!interview)
      continue;

    interview.handler =
      String(colC || "").trim();

    interview.status =
      String(colD || "")
        .trim()
        .toLowerCase();

    //------------------------------------------------
    // Selection Confirmed Date (Column E)
    //------------------------------------------------

    interview.selectionDateObj =
      colE
        ? parseSheetDate(colE)
        : null;

    interview.selectionDateText =
      interview.selectionDateObj
        ? formatDate(
            interview.selectionDateObj
          )
        : "";

    //------------------------------------------------
    // Original interview date still determines
    // interview occurrence / Handler ownership.
    //------------------------------------------------

    interview.dateObj =
      currentDate;

    interview.dateText =
      formatDate(currentDate);

    records.push(interview);
  }

  return records;
}

function parseInterview(text){

  text = String(text || "").trim();

  // Convert long dash to normal dash
  text = text.replace(/[–—]/g,"-");

  //--------------------------------------------------
  // Candidate
  //--------------------------------------------------

  const firstDash = text.indexOf("-");

  if(firstDash == -1)
    return null;

  let candidate =
    text.substring(0, firstDash).trim();

  // Remove country
  candidate =
    candidate.replace(
      /\([^)]*\)/g,
      ""
    ).trim();

  candidate = PARSER_identityCanonicalCandidate_(candidate);

  //--------------------------------------------------
  // Client
  //--------------------------------------------------

  let client = "";

  const clientMatch = text.match(

    /(?:Interview|Phone Interview|Phone Call|Recruiter Call)\s*-\s*(.*?)\s*-\s*\d{1,2}:\d{2}/i

  );

  if(clientMatch){

    client = clientMatch[1].trim();

  }

  const clientInfo =
    PARSER_identityResolveClientRoleFromText_(client);

  client = clientInfo.client;

  if(!client)
    return null;

  //--------------------------------------------------
  // Round
  //--------------------------------------------------

  let round = "";
  let roundNo = 0;

  if(/final/i.test(text)){

    round = "Final";
    roundNo = 999;

  }else{

    const roundMatch =
      text.match(
        /(\d+)(st|nd|rd|th)\s*Round/i
      );

    if(!roundMatch)
      return null;

    roundNo =
      parseInt(roundMatch[1],10);

    round =
      roundMatch[0];

  }

  //--------------------------------------------------
  // Time
  //--------------------------------------------------

  let time = "";

  const timeMatch =
    text.match(
      /(\d{1,2}:\d{2}\s*[AP]M)/i
    );

  if(timeMatch){

    time =
      timeMatch[1]
        .toUpperCase();

  }

  //--------------------------------------------------
  // Return Interview Object
  //--------------------------------------------------

  return {

    candidate : candidate,

    client : client,

    role : clientInfo.role || "",

    round : round,

    roundNo : roundNo,

    time : time

  };

}
/******************************************************
 * CENTRAL CANDIDATE / CLIENT IDENTITY HELPERS
 * HYD private engine.
 *
 * Role is informational only. It is NEVER part of promotion,
 * selection or duplicate identity. Exact canonical / approved
 * aliases may auto-resolve; fuzzy resolution remains Portal-only.
 ******************************************************/
const PARSER_IDENTITY_MASTER_ID_FALLBACK_ =
  "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk";

let PARSER_IDENTITY_CACHE_ = null;

function PARSER_identityCanonicalCandidate_(name){
  const clean = PARSER_identityClean_(name);
  if(!clean) return "";
  const idx = PARSER_identityIndex_();
  const key = PARSER_identityKey_(clean);
  const hit = idx.candidateByName[key] || idx.candidateAlias[key] || null;
  return hit ? hit.name : clean;
}

function PARSER_identityResolveClientRoleFromText_(middle){
  const parts = String(middle || "")
    .replace(/[–—−]/g," - ")
    .replace(/-{2,}/g," - ")
    .replace(/\s*-\s*/g," - ")
    .split(/\s+-\s+/)
    .map(PARSER_identityClean_)
    .filter(Boolean)
    .filter(function(part){ return !PARSER_identityDescriptor_(part); });

  if(!parts.length) return {client:"",role:"",resolved:false};

  const idx = PARSER_identityIndex_();

  // Central Client Master / approved aliases are authoritative for the
  // Client-vs-Role boundary.
  for(let count=parts.length; count>=1; count--){
    const source = parts.slice(0,count).join(" - ");
    const key = PARSER_identityKey_(source);
    const hit = idx.clientByName[key] || idx.clientAlias[key] || null;
    if(hit){
      return {
        client:hit.name,
        role:parts.slice(count).join(" - "),
        resolved:true,
        source:source
      };
    }
  }

  // Existing private tracker / Client Alias is compatibility-only fallback
  // while Client Master is still being populated.
  for(let count=parts.length; count>=1; count--){
    const source = parts.slice(0,count).join(" - ");
    const key = PARSER_identityKey_(source);
    const hit = idx.localClientByName[key] || null;
    if(hit){
      return {
        client:hit.name,
        role:parts.slice(count).join(" - "),
        resolved:true,
        source:source
      };
    }
  }

  return {
    client:parts[0],
    role:parts.slice(1).join(" - "),
    resolved:false,
    source:parts[0]
  };
}

function PARSER_identityDescriptor_(part){
  const value = String(part || "").replace(/\([^)]*(?:Round|Rd|Final)[^)]*\)/ig," ")
    .replace(/\s+/g," ").trim().toLowerCase();
  if(!value) return true;
  return /^(?:interview|behavioral\s+interview|final\s+interview|technical\s+interview|technical\s+coding\s+interview|excel\s+interview|ai\s+interview|panel\s+interview|hiring\s+manager\s+interview|manager\s+interview|assessment\s+interview|assessment\s+through\s+interview|zoom\s+interview|teams\s+interview|microsoft\s+teams\s+interview|google\s+meet\s+interview|phone\s+interview|phn\s+interview|loop\s+interview|phone\s+call|phn\s+call|google\s+voice\s+call|recruiter\s+call|phone\s+screen|prep\s+call|final\s+technical\s+discussion|final\s+discussion|technical\s+discussion(?:\s+w\/?\s*hiring\s+manager)?|discussion\s+round|discussion|technical\s+round|screening\s+round)$/i.test(value);
}

function PARSER_identityIndex_(){
  if(PARSER_IDENTITY_CACHE_) return PARSER_IDENTITY_CACHE_;

  const index = {
    candidateByName:{}, candidateAlias:{},
    clientByName:{}, clientAlias:{}, localClientByName:{}
  };

  try{
    const ss = PARSER_identityMasterWorkbook_();
    PARSER_identityLoadMaster_(ss.getSheetByName("Candidate Master"),"candidate",index);
    PARSER_identityLoadMaster_(ss.getSheetByName("Client Master"),"client",index);
    PARSER_identityLoadAlias_(ss.getSheetByName("Candidate Name Map"),"candidate",index);
    PARSER_identityLoadAlias_(ss.getSheetByName("Client Name Map"),"client",index);
  }catch(error){
    Logger.log("Identity Master read skipped: " + String(error && error.message ? error.message : error));
  }

  try{
    const backend = IR_backend_();
    const aliasSheet = backend.getSheetByName("Client Alias");
    if(aliasSheet && aliasSheet.getLastRow() > 1){
      const vals = aliasSheet.getDataRange().getDisplayValues();
      for(let i=1;i<vals.length;i++){
        const alias = PARSER_identityClean_(vals[i][0]);
        const official = PARSER_identityClean_(vals[i][1]);
        if(official){
          const rec = {name:official};
          index.localClientByName[PARSER_identityKey_(official)] = rec;
          if(alias) index.localClientByName[PARSER_identityKey_(alias)] = rec;
        }
      }
    }

    const tracker = backend.getSheetByName("Incentive Tracker");
    if(tracker && tracker.getLastRow() > 1 && tracker.getLastColumn() >= 3){
      const clients = tracker.getRange(2,3,tracker.getLastRow()-1,1).getDisplayValues();
      clients.forEach(function(row){
        const name = PARSER_identityClean_(row[0]);
        if(name) index.localClientByName[PARSER_identityKey_(name)] = {name:name};
      });
    }
  }catch(error){
    Logger.log("Local client bootstrap skipped: " + String(error && error.message ? error.message : error));
  }

  PARSER_IDENTITY_CACHE_ = index;
  return index;
}

function PARSER_identityMasterWorkbook_(){
  const props = PropertiesService.getScriptProperties();
  const id = String(
    props.getProperty("PORTAL_MASTER_SPREADSHEET_ID") ||
    PARSER_IDENTITY_MASTER_ID_FALLBACK_
  ).trim();
  return SpreadsheetApp.openById(id);
}

function PARSER_identityLoadMaster_(sheet,type,index){
  if(!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(PARSER_identityKey_);
  const nameHeader = type === "candidate" ? "canonical name" : "canonical client name";
  const nameCol = headers.indexOf(nameHeader);
  if(nameCol < 0) return;
  const idHeader = type === "candidate" ? "candidate id" : "client id";
  const idCol = headers.indexOf(idHeader);
  for(let i=1;i<values.length;i++){
    const name = PARSER_identityClean_(values[i][nameCol]);
    if(!name) continue;
    const rec = {name:name,id:idCol >= 0 ? PARSER_identityClean_(values[i][idCol]) : ""};
    if(type === "candidate") index.candidateByName[PARSER_identityKey_(name)] = rec;
    else index.clientByName[PARSER_identityKey_(name)] = rec;
  }
}

function PARSER_identityLoadAlias_(sheet,type,index){
  if(!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(PARSER_identityKey_);
  const aliasCol = headers.indexOf("alias");
  const canonicalCol = headers.indexOf(type === "candidate" ? "canonical name" : "canonical client name");
  const activeCol = headers.indexOf("active");
  if(aliasCol < 0 || canonicalCol < 0) return;
  for(let i=1;i<values.length;i++){
    if(activeCol >= 0){
      const flag = PARSER_identityKey_(values[i][activeCol]);
      if(flag && ["true","yes","1","active"].indexOf(flag) < 0) continue;
    }
    const alias = PARSER_identityClean_(values[i][aliasCol]);
    const canonical = PARSER_identityClean_(values[i][canonicalCol]);
    if(!alias || !canonical) continue;
    const rec = type === "candidate"
      ? (index.candidateByName[PARSER_identityKey_(canonical)] || {name:canonical})
      : (index.clientByName[PARSER_identityKey_(canonical)] || {name:canonical});
    if(type === "candidate") index.candidateAlias[PARSER_identityKey_(alias)] = rec;
    else index.clientAlias[PARSER_identityKey_(alias)] = rec;
  }
}

function PARSER_identityClean_(value){
  return String(value || "")
    .replace(/\u00A0/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function PARSER_identityKey_(value){
  return String(value || "")
    .toLowerCase()
    .replace(/&/g," and ")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}

function testCanonicalIdentityParserReadOnly(){
  PARSER_IDENTITY_CACHE_ = null;
  const samples = [
    "Deepanshu R (Ireland) – Interview – EBay - Software Engineer - Cloud Infrastructure – 3:30 PM IST – Duration: 20 Mins (1st Round)",
    "Aslesha yalamanchili – Interview – H - E Parts International - Data and Integration Engineer – 6:30 PM IST – Duration: 30 Mins (1st Round)",
    "Sunil kumar Pasupuleti (Canada) – Interview – CAAT Pension Plan - Full Stack Solutions Developer – 7:30 PM IST – Duration: 30 Mins (1st Round)"
  ];
  const rows = samples.map(function(text){ return parseInterview(text); });
  const result = {ok:true,rows:rows};
  Logger.log(JSON.stringify(result,null,2));
  return result;
}

/******************************************************
 * PARSE SHEET DATE
 ******************************************************/
function parseSheetDate(value){

  // Already Date object
  if(value instanceof Date){

    return new Date(

      value.getFullYear(),

      value.getMonth(),

      value.getDate()

    );

  }

  value = String(value || "").trim();

  // Remove weekday
  value = value.replace(

    /\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i,

    ""

  );

  const parts = value.split("/");

  if(parts.length != 3){

    throw new Error(

      "Invalid Team Date : " + value

    );

  }

  return new Date(

    parseInt(parts[2],10),

    parseInt(parts[0],10)-1,

    parseInt(parts[1],10)

  );

}


/******************************************************
 * FORMAT DATE
 ******************************************************/
function formatDate(date){

  if(!(date instanceof Date))
    return "";

  return Utilities.formatDate(

    date,

    Session.getScriptTimeZone(),

    "dd-MMM-yyyy"

  );

}
/******************************************************
 * GET CLIENT ALIAS SHEET
 ******************************************************/
function getClientAliasSheet(){

  const ss = IR_backend_();

  let sheet = ss.getSheetByName(CONFIG.CLIENT_ALIAS_SHEET);

  if(!sheet){

    sheet = ss.insertSheet(CONFIG.CLIENT_ALIAS_SHEET);

    sheet.appendRow([

      "Alias",

      "Official"

    ]);

  }

  return sheet;

}