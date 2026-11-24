/*********************************************************************
 * Interview Scheduler
 * Parser.gs
 * Part 1
 * Version : 3.0
 *********************************************************************/

/**
 * Parses one interview row into a structured object.
 */
function parseInterview(rawText, rowNumber) {


  rawText = normalizeText(rawText);

  const interview = {

    row: rowNumber,

    raw: rawText,

    candidate: "",

    country: "",

    interviewType: "",

    client: "",

    interviewTime: "",

    duration: SETTINGS.DEFAULT_DURATION,

    round: "",

    status: "",

    fixedHandler: null

  };

  // Ignore blank rows
  if (!rawText)
    return null;

  // Ignore date rows
  if (isDateHeader(rawText))
    return null;

  interview.candidate = extractCandidate(rawText);

  interview.country = extractCountry(rawText);

  interview.interviewType = extractInterviewType(rawText);

  // Filled in Part 2
  interview.client = extractClient(rawText);

  interview.interviewTime = extractTime(rawText);

  interview.duration = extractDuration(rawText);

  interview.round = extractRound(rawText);

  interview.status = extractStatus(rawText);

  interview.fixedHandler = extractFixedHandler(rawText);

  return interview;

}


/*********************************************************************
 * TEXT NORMALIZATION
 *********************************************************************/

function normalizeText(text){

  text = String(text || "");

  // convert long dash to normal dash
  text = text.replace(/–/g,"-");

  text = text.replace(/—/g,"-");

  // collapse spaces
  text = text.replace(/\s+/g," ");

  return text.trim();

}


/*********************************************************************
 * DATE HEADER
 *********************************************************************/

function isDateHeader(text){

  text = normalizeText(text);

  return /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text);

}


function extractCandidate(text){

    text = normalizeText(text);

    // Split on hyphen OR en dash OR em dash
    const parts = text.split(/\s*[-–—]\s*/);

    if(parts.length === 0)
        return "";

    let candidate = parts[0].trim();

    // Remove country
    candidate = candidate.replace(/\(.*?\)/g,"");

    return candidate.trim();

}

/*********************************************************************
 * COUNTRY
 *********************************************************************/

function extractCountry(text){

  const match = text.match(/\(([^)]*)\)/);

  if(!match)
    return "";

  return match[1].trim();

}


/*********************************************************************
 * INTERVIEW TYPE
 *********************************************************************/

function extractInterviewType(text){

  const upper = text.toUpperCase();

  if(upper.includes("PHONE INTERVIEW"))
    return "Phone Interview";

  if(upper.includes("PHN INTERVIEW"))
    return "Phone Interview";

  if(upper.includes("PHONE CALL"))
    return "Phone Call";

  if(upper.includes("CODING ROUND"))
    return "Coding Round";

  if(upper.includes("TECHNICAL ROUND"))
    return "Technical Round";

  if(upper.includes("HR ROUND"))
    return "HR Round";

  if(upper.includes("FINAL ROUND"))
    return "Final Round";

  if(upper.includes("INTERVIEW"))
    return "Interview";

  return "";

}
/*********************************************************************
 * CLIENT
 *********************************************************************/
function extractClient(text){

  text = normalizeText(text);

  const parts = text.split("-");

  if(parts.length < 3)
    return "";

  // Candidate - Interview Type - Client - Time
  return parts[2].trim();

}


/*********************************************************************
 * INTERVIEW TIME
 *********************************************************************/
function extractTime(text){

  const match = text.match(
    /(\d{1,2})[:.](\d{2})\s*(AM|PM)/i
  );

  if(!match)
    return "";

  let hour = match[1];
  let minute = match[2];
  let ampm = match[3].toUpperCase();

  return hour + ":" + minute + " " + ampm;

}


/*********************************************************************
 * DURATION
 *********************************************************************/
function extractDuration(text){

  // Safety check
  if (!text) {
    Logger.log("extractDuration received empty text");
    return SETTINGS.DEFAULT_DURATION;
  }

  const match = text.match(
    /Duration\s*:\s*(\d+)\s*(Min|Mins|Minutes|Hr|Hrs|Hour|Hours|Hrs?)/i
  );

  if (!match) {
    return SETTINGS.DEFAULT_DURATION;
  }

  let duration = Number(match[1]);

  const unit = match[2].toLowerCase();

  if (
    unit === "hr" ||
    unit === "hrs" ||
    unit === "hour" ||
    unit === "hours"
  ) {
    duration = duration * 60;
  }

  return duration;
}

/*********************************************************************
 * ROUND
 *********************************************************************/
function extractRound(text){

  const match = text.match(
    /\((1st|2nd|3rd|Final).*?Round.*?\)/i
  );

  if(!match)
    return "";

  return match[0]
    .replace(/[()]/g,"")
    .trim();

}


/*********************************************************************
 * STATUS
 *********************************************************************/
function extractStatus(text){

  const upper = text.toUpperCase();

  if(upper.includes("RESCHEDULE"))
    return "RESCHEDULE";

  if(upper.includes("WAITING"))
    return "WAITING";

  if(upper.includes("CANCEL"))
    return "CANCELLED";

  if(upper.includes("COMPLETED"))
    return "COMPLETED";

  return "";

}


/*********************************************************************
 * FIXED HANDLER
 *
 * IMPORTANT:
 * Never assign based on candidate name.
 * Only explicit handler instructions.
 *********************************************************************/
function extractFixedHandler(text){

  const source = String(text || "").trim();
  if(!source) return null;

  // Fixed-handler instructions are resolved against the CURRENT team roster.
  // No person name is hard-coded in this parser.
  const roster = getSchedulerAssignableHandlers_();
  if(!roster.length) return null;

  const normalized = source.replace(/\s+/g," ").trim();

  // Longest names first avoids a shorter name accidentally matching part of
  // a longer full name.
  const ordered = roster.slice().sort(function(a,b){
    return String(b).length - String(a).length;
  });

  for(let i=0;i<ordered.length;i++){
    const handler = ordered[i];
    const escaped = String(handler).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

    const strictly = new RegExp("\\bSTRICTLY\\s+" + escaped + "\\b","i");
    const explicit = new RegExp("\\bHANDLER\\s*:\\s*" + escaped + "\\b","i");

    if(strictly.test(normalized) || explicit.test(normalized)){
      return handler;
    }
  }

  return null;
}
/*********************************************************************
 * PARSE TODAY'S INTERVIEWS
 *********************************************************************/
function parseTodayInterviews() {

  const rows = getTodayRows();

  const interviews = [];

  rows.forEach(function (r) {

    // Skip blank master rows
    if (!r.master || r.master.trim() === "")
      return;

    const interview = parseInterview(
      r.master,
      r.row
    );

    if (interview != null)
      interviews.push(interview);

  });

  return interviews;

}


/*********************************************************************
 * FIND INTERVIEW BY SHEET ROW
 *********************************************************************/
function getInterviewByRow(rowNumber) {

  const interviews = parseTodayInterviews();

  for (const interview of interviews) {

    if (interview.row == rowNumber)
      return interview;

  }

  return null;

}


/*********************************************************************
 * DEBUG - PRINT ONE INTERVIEW
 *********************************************************************/
function printInterview(interview) {

  if (!interview) {

    Logger.log("Interview is null");

    return;

  }

  Logger.log(
    JSON.stringify(
      interview,
      null,
      2
    )
  );

}


/*********************************************************************
 * TEST PARSER
 *********************************************************************/
function testParser() {

  const interviews = parseTodayInterviews();

  Logger.log(
    "Total Interviews : " +
    interviews.length
  );

  // Print first five interviews only
  for (let i = 0;
       i < Math.min(interviews.length,5);
       i++) {

    printInterview(interviews[i]);

  }

  SpreadsheetApp
    .getActiveSpreadsheet()
    .toast(

      interviews.length +
      " interviews parsed successfully.",

      "Parser",

      5

    );

}


/*********************************************************************
 * TEST ACTIVE ROW
 *********************************************************************/
function testActiveRow() {

  const sheet = getMainSheet();

  const row = sheet
    .getActiveCell()
    .getRow();

  const interview = getInterviewByRow(row);

  printInterview(interview);

}


/*********************************************************************
 * EXPORT PARSED OBJECTS
 *
 * This function will be used by the
 * Fuzzy Matcher and Scheduler.
 *********************************************************************/
function getInterviewObjects() {

  return parseTodayInterviews();

}
function testCandidateExtraction(){

    const interviews = getInterviewObjects();

    interviews.slice(0,10).forEach(function(x){

        Logger.log(x.candidate);

    });

}
function testExtractDuration(){

  const samples = [
    "Tejasri Guttikonda – Duration: 1 Hour",
    "Candidate ABC – Duration: 60 Mins",
    "Candidate XYZ – Duration: 30 Minutes",
    "Candidate DEF – Duration: 2 Hours",
    "Candidate GHI – Duration: 1 Hr"
  ];

  samples.forEach(function(text){
    Logger.log(text + " ===> " + extractDuration(text));
  });

}
