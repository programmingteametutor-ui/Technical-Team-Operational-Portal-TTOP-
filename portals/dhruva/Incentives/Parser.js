/******************************************************
 * PARSER.GS
 * Version 5.0
 ******************************************************/


/******************************************************
 * LOAD RAW DATA
 ******************************************************/
function loadRawData(){

  const sheet =
    SpreadsheetApp
      .getActive()
      .getSheetByName(
        CONFIG.RAW_SHEET
      );

  if(!sheet){

    throw new Error(
      "Raw Data sheet not found."
    );

  }

  const values =
    sheet.getDataRange().getValues();

  const records = [];

  let currentDate = null;

  for(let i=0;i<values.length;i++){

    const colB = values[i][1];

    //------------------------------------------------
    // Date Header
    //------------------------------------------------

    if(colB instanceof Date){

      currentDate = new Date(colB);

      continue;

    }

    if(!colB)
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


/******************************************************
 * LOAD TEAM DATA
 ******************************************************/
function loadTeamData(){

  const sheet =
    SpreadsheetApp
      .getActive()
      .getSheetByName(
        CONFIG.TEAM_SHEET
      );

  if(!sheet){

    throw new Error(
      "Team Data sheet not found."
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
    // Date Header
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


/**************************************************
 * Selection Confirmed Date
 *
 * Team Data Column E
 **************************************************/

interview.selectionDateObj =
  colE
    ? parseSheetDate(
        colE
      )
    : null;


interview.selectionDateText =
  interview.selectionDateObj
    ? formatDate(
        interview.selectionDateObj
      )
    : "";


/**************************************************
 * Interview / Call Date
 **************************************************/

interview.dateObj =
  currentDate;

interview.dateText =
  formatDate(
    currentDate
  );

    records.push(interview);

  }

  return records;

}
/******************************************************
 * PARSE INTERVIEW
 ******************************************************/
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

    round : round,

    roundNo : roundNo,

    time : time

  };

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

  const ss = SpreadsheetApp.getActive();

  let sheet = ss.getSheetByName("Client Alias");

  if(!sheet){

    sheet = ss.insertSheet("Client Alias");

    sheet.appendRow([

      "Alias",

      "Official"

    ]);

  }

  return sheet;

}