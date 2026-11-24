/******************************************************
 * PARSER.GS
 * Version 5.6.5 - ROLE-BOUNDARY REPAIR PRESERVATION
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
      "Raw Data sheet not found in shared operations workbook."
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
      "Team Data sheet not found in shared operations workbook."
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

    //------------------------------------------------
    // Operational status is independent of round parsing.
    //
    // Selected rows use a selection-safe parser so a
    // Discussion / Technical Discussion / unusual stage
    // cannot make the ₹2,000 Selection disappear.
    //------------------------------------------------

    const status =
      String(colD || "")
        .trim()
        .toLowerCase();

    let interview = null;

    if(status === "selected"){

      interview =
        parseSelectedTeamInterviewFallback_(
          colB
        );

    }else{

      interview =
        parseInterview(
          colB
        );

    }

    if(!interview)
      continue;

    interview.handler =
      String(colC || "").trim();

    interview.status =
      status;

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
/******************************************************
 * SELECTED TEAM ROW FALLBACK PARSER
 *
 * Selection is an operational outcome and MUST NOT depend
 * on whether the source has a numbered/final round.
 *
 * This parser is used ONLY for Team Data rows whose
 * Column D status is Selected.
 *
 * It does not change Raw Data parsing.
 ******************************************************/
function parseSelectedTeamInterviewFallback_(
  source
){

  const original =
    String(
      source || ""
    ).trim();

  if(!original)
    return null;

  const text =
    original
      .replace(
        /[–—]/g,
        "-"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  //--------------------------------------------------
  // Candidate
  //--------------------------------------------------

  const firstDash =
    text.indexOf(
      "-"
    );

  if(firstDash < 0)
    return null;

  let candidate =
    text
      .substring(
        0,
        firstDash
      )
      .replace(
        /\([^)]*\)/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if(!candidate)
    return null;

  candidate = PARSER_identityCanonicalCandidate_(candidate);

  //--------------------------------------------------
  // Client
  //
  // Supports the established interview/call variants.
  // Client may appear after type or before type.
  //--------------------------------------------------

  const typePattern =
    "(?:Interview|Technical\\s+Interview|Technical\\s+Coding\\s+Interview|Excel\\s+Interview|AI\\s+Interview|Panel\\s+Interview|Hiring\\s+Manager\\s+Interview|Manager\\s+Interview|Assessment\\s+Interview|Zoom\\s+Interview|Teams\\s+Interview|Microsoft\\s+Teams\\s+Interview|Google\\s+Meet\\s+Interview|Phone\\s+Interview|Phn\\s+Interview|Phone\\s+Call|Phn\\s+Call|Google\\s+Voice\\s+Call|Recruiter\\s+Call|Phone\\s+Screen|Prep\\s+Call)";

  const tail =
    text
      .substring(
        firstDash + 1
      )
      .trim();

  let client = "";

  const directRegex =
    new RegExp(
      "^\\s*" +
      typePattern +
      "\\s*-\\s*" +
      "(.+?)" +
      "\\s*-\\s*" +
      "(?:\\d{1,2})(?::\\d{2})?\\s*(?:AM|PM)\\b",
      "i"
    );

  const directMatch =
    directRegex.exec(
      tail
    );

  if(directMatch){

    client =
      String(
        directMatch[1] || ""
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

  }

  if(!client){

    const clientBeforeTypeRegex =
      new RegExp(
        "^\\s*" +
        "(.+?)" +
        "\\s*-\\s*" +
        typePattern +
        "\\s*-\\s*" +
        "(?:\\d{1,2})(?::\\d{2})?\\s*(?:AM|PM)\\b",
        "i"
      );

    const beforeTypeMatch =
      clientBeforeTypeRegex.exec(
        tail
      );

    if(beforeTypeMatch){

      client =
        String(
          beforeTypeMatch[1] || ""
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

    }

  }

  if(!client)
    return null;

  const selectedClientInfo =
    PARSER_identityResolveClientRoleFromText_(client);

  client = selectedClientInfo.client;

  if(!client)
    return null;

  //--------------------------------------------------
  // Round and stage are independent.
  //
  // Numeric round wins when explicitly present.
  // Explicit "Final Round" is Final.
  // "Final Discussion" alone is NOT Final Round.
  //--------------------------------------------------

  let round = "";
  let roundNo = 0;

  const numberedRound =
    /\b(\d+)\s*(st|nd|rd|th)\s*[-:;,./]?\s*Round\b/i
      .exec(
        text
      );

  if(numberedRound){

    round =
      numberedRound[0];

    roundNo =
      parseInt(
        numberedRound[1],
        10
      );

  }else{

    const finalRound =
      /\bFinal\s+Round\b/i
        .exec(
          text
        );

    if(finalRound){

      round =
        "Final";

      roundNo =
        999;

    }else{

      const stage =
        /\b(?:Final Technical Discussion|Final Discussion|Technical Discussion w\/?\s*Hiring Manager|Technical Discussion|Discussion Round|Discussion|Technical Round|Screening Round)\b/i
          .exec(
            text
          );

      round =
        stage
          ? stage[0]
          : "";

      roundNo =
        0;

    }

  }

  //--------------------------------------------------
  // Time
  //--------------------------------------------------

  let time = "";

  const timeMatch =
    /(\d{1,2}(?::\d{2})?\s*[AP]M)/i
      .exec(
        text
      );

  if(timeMatch){

    time =
      timeMatch[1]
        .toUpperCase();

  }

  return {

    candidate:
      candidate,

    client:
      client,

    role:
      selectedClientInfo.role || "",

    round:
      round,

    roundNo:
      roundNo,

    time:
      time,

    selectedFallback:
      true

  };

}


/******************************************************
 * READ-ONLY REGRESSION TEST FOR SELECTED TEAM PARSER
 ******************************************************/
function testSelectedTeamParserFallback(){

  const cases = [

    {
      name:
        "Discussion selected",
      text:
        "Achyuth gowtham - interview- Michigan Department of Community Health -12:00 AM IST - Discussion Round",
      candidate:
        "Achyuth gowtham",
      client:
        "Michigan Department of Community Health",
      roundNo:
        0
    },

    {
      name:
        "Normal numbered selected",
      text:
        "Krishnaveni Dharavath – Interview – Verizon – 12:00 AM IST – Duration: 60 Mins (3rd Round)",
      candidate:
        "Krishnaveni Dharavath",
      client:
        "Verizon",
      roundNo:
        3
    },

    {
      name:
        "Final discussion is not Final Round",
      text:
        "Example Candidate – Interview – Example Client – 10:00 PM IST – Final Technical Discussion",
      candidate:
        "Example Candidate",
      client:
        "Example Client",
      roundNo:
        0
    },

    {
      name:
        "Explicit Final Round",
      text:
        "Example Candidate – Interview – Example Client – 10:00 PM IST – Final Technical Discussion (Final Round)",
      candidate:
        "Example Candidate",
      client:
        "Example Client",
      roundNo:
        999
    }

  ];

  let passed = 0;

  const results =
    cases.map(
      function(test){

        const actual =
          parseSelectedTeamInterviewFallback_(
            test.text
          );

        const ok =
          !!actual &&
          actual.candidate ===
            test.candidate &&
          actual.client ===
            test.client &&
          Number(actual.roundNo) ===
            Number(test.roundNo);

        if(ok)
          passed++;

        return {
          name:
            test.name,
          ok:
            ok,
          actual:
            actual
        };

      }
    );

  const result = {
    ok:
      passed ===
        cases.length,
    passed:
      passed,
    total:
      cases.length,
    results:
      results
  };

  Logger.log(
    "========== SELECTED TEAM PARSER TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "=============================================="
  );

  return result;
}


function parseInterview(text){

  const original =
    String(text || "").trim();

  if(!original)
    return null;

  const value =
    PARSER_normalizeInterviewText_(
      original
    );

  //--------------------------------------------------
  // Candidate
  //--------------------------------------------------

  const firstDash =
    value.indexOf(" - ");

  if(firstDash < 0)
    return null;

  let candidate =
    value
      .substring(0,firstDash)
      .replace(/\([^)]*\)/g," ")
      .replace(/\s+/g," ")
      .trim();

  if(!candidate)
    return null;

  candidate = PARSER_identityCanonicalCandidate_(candidate);

  //--------------------------------------------------
  // Round
  // IMPORTANT: explicit numbered round wins over
  // descriptive words such as "Final Interview".
  //--------------------------------------------------

  const roundInfo =
    PARSER_extractRound_(
      value
    );

  if(!roundInfo)
    return null;

  //--------------------------------------------------
  // Time
  //--------------------------------------------------

  const timeMatch =
    value.match(
      /\b(\d{1,2})(?::(\d{2}))?\s*([AP]M)\b/i
    );

  let time = "";

  if(timeMatch){

    const hour =
      parseInt(
        timeMatch[1],
        10
      );

    const minute =
      timeMatch[2] || "00";

    time =
      hour +
      ":" +
      minute +
      " " +
      String(timeMatch[3] || "")
        .toUpperCase();

  }

  //--------------------------------------------------
  // Client
  //--------------------------------------------------

  let clientInfo =
    PARSER_extractClientRole_(
      value,
      firstDash,
      timeMatch
    );

  //--------------------------------------------------
  // HISTORICAL FORMAT RECONCILIATION (v1.6)
  //
  // Older rows may contain only Client while newer rows
  // contain Client + Role.  Re-resolve the complete source
  // against Client Master / Client Name Map so both formats
  // collapse to the same canonical Client identity.
  //--------------------------------------------------

  clientInfo =
    PARSER_reconcileClientFromFullSourceV16_(
      original,
      clientInfo
    );

  const client = clientInfo.client;

  if(!client)
    return null;

  return {

    candidate:
      candidate,

    client:
      client,

    role:
      clientInfo.role || "",

    round:
      roundInfo.round,

    roundNo:
      roundInfo.roundNo,

    time:
      time,

    isLoopInterview:
      /\bLoop\s+Interview\b/i.test(
        value
      ),

    originalText:
      original

  };

}


/******************************************************
 * NORMALIZE INTERVIEW TEXT
 *
 * Keeps the original meaning while normalizing the
 * delimiter styles used in Raw / Team Data:
 *   –  —  -  --  ---
 ******************************************************/
function PARSER_normalizeInterviewText_(text){

  return String(text || "")
    .replace(/[–—]/g,"-")
    .replace(/-{2,}/g," - ")
    .replace(/\s*-\s*/g," - ")
    .replace(/\s+/g," ")
    .trim();

}


/******************************************************
 * EXTRACT ROUND
 *
 * Priority:
 * 1. Explicit numbered round
 * 2. Final only when no numbered round exists
 *
 * Supported examples:
 *  4th Round
 *  Round 4
 *  Round-4
 *  Round: 4
 *  R4
 *  4th Rd
 *  4 Round
 ******************************************************/
function PARSER_extractRound_(text){

  const value =
    String(text || "");

  const patterns = [
    // Standard:
    //   2nd Round
    // Live punctuation variants:
    //   2Nd; Round
    //   2nd, Round
    //   2nd: Round
    //   2nd - Round
    /\b(\d{1,2})\s*(?:st|nd|rd|th)\s*[-:;,./]?\s*(?:Round|Rd)\b/i,

    /\bRound\s*[-:#;,./]?\s*(\d{1,2})\b/i,
    /\bR\s*[-:#;,./]?\s*(\d{1,2})\b/i,

    // 2 Round / 2; Round
    /\b(\d{1,2})\s*[-:;,./]?\s*Round\b/i
  ];

  for(let i=0;i<patterns.length;i++){

    const match =
      value.match(
        patterns[i]
      );

    if(!match)
      continue;

    const roundNo =
      parseInt(
        match[1],
        10
      );

    if(
      !isNaN(roundNo) &&
      roundNo > 0
    ){

      return {
        round:
          PARSER_roundLabel_(
            roundNo
          ),
        roundNo:
          roundNo
      };

    }

  }

  //--------------------------------------------------
  // Explicit "Candidate first interview" wording is a
  // safe first-round declaration even when the source
  // forgot to write "(1st Round)".  This is intentionally
  // narrow; a completely round-less call is still NOT
  // auto-assumed to be Round 1.
  //--------------------------------------------------

  if(
    /\bCandidate\s+(?:1st|first)\s+Interview\b/i.test(value) ||
    /\bCandidate\s+(?:1st|first)\s+Call\b/i.test(value)
  ){
    return {
      round: "1st Round",
      roundNo: 1
    };
  }

  //--------------------------------------------------
  // "Final" is used only when the text did not give
  // us an explicit numbered round.
  //--------------------------------------------------

  if(/\bFinal\b/i.test(value)){

    return {
      round:
        "Final",
      roundNo:
        999
    };

  }

  return null;

}


/******************************************************
 * CANONICAL ROUND LABEL
 ******************************************************/
function PARSER_roundLabel_(roundNo){

  const n =
    Number(roundNo) || 0;

  if(n <= 0)
    return "";

  const mod100 = n % 100;

  let suffix = "th";

  if(mod100 < 11 || mod100 > 13){

    if(n % 10 === 1)
      suffix = "st";
    else if(n % 10 === 2)
      suffix = "nd";
    else if(n % 10 === 3)
      suffix = "rd";

  }

  return n + suffix + " Round";

}


/******************************************************
 * EXTRACT CLIENT
 *
 * The client can be before OR after the interview
 * descriptor. Stage text is ignored.
 *
 * Examples handled:
 *  Interview - AbbVie - Interview - 11:30 PM
 *  Interview - Technical Interview - Harlingen CISD
 *  Interview - Assessment Through Interview - YoungWilliams
 *  McGrath RentCorp - Interview - 3:00 AM
 *  Interview - interview (round 1) - Maxim Healthcare
 ******************************************************/
function PARSER_extractClientRole_(
  value,
  firstDash,
  timeMatch
){

  let endIndex =
    value.length;

  if(
    timeMatch &&
    typeof timeMatch.index === "number"
  ){
    endIndex =
      timeMatch.index;
  }

  let middle =
    value
      .substring(
        firstDash + 3,
        endIndex
      )
      .replace(/\s*-\s*$/," ")
      .replace(/\s+/g," ")
      .trim();

  if(!middle)
    return "";

  const parts =
    middle
      .split(/\s+-\s+/)
      .map(function(part){
        return String(part || "")
          .trim();
      })
      .filter(function(part){
        return !!part;
      });

  const clientParts = [];

  parts.forEach(function(part){

    if(
      PARSER_isInterviewDescriptor_(part) ||
      PARSER_isIdentityContextQualifier_(part)
    ){
      return;
    }

    const cleaned =
      PARSER_cleanClientPart_(
        part
      );

    if(
      !cleaned ||
      PARSER_isInterviewDescriptor_(cleaned) ||
      PARSER_isIdentityContextQualifier_(cleaned)
    ){
      return;
    }

    clientParts.push(cleaned);

  });

  if(!clientParts.length)
    return {client:"",role:""};

  return PARSER_identityResolveClientRoleFromParts_(clientParts);

}

// Compatibility wrapper for any older helper that still expects only Client.
function PARSER_extractClient_(value,firstDash,timeMatch){
  return PARSER_extractClientRole_(value,firstDash,timeMatch).client;
}


/******************************************************
 * INTERVIEW / STAGE DESCRIPTOR?
 ******************************************************/
function PARSER_isInterviewDescriptor_(part){

  let value =
    String(part || "")
      .replace(
        /\([^)]*(?:Round|Rd|Final)[^)]*\)/ig,
        " "
      )
      .replace(/\s+/g," ")
      .trim()
      .toLowerCase();

  if(!value)
    return true;

  return /^(?:interview|interview\s+call|behavioral\s+interview|final\s+interview|technical\s+(?:i?nterview|coding\s+interview)|excel\s+interview|ai\s+interview|panel\s+interview|hiring\s+manager\s+interview|manager\s+interview|assessment\s+interview|assessment\s+through\s+interview|coding\s+interview|zoom\s+interview|teams\s+interview|microsoft\s+teams\s+interview|google\s+meet\s+interview|phone\s+interview|phn\s+interview|loop\s+interview|phone\s+call|phn\s+call|google\s+voice\s+call|recruiter\s+call|phone\s+screen|prep\s+call|final\s+technical\s+discussion|final\s+discussion|technical\s+discussion(?:\s+w\/?\s*hiring\s+manager)?|discussion\s+round|discussion|technical\s+round|screening\s+round)$/i.test(
    value
  );

}


/******************************************************
 * NON-IDENTITY CONTEXT TOKEN?
 *
 * Country/work-arrangement tags sometimes appear after
 * the Interview descriptor instead of after Candidate.
 * They are never part of Candidate or Client identity.
 ******************************************************/
function PARSER_isIdentityContextQualifier_(part){

  const value =
    String(part || "")
      .replace(/[()]/g," ")
      .replace(/\s+/g," ")
      .trim()
      .toLowerCase();

  if(!value)
    return true;

  return /^(?:uk|u\.?k\.?|ireland|canada|india|usa|u\.?s\.?a?\.?|united\s+states|c2c|corp\s+to\s+corp|ir)$/i.test(value);

}


/******************************************************
 * CLEAN CLIENT PART
 ******************************************************/
function PARSER_cleanClientPart_(part){

  let value =
    String(part || "")
      .replace(
        /\([^)]*(?:Round|Rd)[^)]*\)/ig,
        " "
      )
      // Country/work tags can be embedded at the beginning.
      .replace(
        /^\s*\((?:UK|Ireland|Canada|India|USA|US|C2C|IR)\)\s*/i,
        ""
      )
      // Remove known stage/medium prefixes even when they are glued to
      // the client instead of separated by a dash, e.g. "Interview Veeva".
      .replace(
        /^\s*(?:Interview|Interview\s+Call|Loop\s+Interview|Technical\s+(?:I?nterview|Coding\s+Interview)|Behavioral\s+Interview|Panel\s+Interview|Final\s+Interview|Assessment(?:\s+Through)?\s+Interview|Coding\s+Interview|Phone\s+Interview|Phn\s+Interview|Phone\s+Call|Phn\s+Call|Recruiter\s+Call|Phone\s+Screen|Prep\s+Call)\b\s*[:\-]?\s*/i,
        ""
      )
      .replace(
        /\s*[:\-]?\s*(?:Loop|Technical|Behavioral|Final|Panel|Assessment\s+Through|Assessment)\s+Interview\s*$/i,
        ""
      )
      .replace(
        /\s*[:\-]?\s*Interview\s*$/i,
        ""
      )
      .replace(/\s+/g," ")
      .trim();

  return value;

}


/******************************************************
 * READ-ONLY TEST:
 * LOOP INTERVIEW CLIENT PARSER
 ******************************************************/
function testLoopInterviewParser(){

  const second =
    parseInterview(
      "Venkata Koushik Reddy Varikoti – Interview – HD Supply – 1:45 AM IST – Duration: 30 Mins (2nd Round)"
    );

  const third =
    parseInterview(
      "Venkata Koushik Reddy Varikoti – Interview – Loop Interview - HD Supply – 6:30 PM IST – Duration: 30 Mins (3rd Round)"
    );

  if(
    !second ||
    !third ||
    second.client !== "HD Supply" ||
    third.client !== "HD Supply" ||
    Number(second.roundNo) !== 2 ||
    Number(third.roundNo) !== 3
  ){
    throw new Error(
      "TEST_FAILED|LOOP_INTERVIEW_PARSER"
    );
  }

  return {
    ok:
      true,
    second:
      second,
    third:
      third
  };

}
/******************************************************
 * CENTRAL CANDIDATE / CLIENT IDENTITY HELPERS
 *
 * Role is informational only. It is NEVER part of the
 * promotion/selection identity. Only exact canonical or
 * approved-alias matches auto-resolve here; fuzzy matching
 * belongs to the Portal review UI.
 ******************************************************/
const PARSER_IDENTITY_CONTROL_PROPERTY_ =
  "PROMOTION_IDENTITY_CONTROL_WORKBOOK_ID";

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
    .filter(function(part){
      return !PARSER_isInterviewDescriptor_(part) &&
             !PARSER_isIdentityContextQualifier_(part);
    })
    .map(PARSER_cleanClientPart_)
    .filter(Boolean)
    .filter(function(part){
      return !PARSER_isInterviewDescriptor_(part) &&
             !PARSER_isIdentityContextQualifier_(part);
    });
  return PARSER_identityResolveClientRoleFromParts_(parts);
}

function PARSER_identityResolveClientRoleFromParts_(parts){

  const cleanParts =
    (parts || [])
      .map(PARSER_identityClean_)
      .filter(Boolean)
      .filter(function(part){
        return !PARSER_isInterviewDescriptor_(part) &&
               !PARSER_isIdentityContextQualifier_(part);
      });

  if(!cleanParts.length){
    return {
      client:"",
      role:"",
      resolved:false,
      roleBoundary:false
    };
  }

  const idx =
    PARSER_identityIndex_();

  //--------------------------------------------------
  // v1.8 RIGHT-BOUNDARY CLIENT/ROLE DETECTION
  //
  // We first find every possible boundary where the
  // RIGHT side looks like a job Role.
  //
  // Examples:
  //
  // Aspenpublishing | Quality Assurance/Operations Analyst
  //
  // UC Davis Health | Business Systems Analyst 3
  //
  // H - E Parts International | Data and Integration Engineer
  //
  // TD Bank Group | Data Designer II (US) - Business System Analyst
  //
  // Important:
  // We do NOT split at the first hyphen.
  //--------------------------------------------------

  const boundaries = [];

  for(
    let i=1;
    i<cleanParts.length;
    i++
  ){

    const roleCandidate =
      cleanParts
        .slice(i)
        .join(" - ");

    if(
      !PARSER_isLikelyRoleSuffixV18_(
        roleCandidate
      )
    ){
      continue;
    }

    const clientCandidate =
      cleanParts
        .slice(0,i)
        .join(" - ");

    const key =
      PARSER_identityKey_(
        clientCandidate
      );

    const exact =
      idx.clientAlias[key] ||
      idx.clientByName[key] ||
      idx.localClientByName[key] ||
      null;

    boundaries.push({
      index:i,
      clientCandidate:clientCandidate,
      roleCandidate:roleCandidate,
      exact:exact,
      exactType:
        idx.clientAlias[key]
          ? "CLIENT_NAME_MAP"
          : (
              idx.clientByName[key]
                ? "CLIENT_MASTER"
                : (
                    idx.localClientByName[key]
                      ? "LOCAL_CLIENT_ALIAS"
                      : ""
                  )
            )
    });

  }

  if(boundaries.length){

    //------------------------------------------------
    // Prefer an authoritative prefix when available.
    //
    // If multiple authoritative boundaries exist, use
    // the LEFTMOST one because that is where Role begins.
    //
    // Example:
    // TD Bank Group | Data Designer II - Business Analyst
    //------------------------------------------------

    const authoritative =
      boundaries.filter(
        function(item){
          return !!item.exact;
        }
      );

    let chosen = null;

    if(authoritative.length){

      authoritative.sort(
        function(a,b){
          return a.index - b.index;
        }
      );

      chosen =
        authoritative[0];

    }else{

      //------------------------------------------------
      // No clean base Client exists in Master yet.
      //
      // Keep the LONGEST plausible Client prefix
      // (rightmost role boundary). This avoids turning:
      //
      // H - E Parts International - Role
      //
      // into Client = H.
      //------------------------------------------------

      boundaries.sort(
        function(a,b){
          return b.index - a.index;
        }
      );

      chosen =
        boundaries[0];

    }

    const canonicalClient =
      chosen.exact
        ? chosen.exact.name
        : chosen.clientCandidate;

    return {
      client:
        canonicalClient,
      role:
        chosen.roleCandidate,
      resolved:
        !!chosen.exact,
      roleBoundary:
        true,
      source:
        chosen.clientCandidate,
      sourceType:
        chosen.exactType ||
        "ROLE_BOUNDARY_DERIVED_V18"
    };

  }

  //--------------------------------------------------
  // No Role boundary detected.
  //
  // Use the existing longest authoritative exact/alias
  // Client match.
  //--------------------------------------------------

  for(
    let count=cleanParts.length;
    count>=1;
    count--
  ){

    const source =
      cleanParts
        .slice(0,count)
        .join(" - ");

    const key =
      PARSER_identityKey_(
        source
      );

    const hit =
      idx.clientAlias[key] ||
      idx.clientByName[key] ||
      null;

    if(hit){

      return {
        client:
          hit.name,
        role:
          cleanParts
            .slice(count)
            .join(" - "),
        resolved:
          true,
        roleBoundary:
          false,
        source:
          source,
        sourceType:
          idx.clientAlias[key]
            ? "CLIENT_NAME_MAP"
            : "CLIENT_MASTER"
      };

    }

  }

  //--------------------------------------------------
  // Compatibility-only local client knowledge.
  //--------------------------------------------------

  for(
    let count=cleanParts.length;
    count>=1;
    count--
  ){

    const source =
      cleanParts
        .slice(0,count)
        .join(" - ");

    const key =
      PARSER_identityKey_(
        source
      );

    const hit =
      idx.localClientByName[key] ||
      null;

    if(hit){

      return {
        client:
          hit.name,
        role:
          cleanParts
            .slice(count)
            .join(" - "),
        resolved:
          true,
        roleBoundary:
          false,
        source:
          source,
        sourceType:
          "LOCAL_CLIENT_ALIAS"
      };

    }

  }

  //--------------------------------------------------
  // Unknown format without a confident role boundary.
  // Preserve old safe behavior.
  //--------------------------------------------------

  return {
    client:
      cleanParts[0],
    role:
      cleanParts
        .slice(1)
        .join(" - "),
    resolved:
      false,
    roleBoundary:
      false,
    source:
      cleanParts[0]
  };

}


/******************************************************
 * STRONG ROLE-LIKE SUFFIX?
 *
 * Conservative list. Generic words like "Data" or
 * "Operations" alone are intentionally NOT enough.
 ******************************************************/
function PARSER_isLikelyRoleSuffixV18_(value){

  const text =
    String(value || "")
      .toLowerCase()
      .replace(/[()]/g," ")
      .replace(/\s+/g," ")
      .trim();

  if(!text)
    return false;

  return /\b(?:analyst|engineer|developer|administrator|architect|specialist|technician|consultant|coordinator|manager|director|scientist|designer|programmer|lead|officer|associate|representative|recruiter|auditor|advisor|adviser|planner|strategist|supervisor|educator|administrator|quality\s+assurance|business\s+systems?|systems?\s+analyst|clinical\s+content|risk\s+adjustment|provider\s+educator|process\s+improvement|full\s+stack|devops|data\s+engineer|data\s+analyst|business\s+analyst|systems?\s+engineer|software\s+engineer|platform\s+engineer|integration\s+engineer|application\s+analyst|applications\s+analyst|support\s+technician|health\s+economist|health\s+interoperability\s+specialist|revenue\s+cycle\s+analyst|rcm\s+analyst)\b/i
    .test(text);

}


/******************************************************
 * Backward-compatible name used by v1.7 code/tests.
 ******************************************************/
function PARSER_isLikelyRoleSuffixV17_(value){
  return PARSER_isLikelyRoleSuffixV18_(value);
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

  // Existing production client knowledge remains a compatibility source while
  // Client Master grows from Handler-confirmed mappings.
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


/******************************************************
 * HISTORICAL CLIENT / ROLE IDENTITY RECONCILIATION
 * Version 1.6
 *
 * WHY:
 * Old records:
 *   Candidate - Interview - Client - ...
 *
 * New records:
 *   Candidate - Interview - Client - Role - ...
 *
 * Promotion identity must remain:
 *   Candidate + Canonical Client
 *
 * Role is metadata only and MUST NOT enter the
 * Candidate/Client promotion key.
 ******************************************************/

function PARSER_reconcileClientFromFullSourceV16_(
  originalText,
  currentClientInfo
){

  const current =
    currentClientInfo || {
      client:"",
      role:"",
      resolved:false,
      roleBoundary:false
    };

  const original =
    String(
      originalText || ""
    ).trim();

  //--------------------------------------------------
  // v1.8:
  // If the parts parser identified a strong Role
  // boundary, DO NOT let a polluted longer Client Master
  // entry merge Role back into Client.
  //--------------------------------------------------

  if(
    current.roleBoundary &&
    current.client
  ){

    const exactBase =
      PARSER_identityCanonicalClientV16_(
        current.client
      );

    return {
      client:
        exactBase ||
        current.client,
      role:
        current.role || "",
      resolved:
        !!exactBase ||
        !!current.resolved,
      roleBoundary:
        true,
      source:
        current.source ||
        current.client ||
        "",
      matchedBy:
        exactBase
          ? "ROLE_BOUNDARY_MASTER_V18"
          : "ROLE_BOUNDARY_DERIVED_V18"
    };

  }

  //--------------------------------------------------
  // Otherwise retain exact/full-source canonicalization.
  //--------------------------------------------------

  const currentCanonical =
    PARSER_identityCanonicalClientV16_(
      current.client
    );

  const fullHit =
    PARSER_identityFindClientInFullSourceV16_(
      original
    );

  if(fullHit && fullHit.client){

    return {
      client:
        fullHit.client,
      role:
        current.role || "",
      resolved:
        true,
      roleBoundary:
        false,
      source:
        fullHit.source ||
        current.source ||
        "",
      matchedBy:
        fullHit.matchType === "CLIENT_NAME_MAP"
          ? "VERIFIED_CLIENT_ALIAS_V18"
          : "FULL_SOURCE_MASTER_V18"
    };

  }

  if(currentCanonical){

    return {
      client:
        currentCanonical,
      role:
        current.role || "",
      resolved:
        true,
      roleBoundary:
        false,
      source:
        current.source ||
        current.client ||
        "",
      matchedBy:
        "EXACT_CLIENT_MASTER_V18"
    };

  }

  return current;

}


/******************************************************
 * REPAIR AN ALREADY PARSED RECORD
 *
 * PromotionEngine calls this again before grouping.
 * That makes v1.6 safe for records produced by:
 * - older Parser versions
 * - current Parser
 * - Team Data selected fallback parser
 ******************************************************/
function PARSER_repairPromotionRecordIdentityV16_(
  record
){

  if(!record)
    return record;

  const repaired =
    Object.assign(
      {},
      record
    );

  //--------------------------------------------------
  // Candidate exact canonicalization.
  //--------------------------------------------------

  repaired.candidate =
    PARSER_identityCanonicalCandidate_(
      repaired.candidate || ""
    );

  //--------------------------------------------------
  // v1.8.5 ROLE-BOUNDARY PRESERVATION
  //
  // parseInterview() may already have correctly split:
  //
  //   Client - Role
  //
  // Example:
  //
  //   Veeva Systems
  //   Platform Engineer - Commercial Services Tools
  //
  // The historical repair pass must NOT search the full
  // source again and accidentally promote a polluted
  // longer Client Master entry such as:
  //
  //   Veeva Systems - Platform Engineer - ...
  //
  // If Role is already present and strongly role-like,
  // trust the parser's right-boundary split and only
  // canonicalize the BASE Client.
  //--------------------------------------------------

  const existingClient =
    PARSER_identityClean_(
      repaired.client || ""
    );

  const existingRole =
    PARSER_identityClean_(
      repaired.role || ""
    );

  if(
    existingClient &&
    existingRole &&
    PARSER_isLikelyRoleSuffixV18_(
      existingRole
    )
  ){

    const canonicalBase =
      PARSER_identityCanonicalClientV16_(
        existingClient
      );

    repaired.client =
      canonicalBase ||
      existingClient;

    repaired.role =
      existingRole;

    repaired.identityMatchedBy =
      canonicalBase
        ? "REPAIR_ROLE_BOUNDARY_MASTER_V185"
        : "REPAIR_ROLE_BOUNDARY_PRESERVED_V185";

  }else{

    //------------------------------------------------
    // Historical / ambiguous rows:
    // retain full-source reconciliation.
    //------------------------------------------------

    const info =
      PARSER_reconcileClientFromFullSourceV16_(
        repaired.originalText || "",
        {
          client:
            repaired.client || "",
          role:
            repaired.role || "",
          resolved:
            false,
          source:
            repaired.client || ""
        }
      );

    if(info && info.client){

      repaired.client =
        info.client;

      repaired.role =
        info.role || repaired.role || "";

      repaired.identityMatchedBy =
        info.matchedBy || "";

    }

  }

  //--------------------------------------------------
  // Explicitly expose the identity used by promotion
  // matching. Role is deliberately excluded.
  //--------------------------------------------------

  repaired.promotionIdentityKey =
    PARSER_identityKey_(
      repaired.candidate || ""
    ) +
    "||" +
    PARSER_identityKey_(
      repaired.client || ""
    );

  return repaired;

}


function PARSER_repairPromotionRecordsV16_(
  records
){

  if(!Array.isArray(records))
    return [];

  return records
    .filter(function(record){
      return !!record;
    })
    .map(function(record){
      return PARSER_repairPromotionRecordIdentityV16_(
        record
      );
    });

}



/******************************************************
 * READ-ONLY ROLE-BOUNDARY REPAIR REGRESSION v1.8.5
 *
 * NO WRITES.
 *
 * Confirms that the second Promotion repair pass does
 * not merge Role text back into Client.
 ******************************************************/
function testPromotionRoleBoundaryRepairV185ReadOnly(){

  const r1 =
    parseInterview(
      "Srestha Somala – Interview – Interview Veeva Systems – 7:30 PM IST – Duration: 45 Mins (1st Round) (Reschedule from sep 29)"
    );

  const r2 =
    parseInterview(
      "Srestha Somala – Interview – Technical interview - Veeva Systems - Platform Engineer - Commercial Services Tools – 9:30 PM IST – Duration: 45 Mins (2nd Round)"
    );

  const repairedR1 =
    PARSER_repairPromotionRecordIdentityV16_(
      r1
    );

  const repairedR2 =
    PARSER_repairPromotionRecordIdentityV16_(
      r2
    );

  const sameClient =
    !!repairedR1 &&
    !!repairedR2 &&
    PARSER_identityKey_(
      repairedR1.client
    ) ===
    PARSER_identityKey_(
      repairedR2.client
    );

  const result = {
    ok:
      sameClient &&
      Number(repairedR1.roundNo) === 1 &&
      Number(repairedR2.roundNo) === 2,

    mode:
      "READ_ONLY_PROMOTION_ROLE_BOUNDARY_REPAIR_V1_8_5",

    version:
      "PROMOTION-IDENTITY-1.8.5",

    sameClient:
      sameClient,

    r1:{
      client:
        repairedR1
          ? repairedR1.client
          : "",
      role:
        repairedR1
          ? repairedR1.role
          : "",
      identityMatchedBy:
        repairedR1
          ? repairedR1.identityMatchedBy
          : "",
      promotionIdentityKey:
        repairedR1
          ? repairedR1.promotionIdentityKey
          : ""
    },

    r2:{
      client:
        repairedR2
          ? repairedR2.client
          : "",
      role:
        repairedR2
          ? repairedR2.role
          : "",
      identityMatchedBy:
        repairedR2
          ? repairedR2.identityMatchedBy
          : "",
      promotionIdentityKey:
        repairedR2
          ? repairedR2.promotionIdentityKey
          : ""
    }
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


/******************************************************
 * EXACT CLIENT CANONICALIZATION
 ******************************************************/
function PARSER_identityCanonicalClientV16_(
  name
){

  const clean =
    PARSER_identityClean_(
      name
    );

  if(!clean)
    return "";

  const idx =
    PARSER_identityIndex_();

  const key =
    PARSER_identityKey_(
      clean
    );

  const hit =
    idx.clientAlias[key] ||
    idx.clientByName[key] ||
    idx.localClientByName[key] ||
    null;

  return hit
    ? hit.name
    : "";

}


/******************************************************
 * FIND CLIENT INSIDE COMPLETE INTERVIEW SOURCE
 *
 * Uses longest authoritative Client/alias phrase.
 * No "split on first hyphen" shortcut is used because
 * legitimate Client names may themselves contain hyphens.
 ******************************************************/
function PARSER_identityFindClientInFullSourceV16_(
  originalText
){

  let source =
    String(
      originalText || ""
    )
      .replace(/[–—−]/g," - ")
      .replace(/\s+/g," ")
      .trim();

  if(!source)
    return null;

  //--------------------------------------------------
  // Remove Candidate segment so a Client name cannot
  // accidentally match inside Candidate.
  //--------------------------------------------------

  const firstDash =
    source.search(
      /\s+-\s+/
    );

  if(firstDash >= 0){

    source =
      source
        .substring(
          firstDash + 3
        )
        .trim();

  }

  const searchable =
    " " +
    PARSER_identityLooseTextV16_(
      source
    ) +
    " ";

  if(!searchable.trim())
    return null;

  const idx =
    PARSER_identityIndex_();

  const candidates = [];

  function addCandidate(
    phrase,
    canonical,
    type
  ){

    const rawPhrase =
      PARSER_identityClean_(
        phrase
      );

    const rawCanonical =
      PARSER_identityClean_(
        canonical
      );

    if(
      !rawPhrase ||
      !rawCanonical
    ){
      return;
    }

    const loose =
      PARSER_identityLooseTextV16_(
        rawPhrase
      );

    if(!loose)
      return;

    candidates.push({
      phrase:
        rawPhrase,
      loose:
        loose,
      client:
        rawCanonical,
      type:
        type
    });

  }

  Object.keys(
    idx.clientByName || {}
  ).forEach(function(key){

    const rec =
      idx.clientByName[key];

    if(rec && rec.name){

      addCandidate(
        rec.name,
        rec.name,
        "CLIENT_MASTER"
      );

    }

  });

  Object.keys(
    idx.clientAlias || {}
  ).forEach(function(key){

    const rec =
      idx.clientAlias[key];

    if(rec && rec.name){

      addCandidate(
        rec.alias || rec.name,
        rec.name,
        "CLIENT_NAME_MAP"
      );

    }

  });

  //--------------------------------------------------
  // Longest phrase wins.
  //
  // Example:
  //   TD Bank Group
  // wins over:
  //   TD Bank
  //--------------------------------------------------

  candidates.sort(
    function(a,b){

      if(
        b.loose.length !==
        a.loose.length
      ){
        return (
          b.loose.length -
          a.loose.length
        );
      }

      if(
        b.phrase.length !==
        a.phrase.length
      ){
        return (
          b.phrase.length -
          a.phrase.length
        );
      }

      //------------------------------------------------
      // Explicit active Client Name Map aliases are
      // authoritative corrections and must beat a raw
      // Client Master entry with the same source phrase.
      //------------------------------------------------

      if(
        a.type !== b.type
      ){

        if(
          a.type ===
          "CLIENT_NAME_MAP"
        ){
          return -1;
        }

        if(
          b.type ===
          "CLIENT_NAME_MAP"
        ){
          return 1;
        }

      }

      return 0;

    }
  );

  for(
    let i=0;
    i<candidates.length;
    i++
  ){

    const item =
      candidates[i];

    const needle =
      " " +
      item.loose +
      " ";

    if(
      searchable.indexOf(
        needle
      ) !== -1
    ){

      return {
        client:
          item.client,
        source:
          item.phrase,
        matchType:
          item.type
      };

    }

  }

  return null;

}


/******************************************************
 * WORD-PRESERVING IDENTITY TEXT
 *
 * Unlike PARSER_identityKey_(), this keeps word
 * boundaries so full-source matching cannot accidentally
 * match a short client inside another word.
 ******************************************************/
function PARSER_identityLooseTextV16_(
  value
){

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(/&/g," and ")
    .replace(/[’']/g,"")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();

}


/******************************************************
 * READ-ONLY V1.6 FORMAT-TRANSITION TEST
 ******************************************************/
function testHistoricalClientRoleReconciliationV16ReadOnly(){

  PARSER_IDENTITY_CACHE_ = null;

  const samples = [

    "Aslesha yalamanchili – Interview – Sephora – 10:45 PM IST – Duration: 30 Mins (1st Round)",

    "Aslesha yalamanchili – Interview – Sephora - Data Analyst – 8:30 PM IST – Duration: 45 Mins (2nd Round)",

    "Sravani thurlapati – Interview – UC Davis Health - Business Systems Analyst 3 position – 9:30 PM IST – Duration: 55 Mins (2nd Round)",

    "Chandi priya katta – Interview – Technical Interview - Applied Medical - IT Business Analyst, Custom Applications – 9:30 PM IST – Duration: 60 Mins (2nd Round)",

    "Satya Pavan Vignesh Veera – Interview – Integrity Marketing Group - Business Analyst – 9:30 PM IST – Duration: 60 Mins (3rd Round)"

  ];

  const rows =
    samples.map(
      function(text){

        const parsed =
          parseInterview(
            text
          );

        return {
          source:
            text,
          candidate:
            parsed
              ? parsed.candidate
              : "",
          client:
            parsed
              ? parsed.client
              : "",
          role:
            parsed
              ? parsed.role
              : "",
          round:
            parsed
              ? parsed.round
              : "",
          roundNo:
            parsed
              ? parsed.roundNo
              : 0
        };

      }
    );

  const result = {
    ok:
      true,
    mode:
      "READ_ONLY_HISTORICAL_CLIENT_ROLE_RECONCILIATION_V1_6",
    version:
      "PROMOTION-IDENTITY-1.6",
    rows:
      rows
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;

}



/******************************************************
 * CENTRAL IDENTITY MASTER ROUTING
 *
 * Run setupPromotionIdentityControlWorkbook() ONCE in the
 * private incentive backend. This avoids accidentally reading
 * Candidate/Client masters from the private or operations workbook.
 ******************************************************/
function setupPromotionIdentityControlWorkbook(){

  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Promotion Identity Control Workbook",
    "Paste the Interview Portal Control spreadsheet URL or spreadsheet ID.",
    ui.ButtonSet.OK_CANCEL
  );

  if(response.getSelectedButton() !== ui.Button.OK){
    return {ok:false,cancelled:true};
  }

  const id = PARSER_extractSpreadsheetId_(response.getResponseText());
  if(!id){
    throw new Error("INVALID_IDENTITY_CONTROL_WORKBOOK_ID");
  }

  const ss = SpreadsheetApp.openById(id);
  if(!ss.getSheetByName("Candidate Master") || !ss.getSheetByName("Client Master")){
    throw new Error("IDENTITY_MASTER_SHEETS_NOT_FOUND|" + ss.getName());
  }

  PropertiesService.getScriptProperties().setProperty(
    PARSER_IDENTITY_CONTROL_PROPERTY_,
    id
  );

  // Keep compatibility with the earlier parser property name when present.
  PropertiesService.getScriptProperties().setProperty(
    "PORTAL_MASTER_SPREADSHEET_ID",
    id
  );

  PARSER_IDENTITY_CACHE_ = null;

  const result = {
    ok:true,
    mode:"PROMOTION_IDENTITY_CONTROL_CONFIGURED",
    workbook:ss.getName(),
    workbookId:ss.getId(),
    candidateMasterFound:true,
    clientMasterFound:true
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}

function testPromotionIdentityControlWorkbookReadOnly(){
  const ss = PARSER_identityMasterWorkbook_();
  const result = {
    ok:!!ss.getSheetByName("Candidate Master") && !!ss.getSheetByName("Client Master"),
    mode:"READ_ONLY_PROMOTION_IDENTITY_ROUTING",
    workbook:ss.getName(),
    workbookId:ss.getId(),
    configuredWorkbookId:String(
      PropertiesService.getScriptProperties().getProperty(
        PARSER_IDENTITY_CONTROL_PROPERTY_
      ) || ""
    ),
    candidateMasterFound:!!ss.getSheetByName("Candidate Master"),
    clientMasterFound:!!ss.getSheetByName("Client Master")
  };
  Logger.log(JSON.stringify(result,null,2));
  return result;
}

function PARSER_extractSpreadsheetId_(value){
  const text = String(value || "").trim();
  if(!text) return "";
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if(urlMatch) return urlMatch[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : "";
}

function PARSER_identityMasterWorkbook_(){
  const props = PropertiesService.getScriptProperties();
  const id = String(
    props.getProperty(PARSER_IDENTITY_CONTROL_PROPERTY_) ||
    props.getProperty("PORTAL_MASTER_SPREADSHEET_ID") ||
    ""
  ).trim();

  if(id){
    const configured = SpreadsheetApp.openById(id);
    if(configured.getSheetByName("Candidate Master") && configured.getSheetByName("Client Master")){
      return configured;
    }
    throw new Error("CONFIGURED_IDENTITY_MASTER_INVALID|" + id);
  }

  // Backward-compatible fallback only when the current operations workbook
  // genuinely contains the central master sheets.
  try{
    const operations = IR_operations_();
    if(operations && operations.getSheetByName("Candidate Master") && operations.getSheetByName("Client Master")){
      return operations;
    }
  }catch(error){}

  throw new Error(
    "PROMOTION_IDENTITY_CONTROL_WORKBOOK_NOT_CONFIGURED|" +
    "Run setupPromotionIdentityControlWorkbook() once."
  );
}

function PARSER_identityLoadMaster_(sheet,type,index){
  if(!sheet || sheet.getLastRow() < 2) return;

  const values =
    sheet.getDataRange()
      .getDisplayValues();

  const headers =
    values[0].map(
      PARSER_identityKey_
    );

  //--------------------------------------------------
  // IMPORTANT:
  // PARSER_identityKey_ removes spaces/punctuation.
  //
  // "Canonical Client Name" -> "canonicalclientname"
  // "Client ID"             -> "clientid"
  //--------------------------------------------------

  const nameHeader =
    type === "candidate"
      ? "canonicalname"
      : "canonicalclientname";

  const nameCol =
    headers.indexOf(
      nameHeader
    );

  if(nameCol < 0)
    return;

  const idHeader =
    type === "candidate"
      ? "candidateid"
      : "clientid";

  const idCol =
    headers.indexOf(
      idHeader
    );

  for(let i=1;i<values.length;i++){

    const name =
      PARSER_identityClean_(
        values[i][nameCol]
      );

    if(!name)
      continue;

    const rec = {
      name:name,
      id:
        idCol >= 0
          ? PARSER_identityClean_(
              values[i][idCol]
            )
          : ""
    };

    if(type === "candidate"){
      index.candidateByName[
        PARSER_identityKey_(name)
      ] = rec;
    }else{
      index.clientByName[
        PARSER_identityKey_(name)
      ] = rec;
    }

  }
}

function PARSER_identityLoadAlias_(sheet,type,index){
  if(!sheet || sheet.getLastRow() < 2) return;

  const values =
    sheet.getDataRange()
      .getDisplayValues();

  const headers =
    values[0].map(
      PARSER_identityKey_
    );

  const aliasCol =
    headers.indexOf(
      "alias"
    );

  const canonicalCol =
    headers.indexOf(
      type === "candidate"
        ? "canonicalname"
        : "canonicalclientname"
    );

  const activeCol =
    headers.indexOf(
      "active"
    );

  if(
    aliasCol < 0 ||
    canonicalCol < 0
  ){
    return;
  }

  for(let i=1;i<values.length;i++){

    if(activeCol >= 0){

      const flag =
        PARSER_identityKey_(
          values[i][activeCol]
        );

      if(
        flag &&
        ["true","yes","1","active"]
          .indexOf(flag) < 0
      ){
        continue;
      }

    }

    const alias =
      PARSER_identityClean_(
        values[i][aliasCol]
      );

    const canonical =
      PARSER_identityClean_(
        values[i][canonicalCol]
      );

    if(
      !alias ||
      !canonical
    ){
      continue;
    }

    const rec =
      type === "candidate"
        ? (
            index.candidateByName[
              PARSER_identityKey_(canonical)
            ] ||
            {name:canonical}
          )
        : (
            index.clientByName[
              PARSER_identityKey_(canonical)
            ] ||
            {name:canonical}
          );

    if(type === "candidate"){

      index.candidateAlias[
        PARSER_identityKey_(alias)
      ] = {
        name:rec.name,
        id:rec.id || "",
        alias:alias
      };

    }else{

      index.clientAlias[
        PARSER_identityKey_(alias)
      ] = {
        name:rec.name,
        id:rec.id || "",
        alias:alias
      };

    }

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


/******************************************************
 * READ-ONLY CENTRAL IDENTITY INDEX AUDIT v1.8.1
 ******************************************************/
function testPromotionIdentityIndexV181ReadOnly(){

  PARSER_IDENTITY_CACHE_ = null;

  const idx =
    PARSER_identityIndex_();

  const result = {
    ok:
      Object.keys(
        idx.candidateByName || {}
      ).length > 0 &&
      Object.keys(
        idx.clientByName || {}
      ).length > 0,
    mode:
      "READ_ONLY_PROMOTION_IDENTITY_INDEX_V1_8_1",
    version:
      "PROMOTION-IDENTITY-1.8.1",
    counts:{
      candidateMaster:
        Object.keys(
          idx.candidateByName || {}
        ).length,
      clientMaster:
        Object.keys(
          idx.clientByName || {}
        ).length,
      candidateAliases:
        Object.keys(
          idx.candidateAlias || {}
        ).length,
      clientAliases:
        Object.keys(
          idx.clientAlias || {}
        ).length
    },
    probes:{
      integrityAlias:
        idx.clientAlias[
          PARSER_identityKey_(
            "Integrity"
          )
        ] || null,
      rtiInternationalAlias:
        idx.clientAlias[
          PARSER_identityKey_(
            "RTI International"
          )
        ] || null
    }
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;

}



/******************************************************
 * READ-ONLY VERIFIED ALIAS PRECEDENCE v1.8.2
 *
 * Requires Integrity -> Integrity Marketing Group
 * to exist as an active Client Name Map row.
 ******************************************************/
function testPromotionClientAliasPrecedenceV182ReadOnly(){

  PARSER_IDENTITY_CACHE_ = null;

  const idx =
    PARSER_identityIndex_();

  const alias =
    idx.clientAlias[
      PARSER_identityKey_(
        "Integrity"
      )
    ] || null;

  const master =
    idx.clientByName[
      PARSER_identityKey_(
        "Integrity"
      )
    ] || null;

  const parsed =
    parseInterview(
      "Satya Pavan Vignesh veera--Phone interview--Integrity--12:00AM IST(20min)( 3rd round)"
    );

  const result = {
    ok:
      !!alias &&
      !!parsed &&
      PARSER_identityKey_(
        parsed.client
      ) ===
      PARSER_identityKey_(
        "Integrity Marketing Group"
      ),
    mode:
      "READ_ONLY_CLIENT_ALIAS_PRECEDENCE_V1_8_2",
    version:
      "PROMOTION-IDENTITY-1.8.2",
    alias:
      alias,
    master:
      master,
    parsed:
      parsed
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;

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
 * READ-ONLY ROLE-BOUNDARY REGRESSION v1.7
 ******************************************************/
function testPromotionRoleBoundaryV18ReadOnly(){

  PARSER_IDENTITY_CACHE_ = null;

  const samples = [
    {
      label:"Aspenpublishing composite master value",
      text:"Mani teja A – Interview – Aspenpublishing - Quality Assurance/Operations Analyst – 10:30 PM IST – Duration: 60 Mins (2nd Round)",
      expectedClient:"Aspenpublishing"
    },
    {
      label:"UC Davis Health composite master value",
      text:"Sravani thurlapati – Phone Interview – UC Davis Health - Business Systems Analyst 3 – 10:30 PM IST – Duration: 30 Mins (1st Round)",
      expectedClient:"UC Davis Health"
    },
    {
      label:"Clinical Architecture composite master value",
      text:"Yeswanthi Chowdavaram – Interview – Clinical Architecture - Clinical Content Analyst – 7:00 PM IST – Duration: 20 Mins (4th Round)",
      expectedClient:"Clinical Architecture"
    },
    {
      label:"Legitimate long client remains intact",
      text:"Srestha Somala – Interview – Panel interview - TD Bank Group - Data Designer II (US) - Business System Analyst – 10:30 PM IST – Duration: 60 Mins (3rd Round)",
      expectedClient:"TD Bank Group"
    },
    {
      label:"Hyphenated legitimate client remains intact",
      text:"Aslesha yalamanchili – Interview – H - E Parts International - Data and Integration Engineer – 6:30 PM IST – Duration: 30 Mins (1st Round)",
      expectedClient:"H - E Parts International"
    },
    {
      label:"Multi-part Role starts after authoritative Client",
      text:"Srestha Somala – Interview – Veeva Systems - Platform Engineer - Commercial Services Tools – 9:30 PM IST – Duration: 45 Mins (2nd Round)",
      expectedClient:"Veeva Systems"
    }
  ];

  const rows =
    samples.map(
      function(test){

        const parsed =
          parseInterview(
            test.text
          );

        const ok =
          !!parsed &&
          PARSER_identityKey_(
            parsed.client
          ) ===
          PARSER_identityKey_(
            test.expectedClient
          );

        return {
          label:test.label,
          ok:ok,
          expectedClient:test.expectedClient,
          actual:parsed
        };

      }
    );

  const passed =
    rows.filter(
      function(row){
        return row.ok;
      }
    ).length;

  const result = {
    ok:
      passed === rows.length,
    mode:
      "READ_ONLY_PROMOTION_ROLE_BOUNDARY_V1_8",
    version:
      "PROMOTION-IDENTITY-1.8",
    passed:
      passed,
    total:
      rows.length,
    rows:
      rows
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;

}



/******************************************************
 * BACKWARD-COMPATIBLE ROLE-BOUNDARY TEST WRAPPER
 ******************************************************/
function testPromotionRoleBoundaryV17ReadOnly(){
  return testPromotionRoleBoundaryV18ReadOnly();
}



/******************************************************
 * READ-ONLY LIVE ROUND FORMAT REGRESSION v1.8.3
 *
 * NO WRITES.
 ******************************************************/
function testPromotionRoundPunctuationV183ReadOnly(){

  const samples = [
    {
      label:
        "Navya Adyen semicolon between ordinal and Round",
      text:
        "Navya sree rama – Interview – Adyen - Software Engineer I (Front End) Lifecycle Experience – 7:30 PM IST – Duration: 90 Mins (2Nd; Round)",
      expectedClient:
        "Adyen",
      expectedRoundNo:
        2
    },
    {
      label:
        "Standard 3rd Round remains unchanged",
      text:
        "Mathew kodavalli – Interview – (UK) - Lotus – 6:30 PM IST – Duration: 60 Mins (3rd Round)",
      expectedClient:
        "Lotus",
      expectedRoundNo:
        3
    },
    {
      label:
        "Rescheduled Veeva R1 still parses normally",
      text:
        "Srestha Somala – Interview – Interview Veeva Systems – 7:30 PM IST – Duration: 45 Mins (1st Round) (Reschedule from sep 29)",
      expectedClient:
        "Veeva Systems",
      expectedRoundNo:
        1
    }
  ];

  const rows =
    samples.map(
      function(item){

        const parsed =
          parseInterview(
            item.text
          );

        const ok =
          !!parsed &&
          Number(parsed.roundNo) ===
            Number(item.expectedRoundNo) &&
          PARSER_identityKey_(
            parsed.client
          ) ===
          PARSER_identityKey_(
            item.expectedClient
          );

        return {
          label:
            item.label,
          ok:
            ok,
          expectedClient:
            item.expectedClient,
          expectedRoundNo:
            item.expectedRoundNo,
          parsed:
            parsed
        };

      }
    );

  const passed =
    rows.filter(
      function(row){
        return row.ok;
      }
    ).length;

  const result = {
    ok:
      passed === rows.length,
    mode:
      "READ_ONLY_PROMOTION_ROUND_PUNCTUATION_V1_8_3",
    version:
      "PROMOTION-IDENTITY-1.8.3",
    passed:
      passed,
    total:
      rows.length,
    rows:
      rows
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

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