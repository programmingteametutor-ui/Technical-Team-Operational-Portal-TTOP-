/**********************************************************************
 * FuzzyMatcher V2.0
 * Part 1A
 * Better Parsing + AM/PM Support + Lookup Object
 **********************************************************************/

/**********************************************************************
 * PARSE COLUMN D ENTRY
 **********************************************************************/
function parseLookupEntry(text) {

  text = normalizeLookupText(text);

  const result = {
    raw: text,
    candidate: "",
    time: "",
    hour: -1,
    minute: 0,
    isAM: false,
    isPM: false,
    fixedHandler: null,
    notes: ""
  };

  if (!text)
    return result;

  //--------------------------------------------------------
  // Extract ALL (...) sections
  //--------------------------------------------------------

  const brackets = text.match(/\((.*?)\)/g);

  if (brackets) {

    result.notes = brackets
      .map(x => x.replace(/[()]/g, ""))
      .join(" ");

    const upper = result.notes.toUpperCase();

    if (upper.includes("DHRUVA"))
      result.fixedHandler = "Dhruva";

    else if (upper.includes("NARESH"))
      result.fixedHandler = "Naresh";

    else if (upper.includes("BHARAT"))
      result.fixedHandler = "Bharat";

    else if (upper.includes("VENKATESH"))
      result.fixedHandler = "Venkatesh";

    else if (upper.includes("AVINASH"))
      result.fixedHandler = "Avinash";

    else if (upper.includes("KARTHIK"))
      result.fixedHandler = "Karthik";

    else if (upper.includes("GOPAL"))
      result.fixedHandler = "Gopal";

    else if (upper.includes("ANJI"))
      result.fixedHandler = "Anji";

    else if (upper.includes("PRADEEP"))
      result.fixedHandler = "Pradeep";

  }

  //--------------------------------------------------------
  // Remove ALL (...) for parsing
  //--------------------------------------------------------

 let cleaned = text.replace(/\(.*?\)/g, "").trim();

  //--------------------------------------------------------
  // Split Name & Time
  //--------------------------------------------------------

  let lastDash = cleaned.lastIndexOf("-");

if (lastDash < 0) {
  lastDash = cleaned.lastIndexOf("_");
}

  if (lastDash > -1) {

    result.candidate = cleanLookupName(
      cleaned.substring(0, lastDash)
    );

    const parsed = parseLookupTime(
      cleaned.substring(lastDash + 1)
    );

    result.time = parsed.time;
    result.hour = parsed.hour;
    result.minute = parsed.minute;
    result.isAM = parsed.isAM;
    result.isPM = parsed.isPM;

  }
  else {

    result.candidate = cleanLookupName(cleaned);

  }

  return result;

}

/**********************************************************************
 * NORMALIZE LOOKUP TEXT
 **********************************************************************/
function normalizeLookupText(text) {

  text = String(text || "");

  text = text.replace(/[–—]/g, "-");

  text = text.replace(/\s+/g, " ");

  return text.trim();

}

/*******************************************************
 *
 * CLEAN LOOKUP NAME
 *
 *******************************************************/
function cleanLookupName(name) {

    name = String(name || "");

    // Remove anything inside parentheses
    name = name.replace(/\(.*?\)/g, "");

    // Keep only letters, numbers and spaces
    name = name.replace(/[^A-Za-z0-9 ]/g, " ");

    // Compress multiple spaces
    name = name.replace(/\s+/g, " ");

    return name.trim();

}
/**********************************************************************
 * PARSE LOOKUP TIME
 *
 * Supports:
 *
 * 2
 * 2.30
 * 2:30
 * 2 PM
 * 2 AM
 * 2.30 PM
 * 2:30 AM
 *
 **********************************************************************/
function parseLookupTime(value){

  value = String(value || "")
            .trim()
            .toUpperCase();

  value = value.replace(/\./g, ":");

  let isAM = value.indexOf("AM") > -1;
  let isPM = value.indexOf("PM") > -1;

  value = value
            .replace("AM","")
            .replace("PM","")
            .trim();

  if(value==""){

    return {

      time:"",
      hour:-1,
      minute:0,
      isAM:false,
      isPM:false

    };

  }

  let hour=0;
  let minute=0;

  if(value.indexOf(":")>-1){

      const p=value.split(":");

      hour=parseInt(p[0],10);

      minute=parseInt(p[1],10);

  }
  else{

      hour=parseInt(value,10);

      minute=0;

  }

  if(isNaN(hour))
      hour=-1;

  if(isNaN(minute))
      minute=0;

  //-----------------------------------
  // If user didn't mention AM/PM
  //-----------------------------------

  if(!isAM && !isPM){

      isPM=true;

  }

  //-----------------------------------
  // Build display time
  //-----------------------------------

  let displayHour=hour;

  if(displayHour==0)
      displayHour=12;

  const timeString=

      displayHour+
      ":"+
      ("0"+minute).slice(-2)+
      " "+
      (isAM ? "AM" : "PM");

  return{

      time:timeString,

      hour:hour,

      minute:minute,

      isAM:isAM,

      isPM:isPM

  };

}

function editDistance(a, b) {

    a = String(a || "").toLowerCase();
    b = String(b || "").toLowerCase();

    const dp = [];

    for (let i = 0; i <= a.length; i++) {
        dp[i] = [];
        dp[i][0] = i;
    }

    for (let j = 0; j <= b.length; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {

            if (a[i - 1] === b[j - 1]) {

                dp[i][j] = dp[i - 1][j - 1];

            } else {

                dp[i][j] = Math.min(
                    dp[i - 1][j],
                    dp[i][j - 1],
                    dp[i - 1][j - 1]
                ) + 1;

            }
        }
    }

    return dp[a.length][b.length];

}

/**********************************************************************
 * NORMALIZE TIME STRING
 **********************************************************************/
function normalizeLookupTime(text){

    return parseLookupTime(text).time;

}

/*******************************************************
 *
 * GET LOOKUP ENTRIES
 * Reads ONLY Column D
 *
 *******************************************************/
function getLookupEntries() {

    const sheet = getMainSheet();

    const block = getTodayBlock();

    const values = sheet.getRange(
        block.startRow,
        COL.MATCH_TEXT,
        block.totalRows,
        1
    ).getDisplayValues();

    const list = [];

    values.forEach(function(row, index){

        const text = String(row[0]).trim();

        if(text=="")
            return;

        const obj = parseLookupEntry(text);

        obj.row = block.startRow + index;

        list.push(obj);

    });

    Logger.log(
        "Lookup Entries : " + list.length
    );

    return list;

}
/**********************************************************************
 * CONVERT TO MINUTES
 **********************************************************************/
function lookupMinutes(obj){

    if(obj.hour<0)
        return -1;

    let h=obj.hour;

    if(obj.isPM && h<12)
        h+=12;

    if(obj.isAM && h==12)
        h=0;

    return h*60+obj.minute;

}


/**********************************************************************
 * INTERVIEW TIME TO MINUTES
 **********************************************************************/
function interviewMinutes(interview){

    const parsed=parseLookupTime(

        interview.interviewTime

    );

    return lookupMinutes(parsed);

}
/**********************************************************************
 * BUILD SEARCH KEY
 **********************************************************************/
function buildSearchKey(name){

    name=String(name||"");

    name=name.toLowerCase();

    //----------------------------------
    // Remove country names
    //----------------------------------

    name=name.replace(/\buk\b/g,"");
    name=name.replace(/\bindia\b/g,"");
    name=name.replace(/\bgermany\b/g,"");
    name=name.replace(/\bireland\b/g,"");
    name=name.replace(/\busa\b/g,"");
    name=name.replace(/\bcanada\b/g,"");

    //----------------------------------
    // Remove punctuation
    //----------------------------------

    name=name.replace(/[^a-z0-9 ]/g," ");

    //----------------------------------
    // Collapse spaces
    //----------------------------------

    name=name.replace(/\s+/g," ");

    return name.trim();

}


/**********************************************************************
 * TOKENIZE
 **********************************************************************/
function tokenize(name){

    return buildSearchKey(name)
            .split(" ")
            .filter(function(x){

                return x.length>0;

            });

}


/**********************************************************************
 * NORMALIZE COMMON SHORT NAMES
 **********************************************************************/
function normalizeToken(token){

    token=String(token).toLowerCase();

    const map={

        "bharath":"bharat",

        "venkat":"venkata",

        "venky":"venkatesh",

        "dhruv":"dhruva",

        "aj":"ajay"

    };

    if(map[token])

        return map[token];

    return token;

}


/**********************************************************************
 * REMOVE DUPLICATE TOKENS
 **********************************************************************/
function uniqueTokens(list){

    const out=[];

    list.forEach(function(x){

        x=normalizeToken(x);

        if(!out.includes(x))

            out.push(x);

    });

    return out;

}
/**********************************************************************
 * SMART CANDIDATE SCORE
 **********************************************************************/
function candidateScore(a,b){

  let wordsA = uniqueTokens(
      tokenize(a)
  );

  let wordsB = uniqueTokens(
      tokenize(b)
  );

Logger.log("Lookup : " + a);
Logger.log("Master : " + b);
Logger.log("Lookup First : " + wordsA[0]);
Logger.log("Master First : " + wordsB[0]);
Logger.log("----------------");

  let score = 0;

  //-------------------------------------------------
  // First name gate
  //-------------------------------------------------

if (wordsA.length && wordsB.length) {

  const firstA = wordsA[0];
  const firstB = wordsB[0];

const distance = editDistance(firstA, firstB);

const sameFirst =
    firstA === firstB ||
    firstA.startsWith(firstB) ||
    firstB.startsWith(firstA) ||
    distance <= 2;

if (!sameFirst) {
    score -= 80;
}

}

    //-------------------------------------------------
    // Exact word
    //-------------------------------------------------

    wordsA.forEach(function(x){

        if(wordsB.includes(x))

            score+=18;

    });

//-------------------------------------------------
// Best Edit Distance Match (one bonus per lookup token)
//-------------------------------------------------

wordsA.forEach(function(x){

    let best = 999;

    wordsB.forEach(function(y){

        if(x.length >= 5 && y.length >= 5){

            best = Math.min(best, editDistance(x, y));

        }

    });

    if(best == 0){

        score += 18;

    }else if(best == 1){

        score += 18;

    }else if(best == 2){

        score += 10;

    }

});
//-------------------------------------------------
// First + Last token bonus
//-------------------------------------------------

if (
    wordsA.length >= 2 &&
    wordsB.length >= 2
) {

    const firstMatch =
        editDistance(wordsA[0], wordsB[0]) <= 1;

    const lastA = wordsA[wordsA.length - 1];
    const lastB = wordsB[wordsB.length - 1];

    const lastMatch =
        lastA.length === 1
            ? lastB.startsWith(lastA)
            : (
                lastB.length === 1
                    ? lastA.startsWith(lastB)
                    : editDistance(lastA, lastB) <= 1
              );

    if (firstMatch && lastMatch) {
        score += 20;
    }
}

    //-------------------------------------------------
    // Prefix match
    //-------------------------------------------------

    wordsA.forEach(function(x){

        wordsB.forEach(function(y){

            if(

                x.length>=3 &&

                y.startsWith(x)

            ){

                score+=12;

            }

        });

    });

    //-------------------------------------------------
    // Reverse prefix
    //-------------------------------------------------

    wordsB.forEach(function(x){

        wordsA.forEach(function(y){

            if(

                y.length>=3 &&

                x.startsWith(y)

            ){

                score+=12;

            }

        });

    });

    //-------------------------------------------------
    // Initials
    //-------------------------------------------------

    wordsA.forEach(function(x){

        wordsB.forEach(function(y){

            if(

                x.length==1 &&

                y.charAt(0)==x

            ){

                score+=10;

            }

            if(

                y.length==1 &&

                x.charAt(0)==y

            ){

                score+=10;

            }

        });

    });

    //-------------------------------------------------
    // Full name bonus
    //-------------------------------------------------

    if(

        buildSearchKey(a)==buildSearchKey(b)

    ){

        score+=60;

    }

    //-------------------------------------------------
    // First token bonus
    //-------------------------------------------------

    if(

        wordsA.length &&

        wordsB.length &&

        wordsA[0]==wordsB[0]

    ){

        score+=20;

    }

//------------------------------------
// Joined/Fuzzy Name Match
//------------------------------------

const joinedA = buildSearchKey(a).replace(/\s+/g,"");
const joinedB = buildSearchKey(b).replace(/\s+/g,"");

// Exact containment
if (
    joinedA.includes(joinedB) ||
    joinedB.includes(joinedA)
){
    score += 40;
}
else{

    // Common prefix length
    let common = 0;

    while(
        common < joinedA.length &&
        common < joinedB.length &&
        joinedA.charAt(common) === joinedB.charAt(common)
    ){
        common++;
    }

    if(common >= 6){
        score += 30;
    }

    // One name starts with the first 5 letters of the other
if (
    joinedA.substring(0,5) === joinedB.substring(0,5)
){
    score += 20;
}

} 

//------------------------------------
// Return final score
//------------------------------------

return score;

} 

/***********************************************************************
 * FIND BEST INTERVIEW
 * V2.1
 ***********************************************************************/
function findBestInterviewMatch(
    lookup,
    interviews,
    usedRows
){

    let best = null;
    let bestScore = -9999;

    interviews.forEach(function(interview){

        //----------------------------------
        // Already used
        //----------------------------------

        if (usedRows.has(interview.row))
            return;

        //----------------------------------
        // Calculate score
        //----------------------------------

        const score = calculateMatchScore(
            lookup,
            interview
        );

        //----------------------------------
        // Better score
        //----------------------------------

        if (score > bestScore) {

            bestScore = score;
            best = interview;

        }

        //----------------------------------
        // Same score -> Compare name only
        //----------------------------------

        else if (score === bestScore && best) {

    const currentKey =
        buildSearchKey(interview.candidate);

    const previousKey =
        buildSearchKey(best.candidate);

    const lookupKey =
        buildSearchKey(lookup.candidate);

    const currentDiff =
        Math.abs(currentKey.length - lookupKey.length);

    const previousDiff =
        Math.abs(previousKey.length - lookupKey.length);

    if (currentDiff < previousDiff) {

        best = interview;

    }

}
    });

    //----------------------------------
    // Nothing found
    //----------------------------------

    if (!best)
        return null;

    return {

        interview: best,

        score: bestScore

    };

}
/**********************************************************************
 * SMART MATCH SCORE
 **********************************************************************/
function calculateMatchScore(
    lookup,
    interview
){

    let score=0;

    //---------------------------------------------------
    // NAME
    //---------------------------------------------------

    score+=candidateScore(

        lookup.candidate,

        interview.candidate

    );

    //---------------------------------------------------
    // TIME
    //---------------------------------------------------

    score+=timeScore(

        lookup,

        interview

    );

    //---------------------------------------------------
    // COUNTRY BONUS
    //---------------------------------------------------

    if(
        lookup.raw.toUpperCase().includes("UK") &&
        interview.country=="UK"
    ){

        score+=8;

    }

    if(
        lookup.raw.toUpperCase().includes("GERMANY") &&
        interview.country=="Germany"
    ){

        score+=8;

    }

    if(
        lookup.raw.toUpperCase().includes("IRELAND") &&
        interview.country=="Ireland"
    ){

        score+=8;

    }

    //---------------------------------------------------
    // Fixed Handler
    //---------------------------------------------------

    if(
        lookup.fixedHandler &&
        interview.fixedHandler &&
        lookup.fixedHandler==
        interview.fixedHandler
    ){

        score+=30;

    }

    return score;

}
function timeScore(lookup, interview){

    const lookupClock =
        lookup.time.replace(" AM","").replace(" PM","");

    const interviewClock =
        interview.interviewTime.replace(" AM","").replace(" PM","");

    //------------------------------------------------
    // Same clock time (1:30 == 1:30)
    // Ignore AM / PM completely
    //------------------------------------------------

    if (lookupClock == interviewClock)
        return 40;

    //------------------------------------------------
    // Compare actual minutes
    //------------------------------------------------

    const m1 = lookupMinutes(lookup);
    const m2 = interviewMinutes(interview);

    if (m1 < 0 || m2 < 0)
        return 0;

    const diff = Math.abs(m1 - m2);

    if (diff <= 5)
        return 40;

    if (diff <= 15)
        return 20;

    return 0;

}
/**********************************************************************
 * BUILD MATCHES
 * V2.0
 *
 * Uses:
 * 1. Best score
 * 2. Avoid duplicate interview usage
 * 3. Reject poor matches
 **********************************************************************/
function buildMatches(){

    const lookupEntries=getLookupEntries();

    const interviews=getInterviewObjects();

    const usedRows=new Set();

    const matches=[];

    //----------------------------------------------------
    // Sort lookups
    // Longer names first
    //----------------------------------------------------

    lookupEntries.sort(function(a,b){

        return b.candidate.length-a.candidate.length;

    });

    //----------------------------------------------------
    // Match each lookup
    //----------------------------------------------------

    lookupEntries.forEach(function(lookup){

        const result=findBestInterviewMatch(

            lookup,

            interviews,

            usedRows

        );

        //------------------------------------

        if(result){

            if(result.score>=80){

                usedRows.add(

                    result.interview.row

                );

            }

        }

        //------------------------------------

        matches.push({

            lookupRow:lookup.row,

            lookup:lookup,

            interview:

                result ?

                result.interview :

                null,

            score:

                result ?

                result.score :

                0

        });

    });

    //----------------------------------------------------
    // Restore original sheet order
    //----------------------------------------------------

    matches.sort(function(a,b){

        return a.lookupRow-b.lookupRow;

    });

    return matches;

}
/**********************************************************************
 * MATCH CONFIDENCE
 **********************************************************************/
function getConfidence(score){

    if(score>=180)
        return "Excellent";

    if(score>=150)
        return "Very High";

    if(score>=120)
        return "High";

    if(score>=90)
        return "Medium";

    if(score>=80)
        return "Low";

    return "Reject";

}
/**********************************************************************
 * GET MATCH
 **********************************************************************/
function getMatchByLookupRow(row){

    const matches=buildMatches();

    for(let i=0;i<matches.length;i++){

        if(matches[i].lookupRow==row){

            return matches[i];

        }

    }

    return null;

}
/**********************************************************************
 * WRITE MATCHES TO COLUMN E
 * V2.0
 **********************************************************************/
function writeMatchesToSheet(){

    const sheet=SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName(SHEET_NAME);

    const matches=buildMatches();

    let updated=0;
    let rejected=0;

    matches.forEach(function(match){

        const cell=sheet.getRange(match.lookupRow,COL.EXTRACTED);

        //----------------------------------------
        // No Interview Found
        //----------------------------------------

        if(!match.interview){

            cell
                .clearContent()
                .setBackground(COLORS.MATCH_NOT_FOUND);

            rejected++;

            Logger.log(
                "Row "+match.lookupRow+
                " -> No Match"
            );

            return;

        }

        //----------------------------------------
        // Low Confidence
        //----------------------------------------

        if(match.score<80){

            cell
                .clearContent()
                .setBackground(COLORS.MATCH_NOT_FOUND);

            rejected++;

            Logger.log(

                "Row "+
                match.lookupRow+

                " rejected ("+

                match.lookup.candidate+

                ") Score="+

                match.score+

                " Best="+

                match.interview.candidate

            );

            return;

        }

        //----------------------------------------
        // Write Match
        //----------------------------------------

       Logger.log(
    "Writing to Row: " + match.lookupRow
);

Logger.log(
    "Text: " + match.interview.raw
);

cell.setValue(match.interview.raw);

SpreadsheetApp.flush();

Logger.log(
    "Cell After Write: " +
    cell.getDisplayValue()
);

updated++;
    });

    //----------------------------------------
    // Summary
    //----------------------------------------

    SpreadsheetApp
        .getActiveSpreadsheet()
        .toast(

            updated+
            " matched | "+

            rejected+
            " unmatched",

            "Interview Bot",

            6

        );

    Logger.log(

        "Matched : "+updated+

        "\nRejected : "+rejected

    );

}
/**********************************************************************
 * SHOW UNMATCHED ROWS
 **********************************************************************/
function showRejectedMatches(){

    const matches=buildMatches();

    const rejected=[];

    matches.forEach(function(m){

        if(!m.interview){

            rejected.push({

                row:m.lookupRow,

                candidate:m.lookup.candidate,

                reason:"No Interview Found"

            });

            return;

        }

        if(m.score<80){

            rejected.push({

                row:m.lookupRow,

                candidate:m.lookup.candidate,

                best:m.interview.candidate,

                score:m.score,

                reason:"Low Score"

            });

        }

    });

    Logger.log(

        JSON.stringify(

            rejected,

            null,

            2

        )

    );

}
/**********************************************************************
 * MAIN ENTRY
 **********************************************************************/
function extractTodayInterviews(){

    writeMatchesToSheet();

}
/**********************************************************************
 * TEST
 **********************************************************************/
function testWriteMatches(){

    writeMatchesToSheet();

    showRejectedMatches();

}
function testTodayRows(){

  const rows = getTodayRows();

  Logger.log(rows.length);

  Logger.log(JSON.stringify(rows[0], null, 2));

}
function testLookupParser() {

  const rows = getLookupEntries();

  Logger.log(rows[0]);

}
