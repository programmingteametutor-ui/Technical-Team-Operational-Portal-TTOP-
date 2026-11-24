
/******************************************************
 * SELECTION DISCUSSION / PARSER-GAP SUPPORT
 * Version 1.0
 *
 * SAFE ADD-ON FOR PRIVATE INCENTIVE BACKEND
 *
 * PURPOSE
 * -------
 * The legacy loadTeamData() calls parseInterview() before
 * it reads/uses Team Data status. If parseInterview() drops
 * a Selected row because the row has "Discussion Round"
 * (or another non-numbered round label), the ₹2,000
 * Selection incentive never reaches buildIncentiveTracker().
 *
 * This file does NOT replace Parser.gs / TeamLookup.gs.
 * It supplements ONLY Selected Team Data rows that the
 * current legacy parser drops.
 *
 * FIRST RUN:
 *   SEL_previewSelectedParserGaps()
 *
 * WRITE RUN (only after preview is reviewed):
 *   SEL_applySelectedParserGaps()
 *
 * RAW DATA: untouched
 * TEAM DATA: untouched
 * Existing Incentive Tracker: append-only through the
 * existing writeIncentiveTracker() duplicate-safe path.
 ******************************************************/



/******************************************************
 * PUBLIC: TARGETED REGRESSION TEST
 *
 * READ-ONLY.
 ******************************************************/
function SEL_testAchyuthDiscussionSelectedParser(){

  const source =
    "Achyuth gowtham - interview- Michigan Department of Community Health -12:00 AM IST - Discussion Round";

  const parsed =
    SEL_parseSelectedFallback_(
      source
    );

  const ok =
    parsed.candidate ===
      "Achyuth gowtham" &&
    parsed.client ===
      "Michigan Department of Community Health" &&
    /Discussion Round/i.test(
      parsed.roundLabel
    );

  const result = {
    ok: ok,
    expectedCandidate:
      "Achyuth gowtham",
    actualCandidate:
      parsed.candidate,
    expectedClient:
      "Michigan Department of Community Health",
    actualClient:
      parsed.client,
    sourceRound:
      parsed.roundLabel
  };

  Logger.log(
    "========== ACHYUTH DISCUSSION PARSER TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==================================================="
  );

  if(!ok){
    throw new Error(
      "ACHYUTH_DISCUSSION_PARSER_TEST_FAILED"
    );
  }

  return result;
}


/******************************************************
 * PUBLIC: READ-ONLY PREVIEW
 ******************************************************/
function SEL_previewSelectedParserGaps(){

  const scan =
    SEL_collectSelectedParserGaps_();

  Logger.log(
    "========== SELECTED PARSER-GAP PREVIEW =========="
  );

  Logger.log(
    JSON.stringify(
      {
        ok: true,
        selectedRowsSeen:
          scan.selectedRowsSeen,
        legacyParserAccepted:
          scan.legacyParserAccepted,
        parserGaps:
          scan.parserGaps.length,
        recoverable:
          scan.recoverable.length,
        unrecoverable:
          scan.unrecoverable.length,
        recoverableRows:
          scan.recoverable,
        unrecoverableRows:
          scan.unrecoverable
      },
      null,
      2
    )
  );

  Logger.log(
    "================================================="
  );

  return scan;
}


/******************************************************
 * PUBLIC: APPLY ONLY LEGACY-PARSER-GAP SELECTIONS
 *
 * IMPORTANT:
 * - Uses existing writeIncentiveTracker().
 * - Permanent private tracker duplicate checking remains
 *   the final protection against duplicate incentives.
 ******************************************************/
function SEL_applySelectedParserGaps(){

  const scan =
    SEL_collectSelectedParserGaps_();

  if(
    scan.recoverable.length === 0
  ){

    Logger.log(
      "No recoverable Selected parser gaps found. Nothing written."
    );

    return {
      ok: true,
      recoverable: 0,
      submitted: 0,
      added: 0
    };
  }

  const tracker =
    scan.recoverable.map(
      function(item){

        return {
          incentiveType:
            "Selection",

          candidate:
            item.candidate,

          client:
            item.client,

          fromRound:
            "-",

          toRound:
            "Selected",

          previousDate:
            "",

          promotionDate:
            item.selectionDateObj ||
            item.interviewDateObj,

          handler:
            item.handler,

          amount:
            INCENTIVES.SELECTED,

          status:
            "Pending"
        };

      }
    );

  const added =
    writeIncentiveTracker(
      tracker
    );

  const result = {
    ok: true,
    selectedRowsSeen:
      scan.selectedRowsSeen,
    parserGaps:
      scan.parserGaps.length,
    recoverable:
      scan.recoverable.length,
    submitted:
      tracker.length,
    added:
      Number(added) || 0,
    submittedRows:
      scan.recoverable.map(
        function(item){
          return {
            teamRow:
              item.teamRow,
            candidate:
              item.candidate,
            client:
              item.client,
            handler:
              item.handler,
            interviewDate:
              item.interviewDate,
            selectionDate:
              item.selectionDate,
            sourceRound:
              item.sourceRound,
            sourceText:
              item.sourceText
          };
        }
      )
  };

  Logger.log(
    "========== SELECTED PARSER-GAP APPLY =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==============================================="
  );

  return result;
}


/******************************************************
 * PRIVATE: COLLECT SELECTED ROWS DROPPED BY LEGACY PARSER
 ******************************************************/
function SEL_collectSelectedParserGaps_(){

  if(
    typeof IR_operations_ !==
      "function"
  ){
    throw new Error(
      "SEL_OPERATIONS_ROUTER_NOT_AVAILABLE"
    );
  }

  if(
    typeof parseInterview !==
      "function"
  ){
    throw new Error(
      "SEL_LEGACY_PARSE_INTERVIEW_NOT_AVAILABLE"
    );
  }

  const ss =
    IR_operations_();

  const sheet =
    ss.getSheetByName(
      CONFIG.TEAM_SHEET
    );

  if(!sheet){
    throw new Error(
      "SEL_TEAM_DATA_SHEET_NOT_FOUND"
    );
  }

  const values =
    sheet
      .getDataRange()
      .getValues();

  let currentDate = null;

  let selectedRowsSeen = 0;
  let legacyParserAccepted = 0;

  const parserGaps = [];
  const recoverable = [];
  const unrecoverable = [];

  for(
    let i = 0;
    i < values.length;
    i++
  ){

    const colA =
      values[i][0];

    const colB =
      values[i][1];

    const colC =
      values[i][2];

    const colD =
      values[i][3];

    const colE =
      values[i][4];

    //--------------------------------------------------
    // Team Data date header
    //--------------------------------------------------

    if(
      colA &&
      !colB
    ){

      try{

        currentDate =
          parseSheetDate(
            colA
          );

      }catch(error){

        currentDate =
          null;

      }

      continue;
    }

    if(!colB)
      continue;

    const status =
      String(
        colD || ""
      )
        .trim()
        .toLowerCase();

    if(
      status !==
        "selected"
    ){
      continue;
    }

    selectedRowsSeen++;

    //--------------------------------------------------
    // First check current legacy parser exactly as live
    // engine does.
    //--------------------------------------------------

    let legacyParsed = null;

    try{

      legacyParsed =
        parseInterview(
          colB
        );

    }catch(error){

      legacyParsed =
        null;

    }

    if(legacyParsed){

      legacyParserAccepted++;

      continue;
    }

    //--------------------------------------------------
    // This is the exact class of row that the current
    // engine silently loses before Selected can be used.
    //--------------------------------------------------

    const fallback =
      SEL_parseSelectedFallback_(
        colB
      );

    let selectionDateObj = null;

    if(colE){

      try{

        selectionDateObj =
          parseSheetDate(
            colE
          );

      }catch(error){

        selectionDateObj =
          null;

      }

    }

    const handler =
      String(
        colC || ""
      ).trim();

    const base = {
      teamRow:
        i + 1,

      candidate:
        fallback.candidate,

      client:
        fallback.client,

      handler:
        handler,

      sourceRound:
        fallback.roundLabel,

      interviewDate:
        SEL_dateLabel_(
          currentDate
        ),

      selectionDate:
        SEL_dateLabel_(
          selectionDateObj
        ),

      interviewDateObj:
        currentDate,

      selectionDateObj:
        selectionDateObj,

      sourceText:
        String(
          colB || ""
        ).trim(),

      reason:
        ""
    };

    parserGaps.push(
      base
    );

    const reasons = [];

    if(!fallback.candidate){
      reasons.push(
        "CANDIDATE_NOT_EXTRACTED"
      );
    }

    if(!fallback.client){
      reasons.push(
        "CLIENT_NOT_EXTRACTED"
      );
    }

    if(!handler){
      reasons.push(
        "HANDLER_BLANK"
      );
    }else if(
      !SEL_hasEligibleHandler_(
        handler
      )
    ){
      reasons.push(
        "HANDLER_NOT_ELIGIBLE"
      );
    }

    if(
      !(
        selectionDateObj ||
        currentDate
      )
    ){
      reasons.push(
        "EARNING_DATE_NOT_AVAILABLE"
      );
    }

    if(reasons.length){

      base.reason =
        reasons.join(
          " | "
        );

      unrecoverable.push(
        base
      );

      continue;
    }

    base.reason =
      "LEGACY_PARSER_DROPPED_SELECTED_ROW";

    recoverable.push(
      base
    );

  }

  return {
    ok: true,
    selectedRowsSeen:
      selectedRowsSeen,
    legacyParserAccepted:
      legacyParserAccepted,
    parserGaps:
      parserGaps,
    recoverable:
      recoverable,
    unrecoverable:
      unrecoverable
  };
}


/******************************************************
 * PRIVATE: CONSERVATIVE SELECTED-ROW FALLBACK PARSER
 *
 * Selection does NOT depend on a numeric round.
 *
 * It extracts only what the ₹2,000 Selection record needs:
 * Candidate + Client.
 *
 * Round wording is retained for diagnostics only.
 ******************************************************/
function SEL_parseSelectedFallback_(
  source
){

  const original =
    String(
      source || ""
    ).trim();

  if(!original){

    return {
      candidate: "",
      client: "",
      roundLabel: ""
    };

  }

  //--------------------------------------------------
  // Normalize only dash characters, NOT words.
  //
  // This keeps source meaning intact but makes formats
  // such as:
  //   interview- Client -12:00 AM
  // parse the same as:
  //   interview - Client - 12:00 AM
  //--------------------------------------------------

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
  // Candidate = everything before first structural dash.
  //--------------------------------------------------

  const firstDash =
    text.indexOf(
      "-"
    );

  let candidate = "";

  if(firstDash > -1){

    candidate =
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

  }

  //--------------------------------------------------
  // FIRST / PREFERRED PATH:
  //
  // Candidate - TYPE - CLIENT - TIME ...
  //
  // Works even when spaces around separators are missing:
  //   Achyuth gowtham - interview-
  //   Michigan Department of Community Health
  //   -12:00 AM IST - Discussion Round
  //--------------------------------------------------

  let client = "";

  if(firstDash > -1){

    const tail =
      text
        .substring(
          firstDash + 1
        )
        .trim();

    const typePattern =
      "(?:Interview|Technical\\s+Interview|Technical\\s+Coding\\s+Interview|Excel\\s+Interview|AI\\s+Interview|Panel\\s+Interview|Hiring\\s+Manager\\s+Interview|Manager\\s+Interview|Assessment\\s+Interview|Zoom\\s+Interview|Teams\\s+Interview|Microsoft\\s+Teams\\s+Interview|Google\\s+Meet\\s+Interview|Phone\\s+Interview|Phn\\s+Interview|Phone\\s+Call|Phn\\s+Call|Google\\s+Voice\\s+Call|Recruiter\\s+Call|Phone\\s+Screen|Prep\\s+Call)";

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

    //------------------------------------------------
    // SECOND PATH:
    // Candidate - CLIENT - TYPE - TIME ...
    //------------------------------------------------

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

  }

  //--------------------------------------------------
  // THIRD PATH:
  // Flexible segment fallback for unusual formatting.
  //
  // We intentionally split only on dashes that look
  // structural (surrounded by whitespace OR touching
  // a known type/time boundary). This avoids treating
  // ordinary internal hyphens in a client name as a
  // separator whenever possible.
  //--------------------------------------------------

  if(!client){

    let normalized =
      text
        .replace(
          /\s*-\s*(?=(?:Interview|Technical\s+Interview|Technical\s+Coding\s+Interview|Excel\s+Interview|AI\s+Interview|Panel\s+Interview|Hiring\s+Manager\s+Interview|Manager\s+Interview|Assessment\s+Interview|Zoom\s+Interview|Teams\s+Interview|Microsoft\s+Teams\s+Interview|Google\s+Meet\s+Interview|Phone\s+Interview|Phn\s+Interview|Phone\s+Call|Phn\s+Call|Google\s+Voice\s+Call|Recruiter\s+Call|Phone\s+Screen|Prep\s+Call)\b)/ig,
          " - "
        )
        .replace(
          /((?:Interview|Call|Screen))\s*-\s*/ig,
          "$1 - "
        )
        .replace(
          /\s*-\s*(?=\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b)/ig,
          " - "
        )
        .replace(
          /\s+-\s+/g,
          " - "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    const segments =
      normalized
        .split(
          /\s+-\s+/
        )
        .map(
          function(value){
            return String(
              value || ""
            ).trim();
          }
        )
        .filter(Boolean);

    if(!candidate && segments.length){

      candidate =
        segments[0]
          .replace(
            /\([^)]*\)/g,
            " "
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

    }

    let typeIndex = -1;

    for(
      let i = 1;
      i < segments.length;
      i++
    ){

      if(
        SEL_isTypeSegment_(
          segments[i]
        )
      ){

        typeIndex = i;
        break;

      }

    }

    const start =
      typeIndex >= 0
        ? typeIndex + 1
        : 1;

    for(
      let i = start;
      i < segments.length;
      i++
    ){

      const segment =
        String(
          segments[i] || ""
        ).trim();

      if(!segment)
        continue;

      if(
        SEL_isNonClientSegment_(
          segment
        )
      ){
        continue;
      }

      client =
        segment
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      break;

    }

    //------------------------------------------------
    // Rare client-before-type ordering.
    //------------------------------------------------

    if(
      !client &&
      typeIndex > 1
    ){

      for(
        let i = 1;
        i < typeIndex;
        i++
      ){

        const segment =
          String(
            segments[i] || ""
          ).trim();

        if(
          segment &&
          !SEL_isNonClientSegment_(
            segment
          )
        ){

          client =
            segment
              .replace(
                /\s+/g,
                " "
              )
              .trim();

          break;

        }

      }

    }

  }

  return {
    candidate:
      candidate,

    client:
      client,

    roundLabel:
      SEL_extractRoundLabel_(
        original
      )
  };
}


/******************************************************
 * PRIVATE: TYPE SEGMENT
 ******************************************************/
function SEL_isTypeSegment_(
  value
){

  const text =
    String(
      value || ""
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

  return /^(?:Interview|Technical Interview|Technical Coding Interview|Excel Interview|AI Interview|Panel Interview|Hiring Manager Interview|Manager Interview|Assessment Interview|Zoom Interview|Teams Interview|Microsoft Teams Interview|Google Meet Interview|Phone Interview|Phn Interview|Phone Call|Phn Call|Google Voice Call|Recruiter Call|Phone Screen|Prep Call)$/i.test(
    text
  );
}


/******************************************************
 * PRIVATE: SEGMENTS THAT MUST NEVER BECOME CLIENT
 ******************************************************/
function SEL_isNonClientSegment_(
  value
){

  const text =
    String(
      value || ""
    ).trim();

  if(!text)
    return true;

  if(
    SEL_isTypeSegment_(
      text
    )
  ){
    return true;
  }

  if(
    /\b(?:\d{1,2})(?::\d{2})?\s*(?:AM|PM)\b/i.test(
      text
    )
  ){
    return true;
  }

  if(
    /\bIST\b/i.test(
      text
    ) &&
    /\d/.test(
      text
    )
  ){
    return true;
  }

  if(
    /\bDuration\b/i.test(
      text
    )
  ){
    return true;
  }

  if(
    /\b\d+\s*(?:Mins?|Minutes?|Hours?|Hrs?)\b/i.test(
      text
    )
  ){
    return true;
  }

  if(
    /\b\d+\s*(?:st|nd|rd|th)\s*Round\b/i.test(
      text
    )
  ){
    return true;
  }

  if(
    /\bFinal\s+Round\b/i.test(
      text
    )
  ){
    return true;
  }

  if(
    /\b(?:Discussion|Discussion Round|Technical Discussion|Technical Discussion Round|Final Discussion|Final Technical Discussion|Technical Discussion w\/?\s*Hiring Manager|Hiring Manager Discussion|Technical Round|Screening Round)\b/i.test(
      text
    )
  ){
    return true;
  }

  if(
    /\b(?:Waiting|Invite|Confirmation|Rescheduled|Cancelled|Canceled|Need\s+(?:a\s+)?Developer)\b/i.test(
      text
    )
  ){
    return true;
  }

  return false;
}


/******************************************************
 * PRIVATE: ROUND / STAGE LABEL FOR LOGGING ONLY
 ******************************************************/
function SEL_extractRoundLabel_(
  source
){

  const text =
    String(
      source || ""
    );

  let match =
    /\b(\d+)\s*(st|nd|rd|th)\s*Round\b/i.exec(
      text
    );

  if(match){
    return match[0];
  }

  match =
    /\bFinal\s+Round\b/i.exec(
      text
    );

  if(match){
    return "Final Round";
  }

  match =
    /\b(?:Final Technical Discussion|Final Discussion|Technical Discussion w\/?\s*Hiring Manager|Technical Discussion|Discussion Round|Discussion|Technical Round|Screening Round)\b/i.exec(
      text
    );

  return match
    ? match[0]
    : "";
}


/******************************************************
 * PRIVATE: HANDLER ELIGIBILITY
 ******************************************************/
function SEL_hasEligibleHandler_(
  handler
){

  const key =
    String(
      handler || ""
    )
      .trim()
      .toLowerCase();

  if(!key)
    return false;

  if(
    /^(?:support|cancelled|canceled|rescheduled)$/.test(
      key
    )
  ){
    return false;
  }

  if(
    typeof IGNORE_HANDLERS !==
      "undefined" &&
    IGNORE_HANDLERS &&
    IGNORE_HANDLERS.indexOf(
      key
    ) > -1
  ){
    return false;
  }

  return true;
}


/******************************************************
 * PRIVATE: SAFE DATE LABEL
 ******************************************************/
function SEL_dateLabel_(
  date
){

  if(
    !(
      date instanceof Date
    ) ||
    isNaN(
      date.getTime()
    )
  ){
    return "";
  }

  if(
    typeof formatDate ===
      "function"
  ){
    try{
      return formatDate(
        date
      );
    }catch(error){}
  }

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "dd-MMM-yyyy"
  );
}


/******************************************************
 * PUBLIC: KRISHNAVENI / VERIZON SELECTION DIAGNOSTIC
 *
 * READ-ONLY.
 *
 * Checks every stage without writing:
 * 1. Team Data source row
 * 2. Legacy parseInterview()
 * 3. loadTeamData()
 * 4. buildIncentiveTracker([], teamRecords)
 * 5. Existing permanent Incentive Tracker
 ******************************************************/
function SEL_debugKrishnaveniSelection(){

  return SEL_debugSelectedCandidate_(
    "Krishnaveni Dharavath",
    "Verizon"
  );
}


/******************************************************
 * PUBLIC/PRIVATE: GENERIC SELECTED CANDIDATE DIAGNOSTIC
 *
 * READ-ONLY.
 ******************************************************/
function SEL_debugSelectedCandidate_(
  candidateNeedle,
  clientNeedle
){

  if(
    typeof IR_operations_ !==
      "function"
  ){
    throw new Error(
      "SEL_OPERATIONS_ROUTER_NOT_AVAILABLE"
    );
  }

  if(
    typeof parseInterview !==
      "function"
  ){
    throw new Error(
      "SEL_LEGACY_PARSE_INTERVIEW_NOT_AVAILABLE"
    );
  }

  if(
    typeof loadTeamData !==
      "function"
  ){
    throw new Error(
      "SEL_LOAD_TEAM_DATA_NOT_AVAILABLE"
    );
  }

  if(
    typeof buildIncentiveTracker !==
      "function"
  ){
    throw new Error(
      "SEL_BUILD_INCENTIVE_TRACKER_NOT_AVAILABLE"
    );
  }

  const candidateKey =
    SEL_debugKey_(
      candidateNeedle
    );

  const clientKey =
    SEL_debugKey_(
      clientNeedle
    );

  //--------------------------------------------------
  // A) DIRECT TEAM DATA INSPECTION
  //--------------------------------------------------

  const operations =
    IR_operations_();

  const teamSheet =
    operations.getSheetByName(
      CONFIG.TEAM_SHEET
    );

  if(!teamSheet){
    throw new Error(
      "SEL_TEAM_DATA_SHEET_NOT_FOUND"
    );
  }

  const values =
    teamSheet
      .getDataRange()
      .getValues();

  let currentDate = null;

  const directRows = [];

  for(
    let i = 0;
    i < values.length;
    i++
  ){

    const colA =
      values[i][0];

    const colB =
      values[i][1];

    const colC =
      values[i][2];

    const colD =
      values[i][3];

    const colE =
      values[i][4];

    if(
      colA &&
      !colB
    ){

      try{
        currentDate =
          parseSheetDate(
            colA
          );
      }catch(error){
        currentDate = null;
      }

      continue;
    }

    if(!colB)
      continue;

    const rawText =
      String(
        colB || ""
      ).trim();

    if(
      rawText
        .toLowerCase()
        .indexOf(
          String(
            candidateNeedle || ""
          ).toLowerCase()
        ) === -1
    ){
      continue;
    }

    let parsed = null;
    let parseError = "";

    try{

      parsed =
        parseInterview(
          rawText
        );

    }catch(error){

      parseError =
        error &&
        error.message
          ? error.message
          : String(error);

    }

    let selectionDateObj = null;

    if(colE){

      try{
        selectionDateObj =
          parseSheetDate(
            colE
          );
      }catch(error){
        selectionDateObj = null;
      }

    }

    directRows.push({
      teamRow:
        i + 1,

      date:
        SEL_dateLabel_(
          currentDate
        ),

      rawText:
        rawText,

      handler:
        String(
          colC || ""
        ).trim(),

      rawStatus:
        String(
          colD || ""
        ),

      normalizedStatus:
        String(
          colD || ""
        )
          .trim()
          .toLowerCase(),

      selectionDate:
        SEL_dateLabel_(
          selectionDateObj
        ),

      parserAccepted:
        !!parsed,

      parseError:
        parseError,

      parsedCandidate:
        parsed
          ? parsed.candidate
          : "",

      parsedClient:
        parsed
          ? parsed.client
          : "",

      parsedRound:
        parsed
          ? parsed.round
          : "",

      parsedRoundNo:
        parsed
          ? parsed.roundNo
          : "",

      parsedMatchesTarget:
        !!(
          parsed &&
          SEL_debugKey_(
            parsed.candidate
          ) === candidateKey &&
          (
            !clientKey ||
            SEL_debugKey_(
              parsed.client
            ) === clientKey
          )
        )
    });

  }

  //--------------------------------------------------
  // B) WHAT loadTeamData() ACTUALLY RETURNS
  //--------------------------------------------------

  const teamRecords =
    loadTeamData();

  const loadedMatches =
    teamRecords
      .filter(
        function(record){

          if(
            SEL_debugKey_(
              record &&
              record.candidate
            ) !== candidateKey
          ){
            return false;
          }

          if(
            clientKey &&
            SEL_debugKey_(
              record &&
              record.client
            ) !== clientKey
          ){
            return false;
          }

          return true;
        }
      )
      .map(
        function(record){

          return {
            candidate:
              record.candidate,
            client:
              record.client,
            round:
              record.round,
            roundNo:
              record.roundNo,
            handler:
              record.handler,
            status:
              record.status,
            interviewDate:
              SEL_dateLabel_(
                record.dateObj
              ),
            selectionDate:
              SEL_dateLabel_(
                record.selectionDateObj
              )
          };

        }
      );

  //--------------------------------------------------
  // C) WOULD CURRENT TRACKER BUILDER GENERATE SELECTION?
  //
  // Empty promotion array keeps this strictly focused on
  // selection generation and performs no writes.
  //--------------------------------------------------

  const selectionTracker =
    buildIncentiveTracker(
      [],
      teamRecords
    );

  const generatedSelections =
    selectionTracker
      .filter(
        function(record){

          return (
            String(
              record &&
              record.incentiveType || ""
            )
              .trim()
              .toLowerCase() ===
                "selection" &&
            SEL_debugKey_(
              record.candidate
            ) === candidateKey &&
            (
              !clientKey ||
              SEL_debugKey_(
                record.client
              ) === clientKey
            )
          );

        }
      )
      .map(
        function(record){

          return {
            candidate:
              record.candidate,
            client:
              record.client,
            fromRound:
              record.fromRound,
            toRound:
              record.toRound,
            earningDate:
              SEL_dateLabel_(
                record.promotionDate
              ),
            handler:
              record.handler,
            amount:
              record.amount,
            status:
              record.status
          };

        }
      );

  //--------------------------------------------------
  // D) PERMANENT PRIVATE INCENTIVE TRACKER
  //--------------------------------------------------

  const privateSS =
    SpreadsheetApp.getActive();

  const trackerSheet =
    privateSS.getSheetByName(
      "Incentive Tracker"
    );

  const existingCandidateRows = [];
  const existingExactSelections = [];

  if(trackerSheet){

    const trackerValues =
      trackerSheet
        .getDataRange()
        .getValues();

    for(
      let r = 1;
      r < trackerValues.length;
      r++
    ){

      const row =
        trackerValues[r];

      const type =
        String(
          row[0] || ""
        ).trim();

      const candidate =
        String(
          row[1] || ""
        ).trim();

      const client =
        String(
          row[2] || ""
        ).trim();

      if(
        SEL_debugKey_(
          candidate
        ) !== candidateKey
      ){
        continue;
      }

      const item = {
        trackerRow:
          r + 1,
        incentiveType:
          type,
        candidate:
          candidate,
        client:
          client,
        fromRound:
          row[3],
        toRound:
          row[4],
        previousDate:
          row[5],
        earningDate:
          row[6],
        handler:
          row[7],
        amount:
          row[8],
        status:
          row[9]
      };

      existingCandidateRows.push(
        item
      );

      if(
        type
          .toLowerCase() ===
            "selection" &&
        (
          !clientKey ||
          SEL_debugKey_(
            client
          ) === clientKey
        )
      ){
        existingExactSelections.push(
          item
        );
      }

    }

  }

  //--------------------------------------------------
  // E) DIAGNOSIS
  //--------------------------------------------------

  let diagnosis = "";

  const selectedDirectRows =
    directRows.filter(
      function(row){
        return (
          row.normalizedStatus ===
            "selected"
        );
      }
    );

  if(
    directRows.length === 0
  ){

    diagnosis =
      "TEAM_DATA_ROW_NOT_FOUND";

  }else if(
    selectedDirectRows.length === 0
  ){

    diagnosis =
      "TEAM_DATA_ROW_FOUND_BUT_STATUS_NOT_SELECTED";

  }else if(
    selectedDirectRows.every(
      function(row){
        return !row.parserAccepted;
      }
    )
  ){

    diagnosis =
      "LEGACY_PARSER_DROPPED_SELECTED_ROW";

  }else if(
    loadedMatches.length === 0
  ){

    diagnosis =
      "PARSED_DIRECTLY_BUT_NOT_PRESENT_IN_LOAD_TEAM_DATA";

  }else if(
    generatedSelections.length === 0
  ){

    diagnosis =
      "TEAM_RECORD_LOADED_BUT_SELECTION_NOT_GENERATED";

  }else if(
    existingExactSelections.length > 0
  ){

    diagnosis =
      "SELECTION_ALREADY_EXISTS_IN_PRIVATE_TRACKER";

  }else{

    diagnosis =
      "SELECTION_GENERATES_CORRECTLY_BUT_IS_NOT_IN_PRIVATE_TRACKER__RUN_INCENTIVE_SCAN_OR_TRACE_WRITE_PATH";

  }

  const result = {
    ok: true,
    targetCandidate:
      candidateNeedle,
    targetClient:
      clientNeedle,
    diagnosis:
      diagnosis,
    directTeamRows:
      directRows,
    loadedTeamRecords:
      loadedMatches,
    generatedSelections:
      generatedSelections,
    existingPrivateSelectionRows:
      existingExactSelections,
    allExistingPrivateRowsForCandidate:
      existingCandidateRows
  };

  Logger.log(
    "========== SELECTED CANDIDATE DIAGNOSTIC =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==================================================="
  );

  return result;
}


/******************************************************
 * PRIVATE: SIMPLE EXACT DIAGNOSTIC KEY
 ******************************************************/
function SEL_debugKey_(
  value
){

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      ""
    )
    .trim();
}


/******************************************************
 * PUBLIC: APPLY KRISHNAVENI / VERIZON SELECTION
 *
 * TARGETED WRITE.
 *
 * Uses the SAME current selection-generation logic:
 *   loadTeamData()
 *   buildIncentiveTracker([], teamRecords)
 *
 * Then submits only the exact generated Selection row
 * through the existing writeIncentiveTracker() path.
 *
 * It does NOT edit Raw Data or Team Data.
 ******************************************************/
function SEL_applyKrishnaveniSelection(){

  return SEL_applyGeneratedSelection_(
    "Krishnaveni Dharavath",
    "Verizon"
  );
}


/******************************************************
 * PRIVATE: APPLY ONE GENERATED SELECTION
 ******************************************************/
function SEL_applyGeneratedSelection_(
  candidateNeedle,
  clientNeedle
){

  const candidateKey =
    SEL_debugKey_(
      candidateNeedle
    );

  const clientKey =
    SEL_debugKey_(
      clientNeedle
    );

  const teamRecords =
    loadTeamData();

  const tracker =
    buildIncentiveTracker(
      [],
      teamRecords
    );

  const matches =
    tracker.filter(
      function(record){

        return (
          String(
            record &&
            record.incentiveType || ""
          )
            .trim()
            .toLowerCase() ===
              "selection" &&
          SEL_debugKey_(
            record.candidate
          ) === candidateKey &&
          SEL_debugKey_(
            record.client
          ) === clientKey
        );

      }
    );

  if(matches.length === 0){

    throw new Error(
      "SEL_TARGET_SELECTION_NOT_GENERATED|" +
      candidateNeedle +
      "|" +
      clientNeedle
    );

  }

  if(matches.length > 1){

    throw new Error(
      "SEL_MULTIPLE_TARGET_SELECTIONS_GENERATED|" +
      candidateNeedle +
      "|" +
      clientNeedle +
      "|count=" +
      matches.length
    );

  }

  //--------------------------------------------------
  // Existing permanent tracker check before write.
  //--------------------------------------------------

  const ss =
    SpreadsheetApp.getActive();

  const sheet =
    ss.getSheetByName(
      "Incentive Tracker"
    );

  if(sheet){

    const values =
      sheet
        .getDataRange()
        .getValues();

    for(
      let r = 1;
      r < values.length;
      r++
    ){

      const row =
        values[r];

      if(
        String(
          row[0] || ""
        )
          .trim()
          .toLowerCase() !==
            "selection"
      ){
        continue;
      }

      if(
        SEL_debugKey_(
          row[1]
        ) !== candidateKey
      ){
        continue;
      }

      if(
        SEL_debugKey_(
          row[2]
        ) !== clientKey
      ){
        continue;
      }

      const already = {
        ok: true,
        status:
          "ALREADY_EXISTS",
        added: 0,
        trackerRow:
          r + 1,
        candidate:
          row[1],
        client:
          row[2],
        earningDate:
          row[6],
        handler:
          row[7],
        amount:
          row[8],
        incentiveStatus:
          row[9]
      };

      Logger.log(
        "========== KRISHNAVENI SELECTION APPLY =========="
      );

      Logger.log(
        JSON.stringify(
          already,
          null,
          2
        )
      );

      Logger.log(
        "================================================"
      );

      return already;

    }

  }

  const target =
    matches[0];

  const added =
    writeIncentiveTracker([
      target
    ]);

  const result = {
    ok: true,
    status:
      Number(added) > 0
        ? "ADDED"
        : "NOT_ADDED_CHECK_DUPLICATE_OR_WRITE_PATH",
    submitted: 1,
    added:
      Number(added) || 0,
    candidate:
      target.candidate,
    client:
      target.client,
    earningDate:
      SEL_dateLabel_(
        target.promotionDate
      ),
    handler:
      target.handler,
    amount:
      target.amount,
    incentiveStatus:
      target.status
  };

  Logger.log(
    "========== KRISHNAVENI SELECTION APPLY =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "================================================"
  );

  return result;
}


/******************************************************
 * PUBLIC: READ-ONLY SELECTION FROM-ROUND UPGRADE PREVIEW
 *
 * Compares current Selected Team Data records with the
 * permanent private Incentive Tracker and reports which
 * Selection rows still show "-" instead of the actual
 * selected round/stage.
 *
 * NO WRITES.
 ******************************************************/
function SEL_previewSelectionRoundUpgrade(){

  if(typeof loadTeamData !== "function"){
    throw new Error(
      "SEL_LOAD_TEAM_DATA_NOT_AVAILABLE"
    );
  }

  if(typeof getPrivateTrackerSheet !== "function"){
    throw new Error(
      "SEL_PRIVATE_TRACKER_HELPER_NOT_AVAILABLE"
    );
  }

  const teamRecords =
    loadTeamData();

  const selected =
    teamRecords.filter(
      function(interview){
        return (
          String(
            interview &&
            interview.status || ""
          )
            .trim()
            .toLowerCase() ===
              "selected"
        );
      }
    );

  const trackerSheet =
    getPrivateTrackerSheet();

  const values =
    trackerSheet
      .getDataRange()
      .getValues();

  const existing =
    values.slice(1);

  const alreadyCorrect = [];
  const needsUpgrade = [];
  const notFound = [];
  const ambiguous = [];
  const noUsableStage = [];

  selected.forEach(
    function(interview){

      const proposedFrom =
        String(
          interview.round || ""
        ).trim();

      const earningDate =
        interview.selectionDateObj ||
        interview.dateObj ||
        null;

      const item = {
        candidate:
          interview.candidate,
        client:
          interview.client,
        proposedFrom:
          proposedFrom || "-",
        earningDate:
          earningDate
            ? formatDate(
                earningDate
              )
            : "",
        handler:
          interview.handler,
        amount:
          Number(
            INCENTIVES.SELECTED
          ) || 2000
      };

      if(
        !proposedFrom ||
        proposedFrom === "-"
      ){
        noUsableStage.push(
          item
        );
        return;
      }

      const matches = [];

      for(
        let i = 0;
        i < existing.length;
        i++
      ){

        const row =
          existing[i];

        if(
          String(
            row[0] || ""
          )
            .trim()
            .toLowerCase() !==
              "selection"
        ){
          continue;
        }

        if(
          SEL_debugKey_(
            row[1]
          ) !==
          SEL_debugKey_(
            interview.candidate
          )
        ){
          continue;
        }

        if(
          SEL_debugKey_(
            row[2]
          ) !==
          SEL_debugKey_(
            interview.client
          )
        ){
          continue;
        }

        if(
          String(
            row[4] || ""
          )
            .trim()
            .toLowerCase() !==
              "selected"
        ){
          continue;
        }

        let rowDate = "";

        if(row[6]){
          try{
            rowDate =
              formatDate(
                parseSheetDate(
                  row[6]
                )
              );
          }catch(error){
            rowDate = "";
          }
        }

        if(
          rowDate !==
          item.earningDate
        ){
          continue;
        }

        if(
          SEL_debugKey_(
            row[7]
          ) !==
          SEL_debugKey_(
            interview.handler
          )
        ){
          continue;
        }

        if(
          Number(
            row[8] || 0
          ) !==
          Number(
            item.amount
          )
        ){
          continue;
        }

        matches.push({
          trackerRow:
            i + 2,
          fromRound:
            String(
              row[3] || ""
            ).trim(),
          status:
            String(
              row[9] || ""
            ).trim()
        });

      }

      if(matches.length === 0){

        notFound.push(
          item
        );
        return;

      }

      if(matches.length > 1){

        ambiguous.push(
          Object.assign(
            {},
            item,
            {
              matches:
                matches
            }
          )
        );
        return;

      }

      const match =
        matches[0];

      const detail =
        Object.assign(
          {},
          item,
          {
            trackerRow:
              match.trackerRow,
            existingFrom:
              match.fromRound,
            trackerStatus:
              match.status
          }
        );

      if(
        SEL_debugKey_(
          match.fromRound
        ) ===
        SEL_debugKey_(
          proposedFrom
        )
      ){

        alreadyCorrect.push(
          detail
        );

      }else{

        needsUpgrade.push(
          detail
        );

      }

    }
  );

  const result = {
    ok: true,
    mode:
      "READ_ONLY",
    selectedTeamRecords:
      selected.length,
    alreadyCorrect:
      alreadyCorrect.length,
    needsUpgrade:
      needsUpgrade.length,
    notFound:
      notFound.length,
    ambiguous:
      ambiguous.length,
    noUsableStage:
      noUsableStage.length,
    needsUpgradeRows:
      needsUpgrade,
    ambiguousRows:
      ambiguous,
    notFoundRows:
      notFound,
    noUsableStageRows:
      noUsableStage
  };

  Logger.log(
    "========== SELECTION FROM-ROUND UPGRADE PREVIEW =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "========================================================="
  );

  return result;

}
function SEL_testSelectionDuplicateIdentity(){

  const selectionOld = [
    "Selection",
    "Krishnaveni Dharavath",
    "Verizon",
    "-",
    "Selected",
    "",
    "14-Aug-2026",
    "Avinash",
    2000,
    "Pending"
  ];

  const selectionNew = [
    "Selection",
    "Krishnaveni Dharavath",
    "Verizon",
    "3rd Round",
    "Selected",
    "",
    "14-Aug-2026",
    "Avinash",
    2000,
    "Pending"
  ];

  const promotionA = [
    "Promotion",
    "Test Candidate",
    "Test Client",
    "2nd Round",
    "3rd Round",
    "14-Aug-2026",
    "14-Aug-2026",
    "Avinash",
    500,
    "Pending"
  ];

  const promotionB = [
    "Promotion",
    "Test Candidate",
    "Test Client",
    "3rd Round",
    "4th Round",
    "14-Aug-2026",
    "14-Aug-2026",
    "Avinash",
    500,
    "Pending"
  ];

  const oldSelectionKey =
    PB_buildTrackerKey(
      selectionOld
    );

  const newSelectionKey =
    PB_buildTrackerKey(
      selectionNew
    );

  const promotionKeyA =
    PB_buildTrackerKey(
      promotionA
    );

  const promotionKeyB =
    PB_buildTrackerKey(
      promotionB
    );

  const result = {
    selectionKeysMatch:
      oldSelectionKey ===
      newSelectionKey,

    promotionKeysRemainDifferent:
      promotionKeyA !==
      promotionKeyB,

    ok:
      oldSelectionKey ===
        newSelectionKey &&
      promotionKeyA !==
        promotionKeyB
  };

  Logger.log(
    "========== SELECTION IDENTITY TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "============================================"
  );

  return result;
}
