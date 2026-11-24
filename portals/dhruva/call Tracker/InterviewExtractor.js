/*****************************************************************
 *
 * HANDLER KEYWORDS
 *
 *****************************************************************/

const HANDLER_KEYWORDS = {

    Dhruva: [
        "dhruva"
    ],

    Naresh: [
        "naresh"
    ],

    Bharat: [
        "bharat",
        "bharath",
        "barat"
    ],

    Venkatesh: [
        "venkatesh",
        "venkatesh anna",
        "venky"
    ],

    Avinash: [
        "avinash"
    ],

    Karthik: [
        "karthik",
        "kartik"
    ],

    Gopal: [
        "gopal"
    ],

    Anji: [
        "anji"
    ],

    Pradeep: [
        "pradeep",
        "strictly pradeep",
        "strictly pradeep anna",
        "only pradeep"
    ]

};
/*****************************************************************************************
 *
 * Interview Scheduler
 * InterviewExtractor.gs
 * Part 1
 * Version : 2.0
 *
 *****************************************************************************************/


/*****************************************************************************************
 *
 * READ MATCHED INTERVIEWS (TODAY ONLY)
 *
 *****************************************************************************************/
function getMatchedInterviews(){

    const rows = getTodayRows();

    const list = [];

    rows.forEach(function(row){

        const text = String(row.extracted || "").trim();

        if(text=="")
            return;

        const obj = parseMatchedInterview(text);

        obj.row = row.row;

        list.push(obj);

    });

    return list;

}

function parseMatchedInterview(text){

    const result={

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

    //--------------------------------------------------
    // Candidate
    //--------------------------------------------------

    result.candidate = extractCandidate(text);

    //--------------------------------------------------
    // Country
    //--------------------------------------------------

    result.country = extractCountry(text);

    //--------------------------------------------------
    // Interview Type
    //--------------------------------------------------

    result.interviewType = extractInterviewType(text);

    //--------------------------------------------------
    // Client
    //--------------------------------------------------

    result.client = extractClient(text);

    //--------------------------------------------------
    // Time
    //--------------------------------------------------

    result.interviewTime = extractInterviewTime(text);

    //--------------------------------------------------
    // Duration
    //--------------------------------------------------

    result.duration = extractDuration(text);

    //--------------------------------------------------
    // Round
    //--------------------------------------------------

    result.round = extractRound(text);

    //--------------------------------------------------
    // Status
    //--------------------------------------------------

    result.status = extractStatus(text);

Logger.log(
  "Candidate: " + result.candidate +
  " | Fixed: " + result.fixedHandler +
  " | Raw: " + text
);
    return result;

}
/*****************************************************************************************
 *
 * NORMALIZE INTERVIEW TEXT
 *
 *****************************************************************************************/
function normalizeInterviewText(text){

    text = String(text || "");

    //---------------------------------------
    // Convert all dashes to one format
    //---------------------------------------

    text = text.replace(/—/g," - ");
    text = text.replace(/–/g," - ");
    text = text.replace(/--+/g," - ");

    //---------------------------------------
    // Normalize spaces
    //---------------------------------------

    text = text.replace(/\s*-\s*/g," - ");
    text = text.replace(/\s+/g," ");

    //---------------------------------------
    // Normalize time
    //---------------------------------------

    text = text.replace(/(\d{1,2})\.(\d{2})/g,"$1:$2");

    text = text.replace(/([0-9])(AM|PM)/gi,"$1 $2");

    text = text.replace(/IST IST/gi,"IST");

    //---------------------------------------
    // Normalize duration text
    //---------------------------------------

    text = text.replace(/\((\d+)\s*min\)/gi,"(Duration: $1 Mins)");

    text = text.replace(/\((\d+)\s*mins\)/gi,"(Duration: $1 Mins)");

    text = text.replace(/\((\d+)\s*minutes\)/gi,"(Duration: $1 Mins)");

    return text.trim();

}


/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testMatchedInterviews(){

    const list = getMatchedInterviews();

    Logger.log(

        JSON.stringify(

            list.slice(0,10),

            null,

            2

        )

    );

    SpreadsheetApp
        .getActiveSpreadsheet()
        .toast(

            list.length +

            " interviews parsed.",

            "Interview Extractor",

            5

        );

}
/*****************************************************************************************
 *
 * EXTRACT CANDIDATE
 *
 *****************************************************************************************/
function extractCandidate(text){

    const parts = text.split(" - ");

    if(parts.length===0)
        return "";

    return cleanInterviewCandidate(parts[0]);

}


/*****************************************************************************************
 *
 * CLEAN CANDIDATE
 *
 *****************************************************************************************/
function cleanInterviewCandidate(name){

    name = String(name||"");

    // Remove country inside brackets
    name = name.replace(/\([^)]*\)/g,"");

    name = name.replace(/\s+/g," ");

    return name.trim();

}


/*****************************************************************************************
 *
 * EXTRACT COUNTRY
 *
 *****************************************************************************************/
function extractCountry(text){

    const m = text.match(/\((UK|USA|US|Canada|Germany|Ireland|UAE|Australia|India)\)/i);

    if(m)
        return m[1];

    return "";

}


function extractInterviewType(text){

    if(/Interview/i.test(text))
        return "Interview";

    if(/Call/i.test(text))
        return "Call";

    if(/Assessment/i.test(text))
        return "Assessment";

    if(/Discussion/i.test(text))
        return "Discussion";

    if(/Screening/i.test(text))
        return "Screening";

    return "";

}


/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testExtractorPart2A(){

    const list = getMatchedInterviews();

    Logger.log(

        JSON.stringify(

            list.slice(0,10),

            null,

            2

        )

    );

}
/*****************************************************************************************
 *
 * EXTRACT CLIENT
 *
 *****************************************************************************************/
function extractClient(text){

    const parts = text.split(" - ");

    if(parts.length >= 3)
        return parts[2].trim();

    return "";

}


function extractInterviewTime(text){

    const m = text.match(
        /(\d{1,2}\s*:\s*\d{2}\s*(AM|PM))/i
    );

    if(!m)
        return "";

    return m[1]
        .replace(/\s*:\s*/, ":")
        .replace(/\s+(AM|PM)/i, " $1")
        .toUpperCase();

}



/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testExtractorPart2B(){

    const list = getMatchedInterviews();

    Logger.log(

        JSON.stringify(

            list.slice(0,10),

            null,

            2

        )

    );

}
/*****************************************************************************************
 *
 * EXTRACT ROUND
 *
 *****************************************************************************************/
function extractRound(text){

    const m = text.match(/\(([^)]*Round[^)]*)\)/i);

    if(m)
        return m[1].trim();

    return "";

}


/*****************************************************************************************
 *
 * EXTRACT STATUS
 *
 *****************************************************************************************/
function extractStatus(text){

    if(/Completed/i.test(text))
        return "Completed";

    if(/Cancelled/i.test(text))
        return "Cancelled";

    if(/Rescheduled/i.test(text))
        return "Rescheduled";

    if(/Pending/i.test(text))
        return "Pending";

    return "";

}


/*****************************************************************
 *
 * EXTRACT FIXED HANDLER
 *
 *****************************************************************/

function extractFixedHandler(text){

    if(!text)
        return null;

    //---------------------------------------
    // Read only the LAST (...) section
    //---------------------------------------

    const matches = text.match(/\(([^()]*)\)/g);

    if(!matches)
        return null;

    const last = matches[matches.length-1]
        .replace(/[()]/g,"")
        .toLowerCase()
        .trim();

    //---------------------------------------
    // Match handler keywords
    //---------------------------------------

    for(const handler in HANDLER_KEYWORDS){

        const keywords = HANDLER_KEYWORDS[handler];

        for(let i=0;i<keywords.length;i++){

            if(last.indexOf(keywords[i])!=-1){

                return handler;

            }

        }

    }

    return null;

}
function getInterviewObjects(){


const sheet = getMainSheet();

const block = getTodayBlock();

const values = sheet.getRange(
    block.startRow,
    COL.MASTER,
    block.totalRows,
    1
).getDisplayValues();

const list=[];


values.forEach(function(row,index){


const text = String(row[0]).trim();

// Skip blank rows
if(text == "")
    return;

// Skip date headers
if(isDateHeader(text))
    return;

const item = parseMatchedInterview(text);

item.row = block.startRow + index;

list.push(item);


});


Logger.log(
    "Master Interviews : " + list.length
);

return list;


}

function getExtractedInterviewObjects() {

  const sheet = getMainSheet();

  const block = getTodayBlock();

  // Read BOTH columns D and E
const values = sheet.getRange(
    block.startRow,
    COL.MATCH_TEXT,
    block.totalRows,
    2
).getDisplayValues();

  const list = [];

  values.forEach(function(row, index) {

    const preferenceText = String(row[0]).trim();   // Column D
    const extractedText  = String(row[1]).trim();   // Column E

    if (extractedText === "")
      return;

    const item = parseMatchedInterview(extractedText);

    item.row = block.startRow + index;

    //----------------------------------------
    // Detect preferred handler from Column D
    //----------------------------------------

    const lower = preferenceText.toLowerCase();

    if (lower.includes("dhruva"))
      item.fixedHandler = "Dhruva";
    else if (lower.includes("naresh"))
      item.fixedHandler = "Naresh";
    else if (lower.includes("bharat"))
      item.fixedHandler = "Bharat";
    else if (lower.includes("venkatesh"))
      item.fixedHandler = "Venkatesh";
    else if (lower.includes("avinash"))
      item.fixedHandler = "Avinash";
    else if (lower.includes("karthik"))
      item.fixedHandler = "Karthik";
    else if (lower.includes("pradeep"))
      item.fixedHandler = "Pradeep";

    list.push(item);

  });

  Logger.log("Extracted Interviews : " + list.length);

  return list;

}

/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testInterviewExtractor(){

    const interviews = getInterviewObjects();

    Logger.log(

        JSON.stringify(

            interviews.slice(0,10),

            null,

            2

        )

    );

    SpreadsheetApp
        .getActiveSpreadsheet()
        .toast(

            interviews.length +
            " interview objects created.",

            "Interview Extractor",

            5

        );

}

