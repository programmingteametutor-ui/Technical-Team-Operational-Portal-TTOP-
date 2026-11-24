/*****************************************************************************************
 * Interview Scheduler
 * InterviewExtractor.gs
 * MULTI-TEAM VERSION 3.0
 *
 * IMPORTANT
 * - NO handler/person names are hard-coded in this file.
 * - Active handlers are resolved from TeamRuntime.gs -> central V2 Handler Master.
 * - Optional nickname/misspelling aliases can be stored in Script Property:
 *     TEAM_HANDLER_ALIASES_JSON
 *   Example value:
 *     {"Canonical Handler Name":["nickname","common misspelling"]}
 *****************************************************************************************/


/*****************************************************************************************
 * TEAM HANDLER LOOKUP
 *****************************************************************************************/
function getExtractorTeamHandlers_(){

  let handlers = [];

  try{
    if(typeof TR_getRosterSnapshot_ === "function"){
      const roster = TR_getRosterSnapshot_() || {};
      handlers = Array.isArray(roster.allHandlers)
        ? roster.allHandlers.slice()
        : (Array.isArray(roster.mainHandlers) ? roster.mainHandlers.slice() : []);

      const special = String(roster.specialHandler || "").trim();
      if(special && handlers.indexOf(special) === -1){
        handlers.push(special);
      }
    }
  }catch(error){
    Logger.log("Extractor roster read failed: " + error.message);
  }

  if(!handlers.length && typeof getSchedulerAssignableHandlers_ === "function"){
    try{
      handlers = getSchedulerAssignableHandlers_().slice();
    }catch(error){}
  }

  const out = [];
  const seen = {};

  handlers.forEach(function(name){
    name = String(name || "").trim();
    if(!name) return;

    const key = name.toLowerCase();
    if(seen[key]) return;

    seen[key] = true;
    out.push(name);
  });

  return out;
}


function getExtractorHandlerAliases_(){

  const aliases = {};

  try{
    const raw = PropertiesService
      .getScriptProperties()
      .getProperty("TEAM_HANDLER_ALIASES_JSON");

    if(!raw) return aliases;

    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object") return aliases;

    Object.keys(parsed).forEach(function(handler){
      const list = Array.isArray(parsed[handler])
        ? parsed[handler]
        : [parsed[handler]];

      aliases[String(handler || "").trim().toLowerCase()] =
        list
          .map(function(value){ return String(value || "").trim(); })
          .filter(Boolean);
    });

  }catch(error){
    Logger.log("TEAM_HANDLER_ALIASES_JSON ignored: " + error.message);
  }

  return aliases;
}


function normalizeHandlerMatchText_(value){
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}


function textContainsHandlerPhrase_(source, phrase){

  const text = " " + normalizeHandlerMatchText_(source) + " ";
  const key  = " " + normalizeHandlerMatchText_(phrase) + " ";

  if(key === "  ") return false;

  return text.indexOf(key) !== -1;
}


function buildExtractorHandlerKeywords_(handlers){

  handlers = Array.isArray(handlers) ? handlers : [];

  const firstNameCount = {};

  handlers.forEach(function(handler){
    const normalized = normalizeHandlerMatchText_(handler);
    const first = normalized.split(" ")[0] || "";
    if(first){
      firstNameCount[first] = Number(firstNameCount[first] || 0) + 1;
    }
  });

  const configuredAliases = getExtractorHandlerAliases_();

  return handlers.map(function(handler){

    const canonical = String(handler || "").trim();
    const normalized = normalizeHandlerMatchText_(canonical);
    const parts = normalized.split(" ").filter(Boolean);
    const first = parts[0] || "";

    const keywords = [];

    // Always accept the full canonical Handler Master name.
    if(normalized) keywords.push(normalized);

    // Accept the first name only when it is unique inside this team.
    if(first && firstNameCount[first] === 1){
      keywords.push(first);
    }

    // Optional aliases are configuration, not hard-coded people in source code.
    const aliases = configuredAliases[canonical.toLowerCase()] || [];
    aliases.forEach(function(alias){
      const key = normalizeHandlerMatchText_(alias);
      if(key) keywords.push(key);
    });

    // Longest phrase first.
    const unique = [];
    const seen = {};

    keywords
      .sort(function(a,b){ return b.length - a.length; })
      .forEach(function(keyword){
        if(!seen[keyword]){
          seen[keyword] = true;
          unique.push(keyword);
        }
      });

    return {
      handler: canonical,
      keywords: unique
    };
  });
}


function findTeamFixedHandler_(text, handlers){

  const source = String(text || "").trim();
  if(!source) return null;

  handlers = Array.isArray(handlers) && handlers.length
    ? handlers
    : getExtractorTeamHandlers_();

  const entries = buildExtractorHandlerKeywords_(handlers);

  for(let i=0;i<entries.length;i++){
    const entry = entries[i];

    for(let j=0;j<entry.keywords.length;j++){
      if(textContainsHandlerPhrase_(source, entry.keywords[j])){
        return entry.handler;
      }
    }
  }

  return null;
}


/*****************************************************************************************
 * READ MATCHED INTERVIEWS (TODAY ONLY)
 *****************************************************************************************/
function getMatchedInterviews(){

  const rows = getTodayRows();
  const list = [];

  rows.forEach(function(row){

    const text = String(row.extracted || "").trim();

    if(text === "") return;

    const obj = parseMatchedInterview(text);
    obj.row = row.row;
    list.push(obj);
  });

  return list;
}


function parseMatchedInterview(text){

  const result = {
    raw:text,
    candidate:"",
    country:"",
    interviewType:"",
    client:"",
    interviewTime:"",
    duration:30,
    round:"",
    status:"",
    fixedHandler:null
  };

  text = normalizeInterviewText(text);

  result.candidate = extractCandidate(text);
  result.country = extractCountry(text);
  result.interviewType = extractInterviewType(text);
  result.client = extractClient(text);
  result.interviewTime = extractInterviewTime(text);
  result.duration = extractDuration(text);
  result.round = extractRound(text);
  result.status = extractStatus(text);

  // Preserve the old capability to recognize a fixed-handler instruction
  // in the final (...) section, but resolve against THIS TEAM's live roster.
  result.fixedHandler = extractFixedHandler(text);

  return result;
}


/*****************************************************************************************
 * NORMALIZE INTERVIEW TEXT
 *****************************************************************************************/
function normalizeInterviewText(text){

  text = String(text || "");

  text = text.replace(/—/g," - ");
  text = text.replace(/–/g," - ");
  text = text.replace(/--+/g," - ");

  text = text.replace(/\s*-\s*/g," - ");
  text = text.replace(/\s+/g," ");

  text = text.replace(/(\d{1,2})\.(\d{2})/g,"$1:$2");
  text = text.replace(/([0-9])(AM|PM)/gi,"$1 $2");
  text = text.replace(/IST IST/gi,"IST");

  text = text.replace(/\((\d+)\s*min\)/gi,"(Duration: $1 Mins)");
  text = text.replace(/\((\d+)\s*mins\)/gi,"(Duration: $1 Mins)");
  text = text.replace(/\((\d+)\s*minutes\)/gi,"(Duration: $1 Mins)");

  return text.trim();
}


/*****************************************************************************************
 * TEST
 *****************************************************************************************/
function testMatchedInterviews(){

  const list = getMatchedInterviews();

  Logger.log(JSON.stringify(list.slice(0,10),null,2));

  SpreadsheetApp
    .getActiveSpreadsheet()
    .toast(
      list.length + " interviews parsed.",
      "Interview Extractor",
      5
    );
}


/*****************************************************************************************
 * EXTRACT CANDIDATE
 *****************************************************************************************/
function extractCandidate(text){

  const parts = text.split(" - ");

  if(parts.length === 0) return "";

  return cleanInterviewCandidate(parts[0]);
}


function cleanInterviewCandidate(name){

  name = String(name || "");
  name = name.replace(/\([^)]*\)/g,"");
  name = name.replace(/\s+/g," ");

  return name.trim();
}


/*****************************************************************************************
 * EXTRACT COUNTRY
 *****************************************************************************************/
function extractCountry(text){

  const m = text.match(/\((UK|USA|US|Canada|Germany|Ireland|UAE|Australia|India)\)/i);

  if(m) return m[1];

  return "";
}


function extractInterviewType(text){

  if(/Interview/i.test(text)) return "Interview";
  if(/Call/i.test(text)) return "Call";
  if(/Assessment/i.test(text)) return "Assessment";
  if(/Discussion/i.test(text)) return "Discussion";
  if(/Screening/i.test(text)) return "Screening";

  return "";
}


function testExtractorPart2A(){
  const list = getMatchedInterviews();
  Logger.log(JSON.stringify(list.slice(0,10),null,2));
}


/*****************************************************************************************
 * EXTRACT CLIENT
 *****************************************************************************************/
function extractClient(text){

  const parts = text.split(" - ");

  if(parts.length >= 3) return parts[2].trim();

  return "";
}


function extractInterviewTime(text){

  const m = text.match(/(\d{1,2}\s*:\s*\d{2}\s*(AM|PM))/i);

  if(!m) return "";

  return m[1]
    .replace(/\s*:\s*/, ":")
    .replace(/\s+(AM|PM)/i, " $1")
    .toUpperCase();
}


function testExtractorPart2B(){
  const list = getMatchedInterviews();
  Logger.log(JSON.stringify(list.slice(0,10),null,2));
}


/*****************************************************************************************
 * EXTRACT ROUND
 *****************************************************************************************/
function extractRound(text){

  const m = text.match(/\(([^)]*Round[^)]*)\)/i);

  if(m) return m[1].trim();

  return "";
}


/*****************************************************************************************
 * EXTRACT STATUS
 *****************************************************************************************/
function extractStatus(text){

  if(/Completed/i.test(text)) return "Completed";
  if(/Cancelled/i.test(text)) return "Cancelled";
  if(/Rescheduled/i.test(text)) return "Rescheduled";
  if(/Pending/i.test(text)) return "Pending";

  return "";
}


/*****************************************************************************************
 * EXTRACT FIXED HANDLER — DYNAMIC TEAM VERSION
 *****************************************************************************************/
function extractFixedHandler(text){

  if(!text) return null;

  // Keep the original behavior: inspect only the LAST (...) section.
  const matches = String(text).match(/\(([^()]*)\)/g);
  if(!matches) return null;

  const last = matches[matches.length - 1]
    .replace(/[()]/g,"")
    .trim();

  return findTeamFixedHandler_(last);
}


/*****************************************************************************************
 * MASTER INTERVIEW OBJECTS
 *****************************************************************************************/
function getInterviewObjects(){

  const sheet = getMainSheet();
  const block = getTodayBlock();

  const values = sheet.getRange(
    block.startRow,
    COL.MASTER,
    block.totalRows,
    1
  ).getDisplayValues();

  const list = [];

  values.forEach(function(row,index){

    const text = String(row[0]).trim();

    if(text === "") return;
    if(isDateHeader(text)) return;

    const item = parseMatchedInterview(text);
    item.row = block.startRow + index;
    list.push(item);
  });

  Logger.log("Master Interviews : " + list.length);

  return list;
}


/*****************************************************************************************
 * EXTRACTED INTERVIEW OBJECTS
 * Column D = preference / fixed-handler text
 * Column E = extracted interview text
 *****************************************************************************************/
function getExtractedInterviewObjects(){

  const sheet = getMainSheet();
  const block = getTodayBlock();

  const values = sheet.getRange(
    block.startRow,
    COL.MATCH_TEXT,
    block.totalRows,
    2
  ).getDisplayValues();

  // One roster read per extractor run; no hard-coded Pradeep/HYD/Dev names.
  const teamHandlers = getExtractorTeamHandlers_();

  const list = [];

  values.forEach(function(row,index){

    const preferenceText = String(row[0]).trim();
    const extractedText  = String(row[1]).trim();

    if(extractedText === "") return;

    const item = parseMatchedInterview(extractedText);
    item.row = block.startRow + index;

    const preferred = findTeamFixedHandler_(
      preferenceText,
      teamHandlers
    );

    if(preferred){
      item.fixedHandler = preferred;
    }

    list.push(item);
  });

  Logger.log("Extracted Interviews : " + list.length);

  return list;
}


/*****************************************************************************************
 * TESTS
 *****************************************************************************************/
function testInterviewExtractor(){

  const interviews = getInterviewObjects();

  Logger.log(JSON.stringify(interviews.slice(0,10),null,2));

  SpreadsheetApp
    .getActiveSpreadsheet()
    .toast(
      interviews.length + " interview objects created.",
      "Interview Extractor",
      5
    );
}


function testDynamicHandlerResolver(){

  const handlers = getExtractorTeamHandlers_();

  const tests = handlers.map(function(handler){
    return {
      handler:handler,
      fullNameMatch:findTeamFixedHandler_("Strictly " + handler, handlers),
      firstNameMatch:findTeamFixedHandler_(String(handler).split(/\s+/)[0], handlers)
    };
  });

  const result = {
    ok:true,
    teamId:(typeof TEAM_RUNTIME_CONFIG !== "undefined" ? TEAM_RUNTIME_CONFIG.TEAM_ID : ""),
    handlers:handlers,
    tests:tests
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}

