/******************************************************
 * PRIVATE BACKEND
 * Production Merge - Version 1.4 - CANONICAL DUPLICATE HARDENING
 *
 * Purpose:
 * - Keep permanent incentive storage independent
 *   from the dashboard / portal.
 * - Preserve the existing function used by the
 *   working Incentive Tracker:
 *
 *     appendIncentivesToPrivateBackend(records)
 *
 * IMPORTANT:
 * - No OAuth
 * - No portal access logic
 * - No doGet()
 * - No HTML/dashboard logic
 ******************************************************/


/******************************************************
 * CONFIGURATION
 ******************************************************/

const PRIVATE_BACKEND_CONFIG = {

  SPREADSHEET_ID:
    "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk",

  TRACKER_SHEET:
    "Incentive Tracker"

};


/******************************************************
 * GET PRIVATE SPREADSHEET
 ******************************************************/

function getPrivateIncentiveSpreadsheet(){

  const id =
    String(
      PRIVATE_BACKEND_CONFIG.SPREADSHEET_ID || ""
    ).trim();

  if(!id){

    throw new Error(
      "Private backend Spreadsheet ID is not configured."
    );

  }

  return SpreadsheetApp.openById(id);

}


/******************************************************
 * GET PRIVATE TRACKER SHEET
 ******************************************************/

function getPrivateTrackerSheet(){

  const ss =
    getPrivateIncentiveSpreadsheet();

  const sheet =
    ss.getSheetByName(
      PRIVATE_BACKEND_CONFIG.TRACKER_SHEET
    );

  if(!sheet){

    throw new Error(
      "Private backend sheet '" +
      PRIVATE_BACKEND_CONFIG.TRACKER_SHEET +
      "' was not found."
    );

  }

  return sheet;

}


/******************************************************
 * APPEND INCENTIVES TO PRIVATE BACKEND
 *
 * Expected tracker row structure:
 *
 * 0  Incentive Type
 * 1  Candidate
 * 2  Client
 * 3  From
 * 4  To
 * 5  Previous Date
 * 6  Promotion Date
 * 7  Handler
 * 8  Amount
 * 9  Status
 *
 * Returns:
 * Number of newly-added records.
 ******************************************************/

function appendIncentivesToPrivateBackend(records){

  if(
    !Array.isArray(records) ||
    records.length === 0
  ){
    Logger.log(
      "Private Backend: No records supplied."
    );
    return 0;
  }

  const tracker =
    getPrivateTrackerSheet();

  const columnCount =
    tracker.getLastColumn();

  if(columnCount !== 10){
    throw new Error(
      "Private Incentive Tracker must contain exactly 10 columns. " +
      "Current column count: " +
      columnCount
    );
  }

  const validRecords =
    records.filter(
      function(row){

        return (
          Array.isArray(row) &&
          row.length === columnCount &&
          PB_rowHasData(row)
        );

      }
    );

  if(!validRecords.length){
    Logger.log(
      "Private Backend: No valid records supplied."
    );
    return 0;
  }

  const lastRow =
    tracker.getLastRow();

  const existingRecords =
    lastRow > 1
      ? tracker
          .getRange(
            2,
            1,
            lastRow - 1,
            columnCount
          )
          .getValues()
      : [];

  //--------------------------------------------------
  // DUPLICATE PROTECTION LEVELS
  //
  // 1. Exact normalized tracker key.
  //
  // 2. Permanent handled Team-call promotion key:
  //    Canonical Candidate
  //    Canonical Client
  //    From Round
  //    Previous Date
  //
  // 3. Promotion movement key:
  //    Canonical Candidate
  //    Canonical Client
  //    From Round
  //    To Round
  //    Promotion Date
  //
  // 4. Existing Selection logical key.
  //
  // The promotion guards intentionally ignore Status
  // and harmless Candidate/Client formatting.
  //--------------------------------------------------

  const exactIndex = {};
  const promotionLogicalIndex = {};
  const promotionMovementIndex = {};
  const selectionLogicalIndex = {};

  existingRecords.forEach(
    function(row){

      const exactKey =
        PB_buildTrackerKey(row);

      if(exactKey){
        exactIndex[exactKey] = true;
      }

      const promotionKey =
        PB_buildLogicalPromotionKey_(row);

      if(promotionKey){
        promotionLogicalIndex[promotionKey] = true;
      }

      const movementKey =
        PB_buildPromotionMovementKeyV14_(row);

      if(movementKey){
        promotionMovementIndex[movementKey] = true;
      }

      if(
        typeof PB_buildLogicalSelectionKey_ === "function"
      ){

        const selectionKey =
          PB_buildLogicalSelectionKey_(row);

        if(selectionKey){
          selectionLogicalIndex[selectionKey] = true;
        }

      }

    }
  );

  const newRecords = [];

  let blockedExact = 0;
  let blockedPromotionCall = 0;
  let blockedPromotionMovement = 0;
  let blockedSelection = 0;

  validRecords.forEach(
    function(row){

      const exactKey =
        PB_buildTrackerKey(row);

      if(!exactKey){
        return;
      }

      if(exactIndex[exactKey]){
        blockedExact++;
        return;
      }

      const promotionKey =
        PB_buildLogicalPromotionKey_(row);

      if(
        promotionKey &&
        promotionLogicalIndex[promotionKey]
      ){

        blockedPromotionCall++;

        Logger.log(
          "Private Backend: Existing handled promotion blocked -> " +
          promotionKey
        );

        return;
      }

      const movementKey =
        PB_buildPromotionMovementKeyV14_(row);

      if(
        movementKey &&
        promotionMovementIndex[movementKey]
      ){

        blockedPromotionMovement++;

        Logger.log(
          "Private Backend: Existing promotion movement blocked -> " +
          movementKey
        );

        return;
      }

      let selectionKey = "";

      if(
        typeof PB_buildLogicalSelectionKey_ === "function"
      ){

        selectionKey =
          PB_buildLogicalSelectionKey_(row);

        if(
          selectionKey &&
          selectionLogicalIndex[selectionKey]
        ){

          blockedSelection++;

          Logger.log(
            "Private Backend: Logical selection duplicate blocked -> " +
            selectionKey
          );

          return;
        }

      }

      //------------------------------------------------
      // Accept once and immediately update every index
      // so duplicate rows within the SAME scan are also
      // blocked.
      //------------------------------------------------

      newRecords.push(row);

      exactIndex[exactKey] = true;

      if(promotionKey){
        promotionLogicalIndex[promotionKey] = true;
      }

      if(movementKey){
        promotionMovementIndex[movementKey] = true;
      }

      if(selectionKey){
        selectionLogicalIndex[selectionKey] = true;
      }

    }
  );

  Logger.log(
    "Private Backend duplicate guard: " +
    "exact=" + blockedExact +
    ", handledPromotion=" + blockedPromotionCall +
    ", movement=" + blockedPromotionMovement +
    ", selection=" + blockedSelection
  );

  if(!newRecords.length){

    Logger.log(
      "Private Backend: No new records."
    );

    return 0;
  }

  const startRow =
    Math.max(
      tracker.getLastRow() + 1,
      2
    );

  tracker
    .getRange(
      startRow,
      1,
      newRecords.length,
      columnCount
    )
    .setValues(
      newRecords
    );

  Logger.log(
    "Private Backend: Added " +
    newRecords.length +
    " new tracker records."
  );

  return newRecords.length;
}


/******************************************************
 * BUILD PRIVATE TRACKER KEY
 *
 * IMPORTANT:
 * Status is intentionally NOT part of the key.
 *
 * Therefore:
 *
 * Pending -> Approved -> Paid
 *
 * is still treated as the SAME incentive record.
 ******************************************************/

function PB_buildTrackerKey(row){

  if(
    !Array.isArray(row) ||
    row.length < 10
  ){
    return "";
  }

  const type =
    PB_normalizeText(row[0]);

  const candidate =
    PB_canonicalCandidate_(row[1]);

  const client =
    PB_canonicalClient_(row[2]);

  const fromRound =
    PB_normalizeRoundText_(row[3]);

  const toRound =
    PB_normalizeRoundText_(row[4]);

  const previousDate =
    PB_normalizeDate(row[5]);

  const promotionDate =
    PB_normalizeDate(row[6]);

  const handler =
    PB_normalizeText(row[7]);

  const amount =
    PB_normalizeAmount(row[8]);

  if(
    !type &&
    !candidate &&
    !client &&
    !fromRound &&
    !toRound &&
    !handler &&
    !amount
  ){
    return "";
  }

  // Status row[9] intentionally excluded.
  return [
    type,
    candidate,
    client,
    fromRound,
    toRound,
    previousDate,
    promotionDate,
    handler,
    amount
  ].join("||");

}

function PB_buildLogicalPromotionKey_(row){

  if(!Array.isArray(row) || row.length < 10)
    return "";

  const type = PB_normalizeText(row[0]);
  if(type !== "promotion")
    return "";

  const candidate = PB_canonicalCandidate_(row[1]);
  const client = PB_canonicalClient_(row[2]);
  const fromRound = PB_normalizeRoundText_(row[3]);
  const previousDate = PB_normalizeDate(row[5]);

  if(!candidate || !client || !fromRound || !previousDate)
    return "";

  // TEAM-FIRST BUSINESS IDENTITY:
  // one incentive maximum per handled Team call.
  // To Round and Promotion Date are evidence only and must NOT
  // create another incentive for the same handled call.
  return [
    type,
    candidate,
    client,
    fromRound,
    previousDate
  ].join("||");
}



/******************************************************
 * PROMOTION MOVEMENT KEY v1.4
 *
 * Secondary duplicate guard.
 *
 * This protects older rows where Previous Date may be
 * imperfect but the same Candidate + Client + movement
 * appears again on the same Promotion Date.
 ******************************************************/
function PB_buildPromotionMovementKeyV14_(row){

  if(
    !Array.isArray(row) ||
    row.length < 10
  ){
    return "";
  }

  const type =
    PB_normalizeText(
      row[0]
    );

  if(type !== "promotion"){
    return "";
  }

  const candidate =
    PB_canonicalCandidate_(
      row[1]
    );

  const client =
    PB_canonicalClient_(
      row[2]
    );

  const fromRound =
    PB_normalizeRoundText_(
      row[3]
    );

  const toRound =
    PB_normalizeRoundText_(
      row[4]
    );

  const promotionDate =
    PB_normalizeDate(
      row[6]
    );

  if(
    !candidate ||
    !client ||
    !fromRound ||
    !toRound ||
    !promotionDate
  ){
    return "";
  }

  return [
    "promotion",
    candidate,
    client,
    fromRound,
    toRound,
    promotionDate
  ].join("||");
}


function PB_canonicalCandidate_(value){

  const raw =
    String(
      value === null ||
      value === undefined
        ? ""
        : value
    ).trim();

  if(!raw){
    return "";
  }

  //--------------------------------------------------
  // Use the same central identity index as Parser.
  // Approved Candidate Name Map aliases take precedence
  // over raw Candidate Master variants for dedupe.
  //--------------------------------------------------

  try{

    if(
      typeof PARSER_identityIndex_ === "function" &&
      typeof PARSER_identityKey_ === "function"
    ){

      const idx =
        PARSER_identityIndex_();

      const key =
        PARSER_identityKey_(
          raw
        );

      const hit =
        (
          idx &&
          idx.candidateAlias &&
          idx.candidateAlias[key]
        ) ||
        (
          idx &&
          idx.candidateByName &&
          idx.candidateByName[key]
        ) ||
        null;

      if(
        hit &&
        hit.name
      ){
        return PB_normalizeIdentity(
          hit.name
        );
      }

    }

    //------------------------------------------------
    // Compatibility fallback if an older Parser helper
    // is available.
    //------------------------------------------------

    if(
      typeof PARSER_identityCanonicalCandidate_ === "function"
    ){

      const canonical =
        PARSER_identityCanonicalCandidate_(
          raw
        );

      if(canonical){
        return PB_normalizeIdentity(
          canonical
        );
      }

    }

  }catch(error){

    Logger.log(
      "PB canonical Candidate fallback: " +
      error.message
    );

  }

  return PB_normalizeIdentity(
    raw
  );
}


function PB_canonicalClient_(value){

  let client =
    String(
      value === null ||
      value === undefined
        ? ""
        : value
    )
      .replace(/[–—]/g,"-")
      .replace(/\s+/g," ")
      .trim();

  if(!client){
    return "";
  }

  //--------------------------------------------------
  // PRIMARY:
  // Use Parser v1.8.2 right-boundary Client/Role logic.
  //
  // Example:
  //
  // Advocate Aurora Health -
  // Revenue Cycle Optimization Analyst, Senior
  //
  // becomes:
  //
  // Advocate Aurora Health
  //
  // while legitimate hyphenated Clients remain intact.
  //--------------------------------------------------

  try{

    if(
      typeof PARSER_identityResolveClientRoleFromParts_ ===
      "function"
    ){

      const parts =
        client
          .split(/\s*-\s*/)
          .map(
            function(part){
              return String(part || "").trim();
            }
          )
          .filter(Boolean);

      const resolved =
        PARSER_identityResolveClientRoleFromParts_(
          parts
        );

      if(
        resolved &&
        resolved.client
      ){

        client =
          resolved.client;

      }

    }else if(
      typeof PARSER_identityResolveClientRoleFromText_ ===
      "function"
    ){

      const resolved =
        PARSER_identityResolveClientRoleFromText_(
          client
        );

      if(
        resolved &&
        resolved.client
      ){
        client =
          resolved.client;
      }

    }

    //------------------------------------------------
    // Alias-first exact canonicalization from the same
    // v1.8.2 Client identity index.
    //------------------------------------------------

    if(
      typeof PARSER_identityIndex_ === "function" &&
      typeof PARSER_identityKey_ === "function"
    ){

      const idx =
        PARSER_identityIndex_();

      const key =
        PARSER_identityKey_(
          client
        );

      const hit =
        (
          idx &&
          idx.clientAlias &&
          idx.clientAlias[key]
        ) ||
        (
          idx &&
          idx.clientByName &&
          idx.clientByName[key]
        ) ||
        null;

      if(
        hit &&
        hit.name
      ){
        client =
          hit.name;
      }

    }else if(
      typeof PARSER_identityCanonicalClientV16_ ===
      "function"
    ){

      client =
        PARSER_identityCanonicalClientV16_(
          client
        ) ||
        client;

    }

  }catch(error){

    Logger.log(
      "PB canonical Client parser fallback: " +
      error.message
    );

  }

  //--------------------------------------------------
  // Compatibility cleanup for Interview descriptors.
  //--------------------------------------------------

  const leading =
    /^(?:(?:Loop|Technical|Behavioral|Final|Assessment\s+Through|Assessment|Panel|Manager|Hiring\s+Manager)\s+Interview|Interview)\s*(?:-|:)?\s*/i;

  const trailing =
    /\s*(?:-|:)?\s*(?:(?:Loop|Technical|Behavioral|Final|Assessment|Panel|Manager|Hiring\s+Manager)\s+Interview|Interview)\s*$/i;

  let previous = null;

  while(previous !== client){

    previous = client;

    client =
      client
        .replace(leading,"")
        .replace(trailing,"")
        .replace(/^[-:\s]+|[-:\s]+$/g,"")
        .replace(/\s+/g," ")
        .trim();

  }

  return PB_normalizeIdentity(
    client
  );
}


function PB_normalizeRoundText_(value){

  const text =
    String(value || "")
      .trim();

  if(!text)
    return "";

  if(/^final$/i.test(text))
    return "final";

  const patterns = [
    /\b(\d{1,2})\s*(?:st|nd|rd|th)\s*(?:Round|Rd)\b/i,
    /\bRound\s*[-:#]?\s*(\d{1,2})\b/i,
    /\bR\s*[-:#]?\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*Round\b/i
  ];

  for(let i=0;i<patterns.length;i++){
    const match = text.match(patterns[i]);
    if(match)
      return String(parseInt(match[1],10));
  }

  return PB_normalizeText(text);

}




function auditPromotionDuplicatesV2(){

  const tracker =
    getPrivateTrackerSheet();

  const lastRow =
    tracker.getLastRow();

  if(lastRow <= 1){
    const empty = {
      ok: true,
      records: 0,
      duplicateGroups: 0,
      groups: []
    };
    Logger.log(JSON.stringify(empty,null,2));
    return empty;
  }

  const values =
    tracker
      .getRange(
        2,
        1,
        lastRow - 1,
        10
      )
      .getValues();

  const groups = {};

  values.forEach(function(row,index){

    const key =
      PB_buildLogicalPromotionKey_(row);

    if(!key)
      return;

    if(!groups[key])
      groups[key] = [];

    groups[key].push({
      sheetRow: index + 2,
      incentiveType: row[0],
      candidate: row[1],
      client: row[2],
      fromRound: row[3],
      toRound: row[4],
      previousDate: row[5],
      promotionDate: row[6],
      handler: row[7],
      amount: row[8],
      status: row[9]
    });

  });

  const duplicates =
    Object.keys(groups)
      .filter(function(key){
        return groups[key].length > 1;
      })
      .map(function(key){
        return {
          logicalKey: key,
          rows: groups[key]
        };
      });

  const result = {
    ok: true,
    records: values.length,
    duplicateGroups: duplicates.length,
    groups: duplicates
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
 * NORMALIZE GENERAL TEXT
 ******************************************************/

function PB_normalizeText(value){

  return String(
    value === null ||
    value === undefined
      ? ""
      : value
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g," ");

}


/******************************************************
 * NORMALIZE CANDIDATE / CLIENT IDENTITY
 *
 * This handles harmless differences such as:
 * - capitalization
 * - punctuation
 * - hyphens
 * - repeated spaces
 *
 * It intentionally does NOT perform fuzzy matching.
 * Fuzzy approval belongs in RecoveryEngine /
 * RecoveryApproval, not the permanent storage layer.
 ******************************************************/

function PB_normalizeIdentity(value){

  return String(
    value === null ||
    value === undefined
      ? ""
      : value
  )
    .trim()
    .toLowerCase()
    .replace(/[()]/g," ")
    .replace(/[-–—]/g," ")
    .replace(/[.,']/g," ")
    .replace(/\s+/g," ")
    .trim();

}


/******************************************************
 * NORMALIZE DATE
 ******************************************************/

function PB_normalizeDate(value){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){

    return "";

  }


  //--------------------------------------------------
  // Date object
  //--------------------------------------------------

  if(
    Object.prototype.toString.call(value) ===
    "[object Date]"
  ){

    if(isNaN(value.getTime()))
      return "";


    return Utilities.formatDate(

      value,

      Session.getScriptTimeZone(),

      "yyyy-MM-dd"

    );

  }


  //--------------------------------------------------
  // Text date
  //--------------------------------------------------

  const text =
    String(value)
      .trim();


  if(!text)
    return "";


  const parsed =
    new Date(text);


  if(!isNaN(parsed.getTime())){

    return Utilities.formatDate(

      parsed,

      Session.getScriptTimeZone(),

      "yyyy-MM-dd"

    );

  }


  //--------------------------------------------------
  // Keep unparseable text deterministically
  //--------------------------------------------------

  return PB_normalizeText(text);

}


/******************************************************
 * NORMALIZE AMOUNT
 ******************************************************/

function PB_normalizeAmount(value){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){

    return "";

  }


  const cleaned =
    String(value)
      .replace(/[₹,\s]/g,"")
      .trim();


  const number =
    Number(cleaned);


  if(!isNaN(number)){

    return String(number);

  }


  return PB_normalizeText(cleaned);

}


/******************************************************
 * ROW HAS DATA
 ******************************************************/

function PB_rowHasData(row){

  return row.some(function(value){

    return !(
      value === "" ||
      value === null ||
      value === undefined
    );

  });

}


/******************************************************
 * TEST PRIVATE BACKEND CONNECTION
 *
 * Safe read-only test.
 ******************************************************/

function testPrivateBackendConnection(){

  const ss =
    getPrivateIncentiveSpreadsheet();

  const tracker =
    getPrivateTrackerSheet();


  Logger.log(
    "========== PRIVATE BACKEND TEST =========="
  );

  Logger.log(
    "Spreadsheet : " +
    ss.getName()
  );

  Logger.log(
    "Spreadsheet ID : " +
    ss.getId()
  );

  Logger.log(
    "Tracker Sheet : " +
    tracker.getName()
  );

  Logger.log(
    "Tracker Rows : " +
    tracker.getLastRow()
  );

  Logger.log(
    "Tracker Columns : " +
    tracker.getLastColumn()
  );

  Logger.log(
    "=========================================="
  );

}


/******************************************************
 * OPTIONAL DUPLICATE AUDIT
 *
 * Read-only.
 * Reports how many duplicate permanent tracker
 * records already exist using the new key.
 ******************************************************/

function auditPrivateBackendDuplicates(){

  const tracker =
    getPrivateTrackerSheet();

  const lastRow =
    tracker.getLastRow();

  const lastColumn =
    tracker.getLastColumn();


  if(lastRow <= 1){

    Logger.log(
      "Private Backend Audit: No records."
    );

    return;

  }


  const values =
    tracker
      .getRange(
        2,
        1,
        lastRow - 1,
        lastColumn
      )
      .getValues();


  const seen = {};

  let duplicates = 0;


  values.forEach(function(row){

    const key =
      PB_buildTrackerKey(row);

    if(!key)
      return;


    if(seen[key]){

      duplicates++;

    }else{

      seen[key] = true;

    }

  });


  Logger.log(
    "========== PRIVATE BACKEND AUDIT =========="
  );

  Logger.log(
    "Records : " +
    values.length
  );

  Logger.log(
    "Unique Keys : " +
    Object.keys(seen).length
  );

  Logger.log(
    "Duplicate Records : " +
    duplicates
  );

  Logger.log(
    "==========================================="
  );

}
function PB_shouldUpgradeSelectionFromRound_(
  existingRow,
  incomingRow
){

  if(
    !Array.isArray(existingRow) ||
    !Array.isArray(incomingRow) ||
    existingRow.length < 10 ||
    incomingRow.length < 10
  ){
    return false;
  }

  const existingType =
    PB_normalizeText(existingRow[0]);

  const incomingType =
    PB_normalizeText(incomingRow[0]);

  if(
    existingType !== "selection" ||
    incomingType !== "selection"
  ){
    return false;
  }

  //--------------------------------------------------
  // Must already be the SAME Selection incentive
  //--------------------------------------------------

  if(
    PB_buildTrackerKey(existingRow) !==
    PB_buildTrackerKey(incomingRow)
  ){
    return false;
  }

  const existingFrom =
    PB_normalizeText(existingRow[3]);

  const incomingFrom =
    PB_normalizeText(incomingRow[3]);

  //--------------------------------------------------
  // Only enrich a missing/placeholder From value.
  //
  // Never overwrite an already-established stage.
  //--------------------------------------------------

  const existingIsMissing =
    !existingFrom ||
    existingFrom === "-";

  const incomingIsUseful =
    !!incomingFrom &&
    incomingFrom !== "-";

  return (
    existingIsMissing &&
    incomingIsUseful
  );
}


function PB_testSelectionFromRoundUpgradeDecision(){

  const oldSelection = [
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

  const enrichedSelection = [
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

  const alreadyHasStage = [
    "Selection",
    "Krishnaveni Dharavath",
    "Verizon",
    "1st Round",
    "Selected",
    "",
    "14-Aug-2026",
    "Avinash",
    2000,
    "Pending"
  ];

  const discussionSelection = [
    "Selection",
    "Krishnaveni Dharavath",
    "Verizon",
    "Discussion Round",
    "Selected",
    "",
    "14-Aug-2026",
    "Avinash",
    2000,
    "Pending"
  ];

  const promotion = [
    "Promotion",
    "Krishnaveni Dharavath",
    "Verizon",
    "2nd Round",
    "3rd Round",
    "14-Aug-2026",
    "14-Aug-2026",
    "Avinash",
    500,
    "Pending"
  ];

  const result = {

    placeholderTo3rd:
      PB_shouldUpgradeSelectionFromRound_(
        oldSelection,
        enrichedSelection
      ),

    placeholderToDiscussion:
      PB_shouldUpgradeSelectionFromRound_(
        oldSelection,
        discussionSelection
      ),

    existingStageNotOverwritten:
      !PB_shouldUpgradeSelectionFromRound_(
        alreadyHasStage,
        enrichedSelection
      ),

    promotionNotAffected:
      !PB_shouldUpgradeSelectionFromRound_(
        promotion,
        promotion
      )
  };

  result.ok =
    result.placeholderTo3rd === true &&
    result.placeholderToDiscussion === true &&
    result.existingStageNotOverwritten === true &&
    result.promotionNotAffected === true;

  Logger.log(
    "========== SELECTION FROM-ROUND DECISION TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "======================================================="
  );

  return result;
}


/******************************************************
 * READ-ONLY CANONICAL DUPLICATE GUARD TEST v1.4
 *
 * NO WRITES.
 *
 * Confirms:
 * 1. Client+Role and base Client collapse.
 * 2. Different From Rounds remain separate.
 ******************************************************/
function testPrivateTrackerCanonicalDuplicateGuardV14ReadOnly(){

  const ruchithaWithRole = [
    "Promotion",
    "Ruchitha Mandalapu",
    "Advocate Aurora Health - Revenue Cycle Optimization Analyst, Senior",
    "1st Round",
    "2nd Round",
    new Date(2026,9,20),
    new Date(2026,9,28),
    "Avinash",
    100,
    "Pending"
  ];

  const ruchithaBaseClient = [
    "Promotion",
    "RUCHITHA MANDALAPU",
    "Advocate Aurora Health",
    "1st Round",
    "2nd Round",
    new Date(2026,9,20),
    new Date(2026,9,28),
    "Avinash",
    100,
    "Pending"
  ];

  const harshitha2To3 = [
    "Promotion",
    "Harshitha devi sunkara",
    "Judi Health",
    "2nd Round",
    "3rd Round",
    new Date(2026,9,2),
    new Date(2026,9,2),
    "Avinash",
    500,
    "Pending"
  ];

  const harshitha3To4 = [
    "Promotion",
    "HARSHITHA DEVI SUNKARA",
    "Judi health",
    "3rd Round",
    "4th Round",
    new Date(2026,9,2),
    new Date(2026,9,2),
    "Avinash",
    500,
    "Pending"
  ];

  const ruchithaA =
    PB_buildLogicalPromotionKey_(
      ruchithaWithRole
    );

  const ruchithaB =
    PB_buildLogicalPromotionKey_(
      ruchithaBaseClient
    );

  const harshithaA =
    PB_buildLogicalPromotionKey_(
      harshitha2To3
    );

  const harshithaB =
    PB_buildLogicalPromotionKey_(
      harshitha3To4
    );

  const result = {
    ok:
      !!ruchithaA &&
      ruchithaA === ruchithaB &&
      !!harshithaA &&
      !!harshithaB &&
      harshithaA !== harshithaB,

    mode:
      "READ_ONLY_PRIVATE_TRACKER_CANONICAL_DUPLICATE_GUARD_V1_4",

    version:
      "PRIVATE-BACKEND-1.4",

    checks:{
      ruchithaClientRoleDuplicateBlocked:
        ruchithaA === ruchithaB,

      harshithaDifferentMovementsPreserved:
        harshithaA !== harshithaB
    },

    canonicalClients:{
      ruchithaWithRole:
        PB_canonicalClient_(
          ruchithaWithRole[2]
        ),

      ruchithaBaseClient:
        PB_canonicalClient_(
          ruchithaBaseClient[2]
        ),

      harshitha:
        PB_canonicalClient_(
          harshitha2To3[2]
        )
    },

    keys:{
      ruchithaWithRole:
        ruchithaA,

      ruchithaBaseClient:
        ruchithaB,

      harshitha2To3:
        harshithaA,

      harshitha3To4:
        harshithaB
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
 * READ-ONLY EXISTING TRACKER DUPLICATE AUDIT v1.4
 *
 * NO WRITES / NO DELETES.
 ******************************************************/
function auditPrivateTrackerDuplicatesV14ReadOnly(){

  const tracker =
    getPrivateTrackerSheet();

  const lastRow =
    tracker.getLastRow();

  if(lastRow <= 1){

    const empty = {
      ok:true,
      mode:
        "READ_ONLY_PRIVATE_TRACKER_DUPLICATE_AUDIT_V1_4",
      version:
        "PRIVATE-BACKEND-1.4",
      records:0,
      handledCallDuplicateGroups:0,
      movementDuplicateGroups:0,
      handledCallGroups:[],
      movementGroups:[]
    };

    Logger.log(
      JSON.stringify(
        empty,
        null,
        2
      )
    );

    return empty;
  }

  const values =
    tracker
      .getRange(
        2,
        1,
        lastRow - 1,
        10
      )
      .getValues();

  const handledGroups = {};
  const movementGroups = {};

  values.forEach(
    function(row,index){

      const handledKey =
        PB_buildLogicalPromotionKey_(
          row
        );

      const movementKey =
        PB_buildPromotionMovementKeyV14_(
          row
        );

      const summary = {
        sheetRow:
          index + 2,

        incentiveType:
          row[0],

        candidate:
          row[1],

        client:
          row[2],

        fromRound:
          row[3],

        toRound:
          row[4],

        previousDate:
          PB_normalizeDate(
            row[5]
          ),

        promotionDate:
          PB_normalizeDate(
            row[6]
          ),

        handler:
          row[7],

        amount:
          row[8],

        status:
          row[9]
      };

      if(handledKey){

        if(!handledGroups[handledKey]){
          handledGroups[handledKey] = [];
        }

        handledGroups[handledKey]
          .push(summary);
      }

      if(movementKey){

        if(!movementGroups[movementKey]){
          movementGroups[movementKey] = [];
        }

        movementGroups[movementKey]
          .push(summary);
      }

    }
  );

  const handledDuplicates =
    Object.keys(
      handledGroups
    )
      .filter(
        function(key){
          return handledGroups[key].length > 1;
        }
      )
      .map(
        function(key){
          return {
            key:key,
            rows:
              handledGroups[key]
          };
        }
      );

  const movementDuplicates =
    Object.keys(
      movementGroups
    )
      .filter(
        function(key){
          return movementGroups[key].length > 1;
        }
      )
      .map(
        function(key){
          return {
            key:key,
            rows:
              movementGroups[key]
          };
        }
      );

  const result = {
    ok:true,

    mode:
      "READ_ONLY_PRIVATE_TRACKER_DUPLICATE_AUDIT_V1_4",

    version:
      "PRIVATE-BACKEND-1.4",

    records:
      values.length,

    handledCallDuplicateGroups:
      handledDuplicates.length,

    movementDuplicateGroups:
      movementDuplicates.length,

    handledCallGroups:
      handledDuplicates.slice(0,100),

    movementGroups:
      movementDuplicates.slice(0,100)
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

