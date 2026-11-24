/******************************************************
 * PORTALIDENTITYMAPPING.GS
 * Central Candidate / Client identity resolution
 * Interview Operations Portal
 * Version 1.0.6
 *
 * CENTRAL SHEETS (Interview Portal Control spreadsheet):
 * - Candidate Master
 * - Client Master
 * - Candidate Name Map
 * - Client Name Map
 * - Identity Mapping Audit
 *
 * SAFETY RULES
 * - Exact canonical/approved-alias matches may resolve automatically.
 * - Fuzzy matches are suggestions ONLY; never auto-written.
 * - Role/Position is informational only and NEVER participates in
 *   candidate/client identity, promotion, selection or duplicate keys.
 * - Country/tag text in parentheses after candidate name is excluded
 *   from candidate identity.
 ******************************************************/

const PORTAL_IDENTITY_MAPPING = Object.freeze({
  VERSION: "PORTAL-IDENTITY-MAPPING-1.0.7",
  MASTER_CACHE_TTL_SECONDS: 600,
  RAW_BLOCK_CACHE_TTL_SECONDS: 180,
  CONTROL_WORKBOOK_PROPERTY: "PIM_CONTROL_WORKBOOK_ID",
  CANDIDATE_MASTER: "Candidate Master",
  CLIENT_MASTER: "Client Master",
  CANDIDATE_MAP: "Candidate Name Map",
  CLIENT_MAP: "Client Name Map",
  AUDIT: "Identity Mapping Audit",
  MAX_SUGGESTIONS: 6,
  MIN_SUGGESTION_SCORE: 52
});

let PIM_MASTER_CACHE_ = null;


/******************************************************
 * PERFORMANCE CACHE v1.0.5
 *
 * Apps Script starts a new execution for every
 * google.script.run call, so a normal global variable does
 * not survive from "Map Candidate" to the next click.
 *
 * Script Cache stores only a compact snapshot of the
 * central identity masters/aliases. Sheet data remains the
 * source of truth. All portal writes refresh the snapshot.
 ******************************************************/
function PIM_scriptCache_(){
  return CacheService.getScriptCache();
}


function PIM_masterSnapshotCacheBase_(){
  return "PIM_MASTER_SNAPSHOT_V106";
}


function PIM_rawBlockCacheKey_(sheet,dateKey){
  return [
    "PIM_RAW_BLOCK_V106",
    sheet && sheet.getParent ? sheet.getParent().getId() : "",
    sheet && sheet.getSheetId ? sheet.getSheetId() : "",
    String(dateKey || "")
  ].join("|");
}


function PIM_cachePutLargeJson_(baseKey,value,ttlSeconds){
  try{
    const cache = PIM_scriptCache_();
    const json = JSON.stringify(value);
    const chunkSize = 80000;
    const count = Math.max(1,Math.ceil(json.length / chunkSize));
    const payload = {};
    payload[baseKey + "|meta"] = JSON.stringify({count:count});
    for(let i=0;i<count;i++){
      payload[baseKey + "|" + i] = json.substring(i * chunkSize,(i + 1) * chunkSize);
    }
    cache.putAll(payload,Number(ttlSeconds || 300));
  }catch(error){
    Logger.log("Identity cache write skipped: " + String(error && error.message || error));
  }
}


function PIM_cacheGetLargeJson_(baseKey){
  try{
    const cache = PIM_scriptCache_();
    const metaText = cache.get(baseKey + "|meta");
    if(!metaText){ return null; }
    const meta = JSON.parse(metaText);
    const count = Number(meta && meta.count || 0);
    if(count < 1 || count > 20){ return null; }
    const keys = [];
    for(let i=0;i<count;i++){
      keys.push(baseKey + "|" + i);
    }
    const chunks = cache.getAll(keys);
    let json = "";
    for(let i=0;i<count;i++){
      const part = chunks[baseKey + "|" + i];
      if(part == null){ return null; }
      json += part;
    }
    return JSON.parse(json);
  }catch(error){
    return null;
  }
}


function PIM_clearIdentityCaches_(){
  PIM_MASTER_CACHE_ = null;
  try{
    const cache = PIM_scriptCache_();
    const base = PIM_masterSnapshotCacheBase_();
    const metaText = cache.get(base + "|meta");
    let count = 10;
    if(metaText){
      try{ count = Math.max(count,Number(JSON.parse(metaText).count || 0)); }catch(error){}
    }
    const keys = [base + "|meta"];
    for(let i=0;i<count;i++){
      keys.push(base + "|" + i);
    }
    cache.removeAll(keys);
  }catch(error){}
}


function PIM_indexToSnapshot_(index){
  function compact(records){
    return (records || []).map(function(record){
      return [
        Number(record.rowNumber || 0),
        String(record.id || ""),
        String(record.name || ""),
        String(record.ref || "")
      ];
    });
  }

  function aliases(map){
    return Object.keys(map || {}).map(function(aliasKey){
      const record = map[aliasKey];
      return [
        aliasKey,
        String(record && (record.id || record.ref) || "")
      ];
    });
  }

  return {
    candidates:compact(index.candidateRecords),
    clients:compact(index.clientRecords),
    candidateAliases:aliases(index.candidateAlias),
    clientAliases:aliases(index.clientAlias)
  };
}


function PIM_snapshotToIndex_(snapshot){
  if(!snapshot || !Array.isArray(snapshot.candidates) || !Array.isArray(snapshot.clients)){
    return null;
  }

  const index = {
    candidateRecords:[],clientRecords:[],
    candidateByName:{},candidateById:{},candidateAlias:{},
    clientByName:{},clientById:{},clientAlias:{}
  };

  function inflate(rows,type){
    const records = [];
    (rows || []).forEach(function(row){
      const record = {
        type:type,
        rowNumber:Number(row[0] || 0),
        id:String(row[1] || ""),
        name:String(row[2] || ""),
        ref:String(row[3] || row[1] || ("ROW:" + Number(row[0] || 0)))
      };
      if(record.name){ records.push(record); }
    });
    return records;
  }

  index.candidateRecords = inflate(snapshot.candidates,"candidate");
  index.clientRecords = inflate(snapshot.clients,"client");

  index.candidateRecords.forEach(function(record){
    index.candidateByName[PIM_key_(record.name)] = record;
    if(record.id){ index.candidateById[PIM_key_(record.id)] = record; }
  });
  index.clientRecords.forEach(function(record){
    index.clientByName[PIM_key_(record.name)] = record;
    if(record.id){ index.clientById[PIM_key_(record.id)] = record; }
  });

  (snapshot.candidateAliases || []).forEach(function(row){
    const record = index.candidateById[PIM_key_(row[1])] || null;
    if(row[0] && record){ index.candidateAlias[String(row[0])] = record; }
  });
  (snapshot.clientAliases || []).forEach(function(row){
    const record = index.clientById[PIM_key_(row[1])] || null;
    if(row[0] && record){ index.clientAlias[String(row[0])] = record; }
  });

  return index;
}


function PIM_storePersistentIndex_(index){
  if(!index){ return; }
  PIM_MASTER_CACHE_ = index;
  PIM_cachePutLargeJson_(
    PIM_masterSnapshotCacheBase_(),
    PIM_indexToSnapshot_(index),
    PORTAL_IDENTITY_MAPPING.MASTER_CACHE_TTL_SECONDS
  );
}


function PIM_refreshIdentityCacheReadOnly(){
  PIM_clearIdentityCaches_();
  const started = new Date().getTime();
  const index = PIM_masterIndex_();
  const result = {
    ok:true,
    mode:"READ_ONLY_IDENTITY_CACHE_REFRESH",
    version:PORTAL_IDENTITY_MAPPING.VERSION,
    candidateCount:index.candidateRecords.length,
    clientCount:index.clientRecords.length,
    elapsedMs:new Date().getTime() - started
  };
  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/******************************************************
 * INTERVIEW PORTAL CONTROL WORKBOOK ROUTING
 *
 * IMPORTANT:
 * portalBackend_() intentionally points to the existing
 * Incentive Backend - Private and must NOT be changed.
 *
 * Candidate Master / Client Master and their alias/audit
 * sheets live in the spreadsheet that contains this bound
 * Interview Portal Control Apps Script project.
 *
 * Manual setup pins that workbook ID into Script Properties
 * so web-app executions do not depend on an active-sheet UI.
 ******************************************************/
function PIM_controlWorkbook_(options){
  const opts = options || {};
  const props = PropertiesService.getScriptProperties();
  const propertyName = PORTAL_IDENTITY_MAPPING.CONTROL_WORKBOOK_PROPERTY;
  const storedId = String(props.getProperty(propertyName) || "").trim();

  if(storedId){
    try{
      return SpreadsheetApp.openById(storedId);
    }catch(error){
      if(!opts.allowActiveFallback){
        throw new Error(
          "IDENTITY_CONTROL_WORKBOOK_UNAVAILABLE|" + storedId
        );
      }
    }
  }

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if(active){
    return active;
  }

  throw new Error(
    "IDENTITY_CONTROL_WORKBOOK_NOT_CONFIGURED|" +
    "Run setupPortalIdentityControlWorkbook() manually from the bound Interview Portal Control Apps Script project."
  );
}


/******************************************************
 * ONE-TIME CONTROL WORKBOOK PIN
 *
 * Run manually from Interview Portal Control Apps Script.
 * This stores only the bound spreadsheet ID in Script
 * Properties. It does not modify Candidate/Client data.
 ******************************************************/
function setupPortalIdentityControlWorkbook(){
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if(!active){
    throw new Error(
      "INTERVIEW_PORTAL_CONTROL_SPREADSHEET_NOT_ACTIVE|" +
      "Open the Interview Portal Control spreadsheet -> Extensions -> Apps Script and run this function there."
    );
  }

  const candidateSheet = active.getSheetByName(
    PORTAL_IDENTITY_MAPPING.CANDIDATE_MASTER
  );
  const clientSheet = active.getSheetByName(
    PORTAL_IDENTITY_MAPPING.CLIENT_MASTER
  );

  if(!candidateSheet || !clientSheet){
    throw new Error(
      "IDENTITY_MASTER_SHEETS_NOT_FOUND_IN_CONTROL_WORKBOOK|" +
      active.getName()
    );
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      PORTAL_IDENTITY_MAPPING.CONTROL_WORKBOOK_PROPERTY,
      active.getId()
    );

  PIM_clearIdentityCaches_();

  const result = {
    ok: true,
    mode: "IDENTITY_CONTROL_WORKBOOK_CONFIGURED",
    version: PORTAL_IDENTITY_MAPPING.VERSION,
    workbook: active.getName(),
    workbookId: active.getId(),
    candidateMasterFound: true,
    clientMasterFound: true
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/******************************************************
 * READ-ONLY ROUTING CHECK
 ******************************************************/
function PIM_testControlWorkbookRoutingReadOnly(){
  const ss = PIM_controlWorkbook_({allowActiveFallback:true});
  const candidateSheet = ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CANDIDATE_MASTER);
  const clientSheet = ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CLIENT_MASTER);

  const result = {
    ok: !!candidateSheet && !!clientSheet,
    mode: "READ_ONLY_IDENTITY_CONTROL_ROUTING",
    version: PORTAL_IDENTITY_MAPPING.VERSION,
    workbook: ss.getName(),
    workbookId: ss.getId(),
    configuredWorkbookId: String(
      PropertiesService.getScriptProperties().getProperty(
        PORTAL_IDENTITY_MAPPING.CONTROL_WORKBOOK_PROPERTY
      ) || ""
    ),
    candidateMasterFound: !!candidateSheet,
    clientMasterFound: !!clientSheet
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/******************************************************
 * MANUAL ONE-TIME SETUP
 *
 * Run from Apps Script after installing this file.
 * - Keeps existing Candidate Master names.
 * - Fills missing Candidate IDs without changing names.
 * - Initializes the empty Client Master headers.
 * - Creates empty alias/audit support sheets when absent.
 ******************************************************/
function setupPortalIdentityMasters(){
  // Pin the actual Interview Portal Control spreadsheet first so
  // subsequent web-app calls use a stable workbook ID.
  setupPortalIdentityControlWorkbook();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try{
    const ss = PIM_controlWorkbook_({allowActiveFallback:true});
    const candidateSheet = ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CANDIDATE_MASTER);
    if(!candidateSheet){
      throw new Error("CANDIDATE_MASTER_NOT_FOUND");
    }

    let clientSheet = ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CLIENT_MASTER);
    if(!clientSheet){
      clientSheet = ss.insertSheet(PORTAL_IDENTITY_MAPPING.CLIENT_MASTER);
    }

    PIM_ensureMasterHeaders_(candidateSheet,"candidate");
    PIM_ensureMasterHeaders_(clientSheet,"client");

    const candidateResult = PIM_fillMissingMasterIds_(candidateSheet,"candidate");
    const clientResult = PIM_fillMissingMasterIds_(clientSheet,"client");

    PIM_ensureAliasSupportSheet_(ss,"candidate");
    PIM_ensureAliasSupportSheet_(ss,"client");
    PIM_ensureAuditSheet_(ss);

    PIM_clearIdentityCaches_();

    const result = {
      ok:true,
      version:PORTAL_IDENTITY_MAPPING.VERSION,
      workbook:ss.getName(),
      candidateIdsAdded:candidateResult.idsAdded,
      candidateCount:candidateResult.recordCount,
      clientIdsAdded:clientResult.idsAdded,
      clientCount:clientResult.recordCount,
      sheets:{
        candidateMaster:PORTAL_IDENTITY_MAPPING.CANDIDATE_MASTER,
        clientMaster:PORTAL_IDENTITY_MAPPING.CLIENT_MASTER,
        candidateMap:PORTAL_IDENTITY_MAPPING.CANDIDATE_MAP,
        clientMap:PORTAL_IDENTITY_MAPPING.CLIENT_MAP,
        audit:PORTAL_IDENTITY_MAPPING.AUDIT
      }
    };

    Logger.log(JSON.stringify(result,null,2));
    return result;
  } finally {
    lock.releaseLock();
  }
}


function PIM_fillMissingMasterIds_(sheet,type){
  const values = sheet.getDataRange().getDisplayValues();
  if(!values.length){ return {recordCount:0,idsAdded:0}; }

  const headers = values[0].map(PIM_key_);
  const idHeader = type === "candidate" ? "candidate id" : "client id";
  const nameHeader = type === "candidate" ? "canonical name" : "canonical client name";
  const idCol = headers.indexOf(idHeader);
  const nameCol = headers.indexOf(nameHeader);
  if(idCol < 0 || nameCol < 0){
    throw new Error("MASTER_HEADER_MISMATCH|" + sheet.getName());
  }

  const seenNames = {};
  const seenIds = {};
  let recordCount = 0;
  let maxId = 0;

  for(let i=1;i<values.length;i++){
    const name = PIM_cleanDisplay_(values[i][nameCol]);
    if(!name){ continue; }
    recordCount++;

    const nameKey = PIM_key_(name);
    if(seenNames[nameKey]){
      throw new Error(
        "DUPLICATE_CANONICAL_NAME|" + sheet.getName() + "|" + name
      );
    }
    seenNames[nameKey] = true;

    const id = PIM_cleanDisplay_(values[i][idCol]);
    if(id){
      const idKey = PIM_key_(id);
      if(seenIds[idKey]){
        throw new Error("DUPLICATE_MASTER_ID|" + sheet.getName() + "|" + id);
      }
      seenIds[idKey] = true;
      const m = id.match(/(\d+)$/);
      if(m){ maxId = Math.max(maxId,Number(m[1] || 0)); }
    }
  }

  const prefix = type === "candidate" ? "CAN-" : "CLI-";
  let idsAdded = 0;

  for(let i=1;i<values.length;i++){
    const name = PIM_cleanDisplay_(values[i][nameCol]);
    const id = PIM_cleanDisplay_(values[i][idCol]);
    if(!name || id){ continue; }

    let nextId;
    do{
      maxId++;
      nextId = prefix + ("000000" + maxId).slice(-6);
    }while(seenIds[PIM_key_(nextId)]);

    sheet.getRange(i+1,idCol+1).setValue(nextId);
    seenIds[PIM_key_(nextId)] = true;
    idsAdded++;
  }

  return {recordCount:recordCount,idsAdded:idsAdded};
}


function PIM_ensureAliasSupportSheet_(ss,type){
  const sheetName = type === "candidate"
    ? PORTAL_IDENTITY_MAPPING.CANDIDATE_MAP
    : PORTAL_IDENTITY_MAPPING.CLIENT_MAP;
  const idHeader = type === "candidate" ? "Candidate ID" : "Client ID";
  const nameHeader = type === "candidate" ? "Canonical Name" : "Canonical Client Name";
  const headers = ["Alias",idHeader,nameHeader,"Active","Added By","Added At"];

  let sheet = ss.getSheetByName(sheetName);
  if(!sheet){ sheet = ss.insertSheet(sheetName); }

  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}


function PIM_ensureAuditSheet_(ss){
  let sheet = ss.getSheetByName(PORTAL_IDENTITY_MAPPING.AUDIT);
  if(!sheet){ sheet = ss.insertSheet(PORTAL_IDENTITY_MAPPING.AUDIT); }
  if(sheet.getLastRow() === 0){
    const headers = [
      "Timestamp","Team","Call ID","Source Row","Entity Type",
      "Original Value","Canonical ID","Canonical Value","Action",
      "Actor Email","Notes"
    ];
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}


/******************************************************
 * PUBLIC: MAPPING OPTIONS FOR ONE CALL
 ******************************************************/
function getPortalIdentityMappingOptions(token, callId, entityType, callLocator){
  const auth = PA_validateSession_(token);
  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const type = PIM_entityType_(entityType);
  if(!type){
    throw new Error("INVALID_IDENTITY_ENTITY");
  }

  const call = PIM_resolveCallForIdentity_(callId, callLocator);
  PIM_requireCallAccess_(auth.user, call);

  const index = PIM_masterIndex_();
  return PIM_buildMappingOptionsForCall_(call,type,index);
}

/******************************************************
 * PRIVATE: BUILD MAPPING OPTIONS FROM ONE CALL
 ******************************************************/
function PIM_buildMappingOptionsForCall_(call,type,index){
  const parsed = PIM_parseInterviewTextForPortal_(call.originalText);

  if(type === "candidate"){
    const incoming = parsed.candidateSource || parsed.candidate || "";
    const suggestions = PIM_candidateSuggestions_(incoming, index);

    return {
      ok: true,
      version: PORTAL_IDENTITY_MAPPING.VERSION,
      entityType: "candidate",
      callId: call.callId,
      callLocator: PIM_callLocatorFromCall_(call),
      incoming: incoming,
      currentValue: parsed.candidate || incoming,
      resolved: parsed.candidateIdentity && parsed.candidateIdentity.resolved === true,
      resolution: parsed.candidateIdentity || null,
      role: parsed.role || "",
      suggestions: suggestions,
      sourceCandidates: incoming ? [incoming] : [],
      sourceOptions: incoming ? [{value:incoming,partCount:0}] : []
    };
  }

  const clientParts = parsed.clientCandidateParts || [];
  const sourceCandidates = PIM_prefixCandidates_(clientParts);
  const sourceOptions = sourceCandidates.map(function(value,index){
    return {
      value:value,
      partCount:index + 1
    };
  });
  const suggestions = PIM_clientSuggestions_(clientParts, index);

  return {
    ok: true,
    version: PORTAL_IDENTITY_MAPPING.VERSION,
    entityType: "client",
    callId: call.callId,
    callLocator: PIM_callLocatorFromCall_(call),
    incoming: parsed.clientSource || parsed.client || "",
    currentValue: parsed.client || "",
    resolved: parsed.clientIdentity && parsed.clientIdentity.resolved === true,
    resolution: parsed.clientIdentity || null,
    role: parsed.role || "",
    suggestions: suggestions,
    sourceCandidates: sourceCandidates,
    sourceOptions: sourceOptions
  };
}


/******************************************************
 * PUBLIC: BATCH PREFETCH FOR CURRENT CALL SCHEDULE
 *
 * One session validation + one master-index load serves
 * all visible unresolved candidate/client rows. This is
 * called in the background after My Schedule renders.
 ******************************************************/
function getPortalIdentityMappingOptionsBatch(token, requests){
  const auth = PA_validateSession_(token);
  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const list = Array.isArray(requests) ? requests.slice(0,120) : [];
  const index = PIM_masterIndex_();
  const items = [];
  const warmedDates = {};

  list.forEach(function(request){
    const type = PIM_entityType_(request && request.entityType);
    const key = String(request && request.key || "").trim();

    if(!type){
      items.push({
        key:key,
        ok:false,
        error:"INVALID_IDENTITY_ENTITY"
      });
      return;
    }

    try{
      const call = PIM_resolveCallForIdentity_(
        request && request.callId,
        request && request.callLocator
      );
      PIM_requireCallAccess_(auth.user, call);

      const data = PIM_buildMappingOptionsForCall_(call,type,index);
      items.push({
        key:key,
        ok:true,
        data:data
      });

      if(call.dateKey){
        warmedDates[String(call.dateKey)] = true;
      }
    }catch(error){
      items.push({
        key:key,
        ok:false,
        error:String(error && error.message ? error.message : error)
      });
    }
  });

  // Warm Raw Data date-block locations after option results are built.
  // This is best-effort and never blocks the option results.
  try{
    PIM_warmRawBlocksForDates_(Object.keys(warmedDates));
  }catch(error){
    Logger.log(
      "Identity Raw prewarm skipped: " +
      String(error && error.message ? error.message : error)
    );
  }

  return {
    ok:true,
    version:PORTAL_IDENTITY_MAPPING.VERSION,
    items:items
  };
}



/******************************************************
 * PUBLIC: MAP TO EXISTING MASTER RECORD
 ******************************************************/
function mapPortalIdentityToExisting(
  token,
  callId,
  entityType,
  masterRef,
  sourceValue,
  callLocator
){
  const auth = PA_validateSession_(token);
  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const type = PIM_entityType_(entityType);
  if(!type){
    throw new Error("INVALID_IDENTITY_ENTITY");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try{
    // Re-resolve INSIDE the lock so two overlapping mapping requests
    // cannot both proceed with stale schedule-row state.
    const call = PIM_resolveCallForIdentity_(callId, callLocator);
    PIM_assertIdentityWriteLocatorFresh_(callLocator, call);
    PIM_requireCallAccess_(auth.user, call);
    PIM_assertIdentityEditable_(call);

    const index = PIM_masterIndex_();
    const target = PIM_resolveMasterRef_(type, masterRef, index);
    if(!target){
      throw new Error("MASTER_RECORD_NOT_FOUND");
    }

    const sourceSelection = PIM_validateSourceSelection_(
      call,
      type,
      sourceValue
    );
    const source = sourceSelection.value;

    const canonicalId = PIM_ensureMasterId_(type, target);
    const canonicalName = String(target.name || "").trim();

    if(!canonicalName){
      throw new Error("CANONICAL_NAME_REQUIRED");
    }

    const writeResult = PIM_applySourceCorrection_(
      call,
      type,
      source,
      canonicalName,
      canonicalId,
      auth.user,
      sourceSelection
    );

    PIM_saveAlias_(
      type,
      source,
      canonicalId,
      canonicalName,
      auth.user.email
    );

    const aliasKey = PIM_key_(source);
    if(aliasKey){
      if(type === "candidate"){ index.candidateAlias[aliasKey] = target; }
      else{ index.clientAlias[aliasKey] = target; }
    }
    PIM_storePersistentIndex_(index);

    return {
      ok: true,
      entityType: type,
      canonicalId: canonicalId,
      canonicalName: canonicalName,
      sourceValue: source,
      callLocator:PIM_callLocatorFromCall_(call),
      sourceUpdate: writeResult,
      message:
        (type === "candidate" ? "Candidate" : "Client") +
        " mapped to " + canonicalName + "." +
        (writeResult.warnings && writeResult.warnings.length
          ? " Warning: " + writeResult.warnings.join(" | ")
          : " Source records were synchronized.")
    };
  } finally {
    lock.releaseLock();
  }
}


/******************************************************
 * PUBLIC: CREATE NEW MASTER RECORD AND MAP
 ******************************************************/
function createPortalIdentityAndMap(
  token,
  callId,
  entityType,
  canonicalName,
  sourceValue,
  callLocator
){
  const auth = PA_validateSession_(token);
  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const type = PIM_entityType_(entityType);
  if(!type){
    throw new Error("INVALID_IDENTITY_ENTITY");
  }

  const cleanName = PIM_cleanDisplay_(canonicalName);
  if(!cleanName){
    throw new Error("CANONICAL_NAME_REQUIRED");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try{
    // Re-resolve INSIDE the lock so a second create/map request cannot
    // reuse a stale locator after another mapping changed the row.
    const call = PIM_resolveCallForIdentity_(callId, callLocator);
    PIM_assertIdentityWriteLocatorFresh_(callLocator, call);
    PIM_requireCallAccess_(auth.user, call);
    PIM_assertIdentityEditable_(call);

    const sourceSelection = PIM_validateSourceSelection_(
      call,
      type,
      sourceValue
    );
    const source = sourceSelection.value;

    const index = PIM_masterIndex_();

    const existing =
      type === "candidate"
        ? index.candidateByName[PIM_key_(cleanName)]
        : index.clientByName[PIM_key_(cleanName)];

    let record = existing || null;
    let created = false;

    if(!record){
      record = PIM_appendMasterRecord_(type, cleanName);
      created = true;
      if(type === "candidate"){
        index.candidateRecords.push(record);
        index.candidateByName[PIM_key_(record.name)] = record;
        if(record.id){ index.candidateById[PIM_key_(record.id)] = record; }
      }else{
        index.clientRecords.push(record);
        index.clientByName[PIM_key_(record.name)] = record;
        if(record.id){ index.clientById[PIM_key_(record.id)] = record; }
      }
    }

    const canonicalId = PIM_ensureMasterId_(type, record);
    const finalName = String(record.name || cleanName).trim();

    const writeResult = PIM_applySourceCorrection_(
      call,
      type,
      source,
      finalName,
      canonicalId,
      auth.user,
      sourceSelection
    );

    PIM_saveAlias_(
      type,
      source,
      canonicalId,
      finalName,
      auth.user.email
    );

    const aliasKey = PIM_key_(source);
    if(aliasKey){
      if(type === "candidate"){ index.candidateAlias[aliasKey] = record; }
      else{ index.clientAlias[aliasKey] = record; }
    }
    PIM_storePersistentIndex_(index);

    return {
      ok: true,
      created: created,
      entityType: type,
      canonicalId: canonicalId,
      canonicalName: finalName,
      sourceValue: source,
      callLocator:PIM_callLocatorFromCall_(call),
      sourceUpdate: writeResult,
      message:
        (created ? "Created and mapped " : "Mapped to existing ") +
        (type === "candidate" ? "candidate " : "client ") +
        finalName + "." +
        (writeResult.warnings && writeResult.warnings.length
          ? " Warning: " + writeResult.warnings.join(" | ")
          : " Source records were synchronized.")
    };
  } finally {
    lock.releaseLock();
  }
}


/******************************************************
 * PRIVATE: STABLE IDENTITY CALL RESOLVER
 *
 * Call IDs contain a hash of interview text. Candidate/client
 * correction intentionally changes that text, so a browser can
 * temporarily hold a stale Call ID. Resolve by normal Call ID first,
 * then safely fall back to Date Key + Source Row supplied by the
 * already-rendered Call Schedule row.
 *
 * Authorization is still enforced separately by
 * PIM_requireCallAccess_().
 ******************************************************/
function PIM_resolveCallForIdentity_(callId, locator){
  const id = String(callId || "").trim();
  const loc = locator && typeof locator === "object" ? locator : {};
  const dateKey = String(
    loc.dateKey ||
    (typeof PC_dateKeyFromCallId_ === "function" ? PC_dateKeyFromCallId_(id) : "") ||
    ""
  ).trim();
  const sourceRow = Number(loc.sourceRow || 0);
  const originalText = String(loc.originalText || "").trim();

  // FAST PATH: the Call Schedule UI already carries a stable source row.
  // Read only B:F for that row instead of rebuilding the whole dated schedule.
  if(sourceRow > 0 && dateKey && typeof PC_scheduleSheet_ === "function"){
    try{
      const sheet = PC_scheduleSheet_();
      if(sourceRow <= sheet.getLastRow()){
        const row = sheet.getRange(sourceRow,2,1,5).getDisplayValues()[0];
        const bText = String(row[0] || "").trim();
        const eText = String(row[3] || "").trim();
        const handler = String(row[4] || "").trim();
        const extracted = eText || bText;

        if(extracted && !(typeof PC_isDateHeader_ === "function" && PC_isDateHeader_(extracted))){
          const parsed = PIM_parseInterviewTextForPortal_(extracted);
          if(parsed && (parsed.candidateSource || parsed.candidate)){
            return {
              callId:id,
              sourceRow:sourceRow,
              dateKey:dateKey,
              date:String(loc.date || dateKey),
              candidate:parsed.candidate || "",
              candidateSource:parsed.candidateSource || parsed.candidate || "",
              client:parsed.client || "",
              clientSource:parsed.clientSource || parsed.client || "",
              role:parsed.role || "",
              duration:parsed.duration || "",
              round:parsed.round || "",
              time:parsed.time || "",
              handler:handler,
              lookupText:bText,
              originalText:extracted,
              status:"Scheduled"
            };
          }
        }
      }
    }catch(error){
      Logger.log("Identity direct-row resolver skipped: " + String(error && error.message || error));
    }
  }

  let primaryError = null;
  if(id && typeof PCO_getCallById_ === "function"){
    try{
      return PCO_getCallById_(id);
    }catch(error){
      primaryError = error;
    }
  }

  if(!dateKey || typeof PC_loadScheduleByDateKey_ !== "function"){
    if(primaryError){ throw primaryError; }
    throw new Error("CALL_NOT_FOUND");
  }

  const schedule = PC_loadScheduleByDateKey_(dateKey);
  const calls = schedule && Array.isArray(schedule.calls) ? schedule.calls : [];
  let target = null;

  if(sourceRow > 0){
    target = calls.find(function(call){
      return Number(call && call.sourceRow || 0) === sourceRow;
    }) || null;
  }

  if(!target && originalText){
    const wanted = typeof PC_normalizeText_ === "function"
      ? PC_normalizeText_(originalText)
      : PIM_key_(originalText);
    target = calls.find(function(call){
      const text = String(call && call.originalText || "");
      const actual = typeof PC_normalizeText_ === "function"
        ? PC_normalizeText_(text)
        : PIM_key_(text);
      return actual === wanted;
    }) || null;
  }

  if(!target){
    if(primaryError){
      Logger.log("Identity Call Resolver fallback failed after: " + String(primaryError && primaryError.message || primaryError));
    }
    throw new Error("CALL_NOT_FOUND");
  }

  return target;
}

function PIM_assertIdentityWriteLocatorFresh_(locator,call){
  const loc = locator && typeof locator === "object" ? locator : {};
  const expected = String(loc.originalText || "").trim();
  if(!expected){
    return true;
  }

  const actual = String(call && call.originalText || "").trim();
  const normalize = function(value){
    return typeof PC_normalizeText_ === "function"
      ? PC_normalizeText_(value)
      : PIM_normalizeLoose_(value);
  };

  if(normalize(expected) !== normalize(actual)){
    throw new Error("IDENTITY_SOURCE_CHANGED_REFRESH_REQUIRED");
  }

  return true;
}


function PIM_callLocatorFromCall_(call){
  return {
    dateKey: String(call && call.dateKey || "").trim(),
    sourceRow: Number(call && call.sourceRow || 0),
    originalText: String(call && call.originalText || "")
  };
}


/******************************************************
 * PUBLIC: READ-ONLY FALLBACK TEST
 *
 * Tests both connected teams when the team router is available.
 * No sheets are modified.
 ******************************************************/
function PIM_testIdentityCallLocatorReadOnly(){
  function runOne(teamCode){
    const execute = function(){
      const schedule = PC_loadScheduleByDateKey_("");
      const first = schedule && schedule.calls && schedule.calls.length
        ? schedule.calls[0]
        : null;

      if(!first){
        return {teamCode:teamCode, ok:true, skipped:true, reason:"NO_CALLS"};
      }

      const fakeId =
        "CALL-" + first.dateKey + "-000000000000-999";

      const resolved = PIM_resolveCallForIdentity_(
        fakeId,
        PIM_callLocatorFromCall_(first)
      );

      return {
        teamCode:teamCode,
        ok:
          Number(resolved.sourceRow || 0) === Number(first.sourceRow || 0) &&
          String(resolved.dateKey || "") === String(first.dateKey || ""),
        dateKey:first.dateKey,
        sourceRow:first.sourceRow,
        originalCallId:first.callId,
        resolvedCallId:resolved.callId
      };
    };

    if(
      teamCode &&
      typeof PTR_withExecutionTeamCode_ === "function"
    ){
      return PTR_withExecutionTeamCode_(teamCode, execute);
    }

    return execute();
  }

  const teams =
    typeof PTR_withExecutionTeamCode_ === "function"
      ? ["PRADEEP","HYD"]
      : [""];

  const results = teams.map(runOne).filter(Boolean);
  const result = {
    ok: results.every(function(item){ return item.ok === true; }),
    mode:"READ_ONLY_IDENTITY_CALL_LOCATOR_TEST",
    version:PORTAL_IDENTITY_MAPPING.VERSION,
    results:results
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/******************************************************
 * READ-ONLY: CONCURRENCY / STALE LOCATOR GUARD TEST
 *
 * Confirms a current locator is accepted and a stale locator is
 * rejected before any sheet write occurs. No sheets are modified.
 ******************************************************/
function PIM_testIdentityConcurrencyGuardReadOnly(){
  const execute = function(){
    const schedule = PC_loadScheduleByDateKey_("");
    const call = schedule && schedule.calls && schedule.calls.length
      ? schedule.calls[0]
      : null;

    if(!call){
      return {ok:true,skipped:true,reason:"NO_CALLS"};
    }

    const locator = PIM_callLocatorFromCall_(call);
    const resolved = PIM_resolveCallForIdentity_(call.callId,locator);
    let freshAccepted = false;
    let staleRejected = false;
    let staleError = "";

    try{
      PIM_assertIdentityWriteLocatorFresh_(locator,resolved);
      freshAccepted = true;
    }catch(error){
      freshAccepted = false;
    }

    const stale = {
      dateKey:locator.dateKey,
      sourceRow:locator.sourceRow,
      originalText:locator.originalText + " [STALE TEST]"
    };

    try{
      PIM_assertIdentityWriteLocatorFresh_(stale,resolved);
    }catch(error){
      staleError = String(error && error.message ? error.message : error);
      staleRejected = staleError === "IDENTITY_SOURCE_CHANGED_REFRESH_REQUIRED";
    }

    return {
      ok:freshAccepted && staleRejected,
      dateKey:locator.dateKey,
      sourceRow:locator.sourceRow,
      freshAccepted:freshAccepted,
      staleRejected:staleRejected,
      staleError:staleError
    };
  };

  const result = typeof PTR_withExecutionTeamCode_ === "function"
    ? PTR_withExecutionTeamCode_("PRADEEP",execute)
    : execute();

  const output = {
    ok:result.ok === true,
    mode:"READ_ONLY_IDENTITY_CONCURRENCY_GUARD",
    version:PORTAL_IDENTITY_MAPPING.VERSION,
    result:result
  };
  Logger.log(JSON.stringify(output,null,2));
  return output;
}


/******************************************************
 * READ-ONLY: OCT 22 MIXED-ROW DIAGNOSTIC
 *
 * Locates the reported 9:30 PM / Reporting and Integrations Analyst 2
 * schedule row and the corresponding canonical shared Raw Data row.
 * No sheets are modified.
 ******************************************************/
function PIM_debugVarshiniOct22ReadOnly(){
  const execute = function(){
    const dateKey = "2026-10-22";
    const schedule = PC_loadScheduleByDateKey_(dateKey);
    const scheduleHits = (schedule && schedule.calls || []).filter(function(call){
      const text = PIM_key_(call && call.originalText || "");
      return (
        text.indexOf("reporting and integrations analyst 2") >= 0 ||
        text.indexOf("varshini reddy borra") >= 0 ||
        text.indexOf("nagajahnavi kancharla") >= 0
      );
    }).map(function(call){
      return {
        sourceRow:Number(call.sourceRow || 0),
        callId:String(call.callId || ""),
        candidate:String(call.candidate || ""),
        client:String(call.client || ""),
        time:String(call.time || ""),
        round:String(call.round || ""),
        originalText:String(call.originalText || "")
      };
    });

    const shared = PTR_sharedRawDataSource_();
    const sheet = shared.sheet;
    const lastRow = sheet.getLastRow();
    const values = lastRow > 0 ? sheet.getRange(1,2,lastRow,1).getDisplayValues() : [];
    const rawHits = [];
    let currentDateKey = "";

    for(let i=0;i<values.length;i++){
      const display = String(values[i][0] || "").trim();
      const maybeDate = PIM_dateKeyFromValue_(display,display);
      if(maybeDate){
        currentDateKey = maybeDate;
        continue;
      }
      if(currentDateKey !== dateKey || !display){ continue; }
      const key = PIM_key_(display);
      if(
        key.indexOf("reporting and integrations analyst 2") >= 0 ||
        key.indexOf("varshini reddy borra") >= 0 ||
        key.indexOf("nagajahnavi kancharla") >= 0
      ){
        rawHits.push({row:i+1,text:display});
      }
    }

    return {
      teamCode:typeof PTR_currentTeamCode_ === "function" ? PTR_currentTeamCode_() : "",
      dateKey:dateKey,
      scheduleHits:scheduleHits,
      sharedRawWorkbook:shared.spreadsheet && shared.spreadsheet.getName ? shared.spreadsheet.getName() : "",
      sharedRawSheet:sheet ? sheet.getName() : "",
      rawHits:rawHits
    };
  };

  const result = typeof PTR_withExecutionTeamCode_ === "function"
    ? PTR_withExecutionTeamCode_("PRADEEP",execute)
    : execute();

  Logger.log(JSON.stringify({
    ok:true,
    mode:"READ_ONLY_VARSHINI_OCT22_DIAGNOSTIC",
    version:PORTAL_IDENTITY_MAPPING.VERSION,
    result:result
  },null,2));

  return result;
}


/******************************************************
 * PUBLIC: READ-ONLY PARSER TESTS FOR NEW FORMAT
 ******************************************************/
function PIM_testParserSamplesReadOnly(){
  const samples = [
    "Devaki Naga Venkata Prasanthi V (IR) – Phone Interview – Laya Healthcare - Real Time Analyst – 2:30 PM IST – Duration: 15 Mins (1st Round) (Candidate 1st interview)",
    "Deepanshu R (Ireland) – Interview – EBay - Software Engineer - Cloud Infrastructure – 3:30 PM IST – Duration: 20 Mins (1st Round)",
    "Aslesha yalamanchili – Interview – H - E Parts International - Data and Integration Engineer – 6:30 PM IST – Duration: 30 Mins (1st Round)",
    "Deva Kalyan A – Interview – Capital One - Sr. Business Analyst, Spend Experiences – 7:00 PM IST – Duration: 30 Mins (1st Round)",
    "Yeswanthi Chowdavaram – Interview – Clinical Architecture - Clinical Content Analyst – 7:00 PM IST – Duration: 20 Mins (4th Round)",
    "Jyothi lohith kumar mamidi – Interview – FirstEnergy Corp - HR Data Analyst – 7:30 PM IST – Duration: 30 Mins (1st Round)",
    "Saisnehanjali – Phone Interview – Neighborhood health center - EHR Support – 7:30 PM IST – Duration: 30 Mins (1th Round)",
    "Sunil kumar Pasupuleti (Canada) – Interview – CAAT Pension Plan - Full Stack Solutions Developer – 7:30 PM IST – Duration: 30 Mins (1st Round)",
    "Benhur ruchitha mamidi – Interview – Fortify Children's Health - Pop Health Interoperability Specialist – 7:30 PM IST – Duration: 15 Mins (1st Round)",
    "Harshitha Paladugu – Phone Interview – DrinkPAK - Jr. Analyst, SAP IT Systems – 7:30 PM IST – Duration: 30 Mins (1st Round)",
    "Ravi Teja Algubelli – Phone Interview – Ellucian - Sr. Cloud Engineer – 8:05 PM IST – Duration: 15 Mins (1st Round)",
    "Akhil kondabathini – Phone Interview – PointClickCare - Sr Solutions Analyst – 8:30 PM IST – Duration: 30 Mins (1st Round)",
    "Sanjay Nenavath – Interview – Prism Health Care Services - Documentation Specialist – 8:30 PM IST – Duration: 30 Mins (1st Round)",
    "Aslesha yalmanchili – Interview – The HOLT Group - Business Intelligence – 8:30 PM IST – Duration: 30 Mins (2nd Round) (Candidate Own Side)",
    "Lavan Kumar (Canada) – Interview – Tangam Systems - Software Developer / Analyst position – 8:30 PM IST – Duration: 30 Mins (1st Round)",
    "Mahnoor Hasan – Interview – Diaz Anselmo & Associates - Business Analyst – 9:00 PM IST – Duration: 30 Mins (1st Round)",
    "Devi Annamreddy – Interview – Accutive - Software Developer – 9:00 PM IST – Duration: 60 Mins (1st Round)",
    "Jyothipriya Ramavath — Interview— Elevation Global — 9:30 PM IST — 1st Round -30Mins",
    "Devika gunda – Interview – Tri Pointe Homes - Business Systems Analyst – 9:30 PM IST – Duration: 30 Mins (1st Round)",
    "Chandana Setty Sharaff – Interview – Fortify Children's Health - Pop Health Interoperability Specialist – 10:15 PM IST – Duration: 15 Mins (1st Round)",
    "Snigdha chanda – Interview – Walgreens - Collaboration Engineer (Senior Systems Engineer II) – 10:30 PM IST – Duration: 45 Mins (3rd Round) (Re-scheduled from 16 oct)"
  ];

  const out = samples.map(function(sample){
    return PIM_parseInterviewTextForPortal_(sample);
  });

  const result = {
    ok: out.length === 21,
    sampleCount: out.length,
    note: "Client/Role boundary becomes authoritative when the client exists in Client Master or Client Name Map. Until then all possible client prefixes are offered to the Handler for confirmation.",
    rows: out
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


function PIM_testIdentityMastersReadOnly(){
  PIM_clearIdentityCaches_();
  const ss = PIM_controlWorkbook_({allowActiveFallback:true});
  const candidateSheet = ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CANDIDATE_MASTER);
  const clientSheet = ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CLIENT_MASTER);
  const index = PIM_masterIndex_();

  const result = {
    ok: !!candidateSheet && !!clientSheet,
    mode: "READ_ONLY_IDENTITY_MASTER_CHECK",
    workbook: ss.getName(),
    workbookId: ss.getId(),
    configuredWorkbookId: String(
      PropertiesService.getScriptProperties().getProperty(
        PORTAL_IDENTITY_MAPPING.CONTROL_WORKBOOK_PROPERTY
      ) || ""
    ),
    candidateMasterFound: !!candidateSheet,
    clientMasterFound: !!clientSheet,
    candidateCount: index.candidateRecords.length,
    clientCount: index.clientRecords.length,
    candidateAliasCount: Object.keys(index.candidateAlias).length,
    clientAliasCount: Object.keys(index.clientAlias).length
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/******************************************************
 * PORTAL PARSER USED BY CALL SCHEDULE / INTERVIEWS
 ******************************************************/
function PIM_parseInterviewTextForPortal_(text){
  const original = String(text || "").replace(/\u00A0/g," ").trim();

  const empty = {
    candidate: "",
    candidateSource: "",
    countryTag: "",
    client: "",
    clientSource: "",
    clientCandidateParts: [],
    role: "",
    duration: "",
    round: "",
    roundNo: 0,
    time: "",
    candidateIdentity: {resolved:false,status:"UNRESOLVED",id:"",name:""},
    clientIdentity: {resolved:false,status:"UNRESOLVED",id:"",name:""},
    identityResolved: false,
    originalText: original
  };

  if(!original){
    return empty;
  }

  const normalized = PIM_normalizeInterview_(original);
  const activity = PIM_activityMatch_(normalized);

  let candidateSource = "";
  let countryTag = "";

  if(activity && activity.index > 0){
    const candidateBlock = normalized.substring(0, activity.index)
      .replace(/[\s,\-:|]+$/g,"")
      .trim();

    const tag = candidateBlock.match(/\(([^)]*)\)\s*$/);
    if(tag){
      countryTag = String(tag[1] || "").trim();
    }

    candidateSource = candidateBlock
      .replace(/\([^)]*\)/g," ")
      .replace(/\s+/g," ")
      .trim();
  }else{
    const first = normalized.search(/\s-\s|,\s/);
    candidateSource = (first > 0 ? normalized.substring(0,first) : normalized)
      .replace(/\([^)]*\)/g," ")
      .replace(/\s+/g," ")
      .trim();
  }

  const roundInfo = PIM_roundInfo_(normalized);
  const timeInfo = PIM_timeInfo_(normalized);
  const duration = PIM_durationText_(normalized);

  const middleInfo = PIM_middleInfo_(normalized, activity, timeInfo);
  const index = PIM_masterIndex_();

  const candidateIdentity = PIM_resolveCandidateExact_(candidateSource, index);
  const candidate = candidateIdentity.resolved
    ? candidateIdentity.name
    : candidateSource;

  const clientResolved = PIM_resolveClientPrefixExact_(middleInfo.clientParts, index);

  let client = "";
  let clientSource = "";
  let role = "";
  let clientIdentity = {
    resolved: false,
    status: "UNRESOLVED",
    id: "",
    name: "",
    ref: "",
    sourceValue: "",
    sourcePartCount: 0
  };

  if(clientResolved && clientResolved.record){
    const count = clientResolved.partCount;
    clientSource = middleInfo.clientParts.slice(0,count).join(" - ");
    client = clientResolved.record.name;
    role = middleInfo.clientParts.slice(count).join(" - ");
    clientIdentity = {
      resolved: true,
      status: clientResolved.status,
      id: clientResolved.record.id || "",
      name: clientResolved.record.name || "",
      ref: clientResolved.record.ref || "",
      sourceValue: clientSource,
      sourcePartCount: count
    };
  }else{
    clientSource = middleInfo.clientParts.length
      ? middleInfo.clientParts[0]
      : "";
    client = clientSource;
    role = middleInfo.clientParts.slice(clientSource ? 1 : 0).join(" - ");
  }

  return {
    candidate: candidate,
    candidateSource: candidateSource,
    countryTag: countryTag,
    client: client,
    clientSource: clientSource,
    clientCandidateParts: middleInfo.clientParts.slice(),
    leadingDescriptorParts: middleInfo.leadingParts.slice(),
    role: role,
    duration: duration,
    round: roundInfo.round,
    roundNo: roundInfo.roundNo,
    time: timeInfo.time,
    candidateIdentity: candidateIdentity,
    clientIdentity: clientIdentity,
    identityResolved:
      candidateIdentity.resolved === true &&
      clientIdentity.resolved === true,
    originalText: original
  };
}


/******************************************************
 * SERVER-SIDE GUARD BEFORE HANDLER OUTCOME SUBMISSION
 ******************************************************/
function PIM_assertCallIdentityResolved_(call){
  const parsed = PIM_parseInterviewTextForPortal_(call && call.originalText || "");

  const missing = [];
  if(!parsed.candidateIdentity || parsed.candidateIdentity.resolved !== true){
    missing.push("Candidate");
  }
  if(!parsed.clientIdentity || parsed.clientIdentity.resolved !== true){
    missing.push("Client");
  }

  if(missing.length){
    throw new Error(
      "IDENTITY_MAPPING_REQUIRED|" +
      missing.join("+")
    );
  }

  return parsed;
}


/******************************************************
 * MASTER INDEX
 ******************************************************/
function PIM_masterIndex_(){
  if(PIM_MASTER_CACHE_){
    return PIM_MASTER_CACHE_;
  }

  const cachedSnapshot = PIM_cacheGetLargeJson_(PIM_masterSnapshotCacheBase_());
  const cachedIndex = PIM_snapshotToIndex_(cachedSnapshot);
  if(cachedIndex){
    PIM_MASTER_CACHE_ = cachedIndex;
    return cachedIndex;
  }

  const ss = PIM_controlWorkbook_({allowActiveFallback:true});

  const candidateRecords = PIM_readMasterRecords_(
    ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CANDIDATE_MASTER),
    "candidate"
  );

  const clientRecords = PIM_readMasterRecords_(
    ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CLIENT_MASTER),
    "client"
  );

  const index = {
    candidateRecords: candidateRecords,
    clientRecords: clientRecords,
    candidateByName: {},
    candidateById: {},
    candidateAlias: {},
    clientByName: {},
    clientById: {},
    clientAlias: {}
  };

  candidateRecords.forEach(function(record){
    index.candidateByName[PIM_key_(record.name)] = record;
    if(record.id){ index.candidateById[PIM_key_(record.id)] = record; }
  });

  clientRecords.forEach(function(record){
    index.clientByName[PIM_key_(record.name)] = record;
    if(record.id){ index.clientById[PIM_key_(record.id)] = record; }
  });

  PIM_readAliasRows_(
    ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CANDIDATE_MAP),
    "candidate",
    index
  ).forEach(function(item){
    if(item.aliasKey && item.record){ index.candidateAlias[item.aliasKey] = item.record; }
  });

  PIM_readAliasRows_(
    ss.getSheetByName(PORTAL_IDENTITY_MAPPING.CLIENT_MAP),
    "client",
    index
  ).forEach(function(item){
    if(item.aliasKey && item.record){ index.clientAlias[item.aliasKey] = item.record; }
  });

  PIM_storePersistentIndex_(index);
  return index;
}

function PIM_readMasterRecords_(sheet, type){
  if(!sheet || sheet.getLastRow() < 1){
    return [];
  }

  const values = sheet.getDataRange().getDisplayValues();
  if(!values.length){
    return [];
  }

  const headers = values[0].map(function(v){ return PIM_key_(v); });
  const idHeader = type === "candidate" ? "candidate id" : "client id";
  const nameHeader = type === "candidate" ? "canonical name" : "canonical client name";

  let idCol = headers.indexOf(idHeader);
  let nameCol = headers.indexOf(nameHeader);

  // Client Master may be intentionally completely empty before first use.
  if(nameCol < 0 && type === "client"){
    return [];
  }

  // Candidate Master is user-created and expected to use these exact headers.
  if(nameCol < 0){
    return [];
  }

  if(idCol < 0){
    idCol = 0;
  }

  const out = [];
  for(let i=1;i<values.length;i++){
    const name = PIM_cleanDisplay_(values[i][nameCol]);
    if(!name){
      continue;
    }
    const id = PIM_cleanDisplay_(values[i][idCol]);
    out.push({
      type: type,
      rowNumber: i + 1,
      id: id,
      name: name,
      ref: id ? id : ("ROW:" + (i + 1))
    });
  }
  return out;
}


function PIM_readAliasRows_(sheet, type, index){
  if(!sheet || sheet.getLastRow() <= 1){
    return [];
  }

  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(function(v){ return PIM_key_(v); });
  const aliasCol = headers.indexOf("alias");
  const idCol = headers.indexOf(type === "candidate" ? "candidate id" : "client id");
  const canonicalCol = headers.indexOf(type === "candidate" ? "canonical name" : "canonical client name");
  const activeCol = headers.indexOf("active");

  if(aliasCol < 0){
    return [];
  }

  const out = [];
  for(let i=1;i<values.length;i++){
    if(activeCol >= 0){
      const active = PIM_key_(values[i][activeCol]);
      if(active && ["false","no","0","inactive"].indexOf(active) !== -1){
        continue;
      }
    }

    const alias = PIM_cleanDisplay_(values[i][aliasCol]);
    if(!alias){
      continue;
    }

    let record = null;
    if(idCol >= 0){
      const idKey = PIM_key_(values[i][idCol]);
      if(type === "candidate"){
        record = index.candidateById[idKey] || null;
      }else{
        record = index.clientById[idKey] || null;
      }
    }

    if(!record && canonicalCol >= 0){
      const nameKey = PIM_key_(values[i][canonicalCol]);
      record = type === "candidate"
        ? index.candidateByName[nameKey] || null
        : index.clientByName[nameKey] || null;
    }

    out.push({
      aliasKey: PIM_key_(alias),
      record: record
    });
  }

  return out;
}


/******************************************************
 * EXACT RESOLUTION
 ******************************************************/
function PIM_resolveCandidateExact_(incoming, index){
  const key = PIM_key_(incoming);
  if(!key){
    return {resolved:false,status:"UNRESOLVED",id:"",name:"",ref:""};
  }

  let record = index.candidateByName[key] || null;
  if(record){
    return {
      resolved:true,
      status:"MASTER_EXACT",
      id:record.id || "",
      name:record.name,
      ref:record.ref
    };
  }

  record = index.candidateAlias[key] || null;
  if(record){
    return {
      resolved:true,
      status:"APPROVED_ALIAS",
      id:record.id || "",
      name:record.name,
      ref:record.ref
    };
  }

  return {resolved:false,status:"UNRESOLVED",id:"",name:"",ref:""};
}


function PIM_resolveClientPrefixExact_(parts, index){
  if(!parts || !parts.length){
    return null;
  }

  for(let count=parts.length;count>=1;count--){
    const source = parts.slice(0,count).join(" - ");
    const key = PIM_key_(source);

    let record = index.clientByName[key] || null;
    if(record){
      return {record:record,partCount:count,status:"MASTER_EXACT"};
    }

    record = index.clientAlias[key] || null;
    if(record){
      return {record:record,partCount:count,status:"APPROVED_ALIAS"};
    }
  }

  return null;
}


/******************************************************
 * FUZZY SUGGESTIONS - NEVER AUTO-APPLIED
 ******************************************************/
function PIM_candidateSuggestions_(incoming, index){
  const bestByRef = {};

  index.candidateRecords.forEach(function(record){
    const score = PIM_nameScore_(incoming, record.name);
    if(score < PORTAL_IDENTITY_MAPPING.MIN_SUGGESTION_SCORE){
      return;
    }
    bestByRef[record.ref] = {
      ref: record.ref,
      id: record.id || "",
      name: record.name,
      score: score,
      sourceValue: incoming
    };
  });

  return Object.keys(bestByRef)
    .map(function(key){ return bestByRef[key]; })
    .sort(function(a,b){
      if(b.score !== a.score){ return b.score - a.score; }
      return a.name.localeCompare(b.name);
    })
    .slice(0,PORTAL_IDENTITY_MAPPING.MAX_SUGGESTIONS);
}


function PIM_clientSuggestions_(parts, index){
  const prefixes = PIM_prefixCandidates_(parts);
  const bestByRef = {};

  prefixes.forEach(function(source){
    index.clientRecords.forEach(function(record){
      const score = PIM_textScore_(source, record.name);
      if(score < PORTAL_IDENTITY_MAPPING.MIN_SUGGESTION_SCORE){
        return;
      }

      const existing = bestByRef[record.ref];
      if(!existing || score > existing.score){
        bestByRef[record.ref] = {
          ref: record.ref,
          id: record.id || "",
          name: record.name,
          score: score,
          sourceValue: source
        };
      }
    });
  });

  return Object.keys(bestByRef)
    .map(function(key){ return bestByRef[key]; })
    .sort(function(a,b){
      if(b.score !== a.score){ return b.score - a.score; }
      return a.name.localeCompare(b.name);
    })
    .slice(0,PORTAL_IDENTITY_MAPPING.MAX_SUGGESTIONS);
}


function PIM_nameScore_(a,b){
  const aTokens = PIM_tokens_(a);
  const bTokens = PIM_tokens_(b);
  if(!aTokens.length || !bTokens.length){
    return 0;
  }

  const full = PIM_textScore_(a,b);
  const maxLen = Math.max(aTokens.length,bTokens.length);
  let aligned = 0;

  for(let i=0;i<maxLen;i++){
    const av = aTokens[i] || "";
    const bv = bTokens[i] || "";
    if(!av || !bv){
      continue;
    }
    if(av === bv){
      aligned += 1;
      continue;
    }
    if(av.length === 1 && bv.indexOf(av) === 0){
      aligned += 1;
      continue;
    }
    if(bv.length === 1 && av.indexOf(bv) === 0){
      aligned += 1;
      continue;
    }
    aligned += PIM_similarity_(av,bv);
  }

  const alignedScore = Math.round((aligned / maxLen) * 100);

  // Only an exact normalized name is a true 100% automatic match.
  // Initial-expansion / fuzzy similarity can rank very highly, but it
  // still requires Handler confirmation and is capped below 100.
  if(full === 100){
    return 100;
  }

  return Math.min(99,Math.max(full,alignedScore));
}


function PIM_textScore_(a,b){
  const ak = PIM_key_(a);
  const bk = PIM_key_(b);
  if(!ak || !bk){
    return 0;
  }
  if(ak === bk){
    return 100;
  }
  return Math.round(PIM_similarity_(ak,bk) * 100);
}


function PIM_similarity_(a,b){
  const x = String(a || "");
  const y = String(b || "");
  if(x === y){ return 1; }
  if(!x || !y){ return 0; }

  const distance = PIM_levenshtein_(x,y);
  return Math.max(0,1 - distance / Math.max(x.length,y.length));
}


function PIM_levenshtein_(a,b){
  const m = a.length;
  const n = b.length;
  const row = [];
  for(let j=0;j<=n;j++){
    row[j] = j;
  }
  for(let i=1;i<=m;i++){
    let previous = row[0];
    row[0] = i;
    for(let j=1;j<=n;j++){
      const temp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j-1] + 1,
        previous + (a.charAt(i-1) === b.charAt(j-1) ? 0 : 1)
      );
      previous = temp;
    }
  }
  return row[n];
}


/******************************************************
 * MASTER WRITE HELPERS
 ******************************************************/
function PIM_resolveMasterRef_(type, ref, index){
  const value = String(ref || "").trim();
  if(!value){
    return null;
  }

  if(/^ROW:\d+$/i.test(value)){
    const row = Number(value.split(":")[1] || 0);
    const records = type === "candidate" ? index.candidateRecords : index.clientRecords;
    return records.find(function(item){ return item.rowNumber === row; }) || null;
  }

  const key = PIM_key_(value);
  return type === "candidate"
    ? (index.candidateById[key] || index.candidateByName[key] || null)
    : (index.clientById[key] || index.clientByName[key] || null);
}


function PIM_ensureMasterId_(type, record){
  if(record.id){
    return record.id;
  }

  const ss = PIM_controlWorkbook_({allowActiveFallback:true});
  const sheetName = type === "candidate"
    ? PORTAL_IDENTITY_MAPPING.CANDIDATE_MASTER
    : PORTAL_IDENTITY_MAPPING.CLIENT_MASTER;
  const sheet = ss.getSheetByName(sheetName);
  if(!sheet){
    throw new Error("MASTER_SHEET_NOT_FOUND|" + sheetName);
  }

  PIM_ensureMasterHeaders_(sheet,type);

  const id = PIM_nextId_(type,sheet);
  sheet.getRange(record.rowNumber,1).setValue(id);
  record.id = id;
  record.ref = id;
  return id;
}


function PIM_appendMasterRecord_(type, canonicalName){
  const ss = PIM_controlWorkbook_({allowActiveFallback:true});
  const sheetName = type === "candidate"
    ? PORTAL_IDENTITY_MAPPING.CANDIDATE_MASTER
    : PORTAL_IDENTITY_MAPPING.CLIENT_MASTER;

  let sheet = ss.getSheetByName(sheetName);
  if(!sheet){
    sheet = ss.insertSheet(sheetName);
  }

  PIM_ensureMasterHeaders_(sheet,type);

  const id = PIM_nextId_(type,sheet);
  const row = sheet.getLastRow() + 1;
  sheet.getRange(row,1,1,2).setValues([[id,canonicalName]]);

  return {
    type:type,
    rowNumber:row,
    id:id,
    name:canonicalName,
    ref:id
  };
}


function PIM_ensureMasterHeaders_(sheet,type){
  const expected = type === "candidate"
    ? ["Candidate ID","Canonical Name"]
    : ["Client ID","Canonical Client Name"];

  if(sheet.getLastRow() === 0 || sheet.getLastColumn() === 0){
    sheet.getRange(1,1,1,2).setValues([expected]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }

  const current = sheet.getRange(1,1,1,Math.max(2,sheet.getLastColumn())).getDisplayValues()[0];
  if(!String(current[0] || "").trim() && !String(current[1] || "").trim()){
    sheet.getRange(1,1,1,2).setValues([expected]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }

  if(PIM_key_(current[0]) !== PIM_key_(expected[0]) || PIM_key_(current[1]) !== PIM_key_(expected[1])){
    throw new Error("MASTER_HEADER_MISMATCH|" + sheet.getName());
  }
}


function PIM_nextId_(type,sheet){
  const prefix = type === "candidate" ? "CAN-" : "CLI-";
  const values = sheet.getLastRow() > 1
    ? sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues()
    : [];

  let max = 0;
  values.forEach(function(row){
    const m = String(row[0] || "").trim().match(/(\d+)$/);
    if(m){
      max = Math.max(max,Number(m[1] || 0));
    }
  });

  return prefix + ("000000" + (max + 1)).slice(-6);
}


function PIM_saveAlias_(type, alias, id, canonicalName, actorEmail){
  const cleanAlias = PIM_cleanDisplay_(alias);
  if(!cleanAlias){
    return;
  }

  if(PIM_key_(cleanAlias) === PIM_key_(canonicalName)){
    return;
  }

  const ss = PIM_controlWorkbook_({allowActiveFallback:true});
  const sheetName = type === "candidate"
    ? PORTAL_IDENTITY_MAPPING.CANDIDATE_MAP
    : PORTAL_IDENTITY_MAPPING.CLIENT_MAP;

  let sheet = ss.getSheetByName(sheetName);
  if(!sheet){
    sheet = ss.insertSheet(sheetName);
  }

  const idHeader = type === "candidate" ? "Candidate ID" : "Client ID";
  const nameHeader = type === "candidate" ? "Canonical Name" : "Canonical Client Name";
  const headers = ["Alias",idHeader,nameHeader,"Active","Added By","Added At"];

  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  const values = sheet.getDataRange().getDisplayValues();
  const map = values[0].map(function(v){ return PIM_key_(v); });
  const aliasCol = map.indexOf("alias");
  const idCol = map.indexOf(PIM_key_(idHeader));
  const nameCol = map.indexOf(PIM_key_(nameHeader));
  const activeCol = map.indexOf("active");
  const addedByCol = map.indexOf("added by");
  const addedAtCol = map.indexOf("added at");

  for(let i=1;i<values.length;i++){
    if(PIM_key_(values[i][aliasCol]) !== PIM_key_(cleanAlias)){
      continue;
    }

    sheet.getRange(i+1,idCol+1).setValue(id);
    sheet.getRange(i+1,nameCol+1).setValue(canonicalName);
    if(activeCol >= 0){ sheet.getRange(i+1,activeCol+1).setValue(true); }
    if(addedByCol >= 0){ sheet.getRange(i+1,addedByCol+1).setValue(actorEmail || ""); }
    if(addedAtCol >= 0){ sheet.getRange(i+1,addedAtCol+1).setValue(new Date()); }
    return;
  }

  sheet.appendRow([cleanAlias,id,canonicalName,true,actorEmail || "",new Date()]);
}


/******************************************************
 * SOURCE CORRECTION
 ******************************************************/
function PIM_applySourceCorrection_(
  call,
  type,
  sourceValue,
  canonicalName,
  canonicalId,
  user,
  sourceSelection
){
  const runtime = PTR_requireSpecificConnectedRuntime_("Identity Mapping");
  const rewriteContext = {
    clientPartCount:
      type === "client"
        ? Number(sourceSelection && sourceSelection.partCount || 0)
        : 0
  };

  const result = {
    teamCode: runtime.code,
    team: runtime.label,
    callTrackerRows: [],
    rawRows: [],
    warnings: [],
    primaryText:""
  };

  const scheduleSheet = PC_scheduleSheet_();
  const sourceRow = Number(call.sourceRow || 0);
  if(sourceRow < 1 || sourceRow > scheduleSheet.getLastRow()){
    throw new Error("CALL_SOURCE_ROW_INVALID");
  }

  // Read B:F once. Column B and E can contain different versions
  // of the interview text, so each is rewritten independently.
  const scheduleValues =
    scheduleSheet.getRange(sourceRow,2,1,5).getDisplayValues()[0];

  const bText = String(scheduleValues[0] || "").trim();
  const eText = String(scheduleValues[3] || "").trim();

  const rewrites = [];
  let compatibleScheduleTexts = 0;

  function planScheduleRewrite(column,oldText,label){
    if(!oldText){ return; }
    if(column === 2 && typeof PC_isDateHeader_ === "function" && PC_isDateHeader_(oldText)){
      return;
    }

    const attempt = PIM_tryRewriteInterviewText_(
      oldText,
      type,
      sourceValue,
      canonicalName,
      rewriteContext
    );

    if(!attempt.ok){
      result.warnings.push(
        label + " skipped: " + attempt.error
      );
      return;
    }

    compatibleScheduleTexts++;
    rewrites.push({
      column:column,
      oldText:oldText,
      newText:attempt.text
    });

    if(column === 5 || !result.primaryText){
      result.primaryText = attempt.text;
    }
  }

  planScheduleRewrite(2,bText,"Interview Bot Column B");
  planScheduleRewrite(5,eText,"Interview Bot Column E");

  if(compatibleScheduleTexts < 1){
    throw new Error(
      type === "client"
        ? "CLIENT_SOURCE_NOT_PRESENT_IN_INTERVIEW_B_OR_E"
        : "CANDIDATE_SOURCE_NOT_PRESENT_IN_INTERVIEW_B_OR_E"
    );
  }

  // -------------------------------------------------
  // PLAN Raw Data writes.
  // Shared Raw Data is mandatory. Team mirror Raw Data
  // is best-effort because mirrors can legitimately lag.
  // -------------------------------------------------
  const rawTargets = [];
  const seen = {};

  function addRawTarget(spreadsheet,sheet,label,required){
    if(!spreadsheet || !sheet){ return; }
    const key = spreadsheet.getId() + "|" + sheet.getSheetId();
    if(seen[key]){
      if(required){
        const existing = rawTargets.find(function(item){ return item.key === key; });
        if(existing){ existing.required = true; }
      }
      return;
    }
    seen[key] = true;
    rawTargets.push({
      key:key,
      spreadsheet:spreadsheet,
      sheet:sheet,
      label:label,
      required:required === true
    });
  }

  let shared;
  try{
    shared = PTR_sharedRawDataSource_();
    addRawTarget(shared.spreadsheet,shared.sheet,"Shared Raw Data",true);
  }catch(error){
    throw new Error(
      "SHARED_RAW_DATA_UNAVAILABLE|" +
      String(error && error.message ? error.message : error)
    );
  }

  try{
    const operations = PTR_operations_();
    const teamRaw = operations.getSheetByName(PTR_rawDataSheetName_());
    addRawTarget(operations,teamRaw,runtime.label + " Raw Data",false);
  }catch(error){
    result.warnings.push(runtime.label + " Raw Data unavailable: " + error.message);
  }

  const originalTexts = [call.originalText,bText,eText].filter(Boolean);
  const rawPlans = [];

  rawTargets.forEach(function(target){
    const rows = PIM_findRawRowsForCall_(
      target.sheet,
      call,
      originalTexts
    );

    if(!rows.length){
      if(target.required){
        throw new Error(
          "SHARED_RAW_MATCH_NOT_FOUND|" +
          String(call.dateKey || "")
        );
      }
      result.warnings.push(
        target.label + ": matching row not found for " + call.dateKey
      );
      return;
    }

    let compatibleRawRows = 0;

    rows.forEach(function(rowNumber){
      const oldText = String(
        target.sheet.getRange(rowNumber,2).getDisplayValue() || ""
      ).trim();
      if(!oldText){ return; }

      const attempt = PIM_tryRewriteInterviewText_(
        oldText,
        type,
        sourceValue,
        canonicalName,
        rewriteContext
      );

      if(!attempt.ok){
        result.warnings.push(
          target.label + " row " + rowNumber +
          " skipped: " + attempt.error
        );
        return;
      }

      compatibleRawRows++;
      rawPlans.push({
        target:target,
        rowNumber:rowNumber,
        oldText:oldText,
        newText:attempt.text
      });

      if(!result.primaryText){
        result.primaryText = attempt.text;
      }
    });

    if(target.required && compatibleRawRows < 1){
      throw new Error(
        "SHARED_RAW_REWRITE_FAILED|" +
        String(call.dateKey || "")
      );
    }
  });

  // -------------------------------------------------
  // APPLY only after all mandatory validation succeeds.
  // -------------------------------------------------
  rewrites.forEach(function(item){
    if(
      item.newText &&
      PIM_normalizeLoose_(item.newText) !==
        PIM_normalizeLoose_(item.oldText)
    ){
      scheduleSheet
        .getRange(sourceRow,item.column)
        .setValue(item.newText);

      result.callTrackerRows.push({
        row:sourceRow,
        column:item.column
      });
    }
  });

  rawPlans.forEach(function(plan){
    if(
      plan.newText &&
      PIM_normalizeLoose_(plan.newText) !==
        PIM_normalizeLoose_(plan.oldText)
    ){
      plan.target.sheet
        .getRange(plan.rowNumber,2)
        .setValue(plan.newText);
    }

    result.rawRows.push({
      label:plan.target.label,
      row:plan.rowNumber
    });
  });

  PIM_appendAudit_({
    team: runtime.label,
    callId: call.callId,
    sourceRow: sourceRow,
    entityType: type,
    originalValue: sourceValue,
    canonicalId: canonicalId,
    canonicalValue: canonicalName,
    action: "Map " + (type === "candidate" ? "Candidate" : "Client"),
    actorEmail: user && user.email || "",
    notes:
      "Compatible Interview Bot B/E cells and canonical shared Raw Data corrected; " +
      "team Raw mirror updated when available." +
      (result.warnings.length ? " Warnings: " + result.warnings.join(" | ") : "")
  });

  return result;
}


function PIM_findRawRowsForCall_(sheet,call,originalTexts){
  if(!sheet || sheet.getLastRow() < 1){
    return [];
  }

  const dateKey = String(call && call.dateKey || "").trim();
  const block = PIM_getRawDateBlock_(sheet,dateKey);

  if(
    !block ||
    Number(block.start || 0) < 1 ||
    Number(block.end || 0) < Number(block.start || 0)
  ){
    return [];
  }

  const startRow = Number(block.start || 0);
  const endRow = Math.min(
    Number(block.end || 0),
    sheet.getLastRow()
  );

  const values = sheet
    .getRange(startRow,2,endRow-startRow+1,1)
    .getDisplayValues();

  const exactKeys = {};
  (originalTexts || []).forEach(function(text){
    const key = PIM_normalizeLoose_(text);
    if(key){ exactKeys[key] = true; }
  });

  const exact = [];
  const fallback = [];

  for(let i=0;i<values.length;i++){
    const displayValue = String(values[i][0] || "").trim();
    if(!displayValue){ continue; }

    const rowNumber = startRow + i;
    const normalized = PIM_normalizeLoose_(displayValue);

    if(exactKeys[normalized]){
      exact.push(rowNumber);
      continue;
    }

    const parsed = PIM_parseInterviewTextForPortal_(displayValue);

    const candidateMatch =
      PIM_key_(parsed.candidateSource || parsed.candidate) ===
      PIM_key_(call.candidateSource || call.candidate);

    const timeMatch =
      !call.time ||
      !parsed.time ||
      PIM_key_(parsed.time) === PIM_key_(call.time);

    const roundMatch =
      !call.round ||
      !parsed.round ||
      PIM_key_(parsed.round) === PIM_key_(call.round);

    if(candidateMatch && timeMatch && roundMatch){
      fallback.push(rowNumber);
    }
  }

  if(exact.length){ return exact; }
  return fallback.length === 1 ? fallback : [];
}

/******************************************************
 * RAW DATE-BLOCK CACHE
 ******************************************************/
function PIM_getRawDateBlock_(sheet,dateKey){
  if(!sheet || !dateKey || sheet.getLastRow() < 1){
    return null;
  }

  const cacheKey = PIM_rawBlockCacheKey_(sheet,dateKey);

  try{
    const cached = PIM_scriptCache_().get(cacheKey);
    if(cached){
      const parsed = JSON.parse(cached);
      if(
        Number(parsed.start || 0) > 0 &&
        Number(parsed.end || 0) >= Number(parsed.start || 0)
      ){
        return parsed;
      }
    }
  }catch(error){}

  const lastRow = sheet.getLastRow();
  const column = sheet
    .getRange(1,2,lastRow,1)
    .getValues();

  let currentDateKey = "";
  let startRow = 0;
  let endRow = 0;

  for(let i=0;i<column.length;i++){
    const rawValue = column[i][0];
    const displayValue =
      rawValue instanceof Date
        ? ""
        : String(rawValue || "").trim();

    const maybeDate =
      PIM_dateKeyFromValue_(rawValue,displayValue);

    if(maybeDate){
      if(currentDateKey === dateKey && startRow > 0){
        endRow = i;
        break;
      }

      currentDateKey = maybeDate;

      if(maybeDate === dateKey){
        startRow = i + 2;
      }

      continue;
    }

    if(currentDateKey === dateKey && startRow > 0){
      endRow = i + 1;
    }
  }

  if(startRow < 1 || endRow < startRow){
    return null;
  }

  const block = {
    start:startRow,
    end:endRow
  };

  try{
    PIM_scriptCache_().put(
      cacheKey,
      JSON.stringify(block),
      PORTAL_IDENTITY_MAPPING.RAW_BLOCK_CACHE_TTL_SECONDS
    );
  }catch(error){}

  return block;
}


function PIM_warmRawBlocksForDates_(dateKeys){
  const keys = (dateKeys || [])
    .map(function(value){ return String(value || "").trim(); })
    .filter(Boolean);

  if(!keys.length){ return; }

  const targets = [];
  const seen = {};

  function add(sheet){
    if(!sheet){ return; }
    const parent = sheet.getParent();
    const key = parent.getId() + "|" + sheet.getSheetId();
    if(seen[key]){ return; }
    seen[key] = true;
    targets.push(sheet);
  }

  try{
    const shared = PTR_sharedRawDataSource_();
    add(shared && shared.sheet);
  }catch(error){}

  try{
    const operations = PTR_operations_();
    add(
      operations.getSheetByName(
        PTR_rawDataSheetName_()
      )
    );
  }catch(error){}

  targets.forEach(function(sheet){
    keys.forEach(function(dateKey){
      PIM_getRawDateBlock_(sheet,dateKey);
    });
  });
}


function PIM_rewriteInterviewText_(
  text,
  type,
  sourceValue,
  canonicalName,
  rewriteContext
){
  const original = String(text || "")
    .replace(/\u00A0/g," ")
    .trim();

  const normalized = PIM_normalizeInterview_(original);
  const activity = PIM_activityMatch_(normalized);

  if(!activity){
    throw new Error("INTERVIEW_ACTIVITY_NOT_FOUND");
  }

  if(type === "candidate"){
    const prefix = normalized.substring(0,activity.index);
    const separatorMatch = prefix.match(/\s*-\s*$/);
    const separator = separatorMatch ? separatorMatch[0] : " - ";

    return (
      canonicalName +
      separator +
      normalized.substring(activity.index)
    );
  }

  const timeInfo = PIM_timeInfo_(normalized);
  const middleInfo =
    PIM_middleInfo_(normalized,activity,timeInfo);

  const clientParts =
    (middleInfo.clientParts || []).slice();

  if(!clientParts.length){
    throw new Error(
      "CLIENT_SOURCE_VALUE_NOT_FOUND_IN_INTERVIEW"
    );
  }

  const sourceKey = PIM_key_(sourceValue);
  const explicitPartCount = Number(
    rewriteContext &&
    rewriteContext.clientPartCount ||
    0
  );

  let sourcePartCount = 0;

  // Prefer the boundary already validated from the original
  // call shown in the modal. This avoids re-interpreting B/E
  // copies whose text layout may be slightly different.
  if(
    explicitPartCount > 0 &&
    explicitPartCount <= clientParts.length
  ){
    sourcePartCount = explicitPartCount;
  }else{
    const prefixes = PIM_prefixCandidates_(clientParts);

    for(let i=0;i<prefixes.length;i++){
      if(PIM_key_(prefixes[i]) === sourceKey){
        sourcePartCount = i + 1;
        break;
      }
    }
  }

  if(sourcePartCount < 1){
    throw new Error(
      "CLIENT_SOURCE_VALUE_NOT_FOUND_IN_INTERVIEW"
    );
  }

  const rebuiltParts = [];

  (middleInfo.leadingParts || [])
    .forEach(function(part){
      const clean = PIM_cleanDisplay_(part);
      if(clean){ rebuiltParts.push(clean); }
    });

  rebuiltParts.push(
    PIM_cleanDisplay_(canonicalName)
  );

  clientParts
    .slice(sourcePartCount)
    .forEach(function(part){
      const clean = PIM_cleanDisplay_(part);
      if(clean){ rebuiltParts.push(clean); }
    });

  const before = normalized
    .substring(
      0,
      activity.index + activity[0].length
    )
    .replace(/\s*-\s*$/g,"")
    .trim();

  const after =
    timeInfo.index >= 0
      ? normalized
          .substring(timeInfo.index)
          .replace(/^\s*-\s*/,"")
          .trim()
      : "";

  let result = before;

  if(rebuiltParts.length){
    result +=
      " - " +
      rebuiltParts.join(" - ");
  }

  if(after){
    result +=
      " - " +
      after;
  }

  return result
    .replace(/\s+/g," ")
    .trim();
}

function PIM_tryRewriteInterviewText_(
  text,
  type,
  sourceValue,
  canonicalName,
  rewriteContext
){
  try{
    return {
      ok:true,
      text:PIM_rewriteInterviewText_(
        text,
        type,
        sourceValue,
        canonicalName,
        rewriteContext
      ),
      error:""
    };
  }catch(error){
    return {
      ok:false,
      text:String(text || ""),
      error:String(
        error && error.message
          ? error.message
          : error
      )
    };
  }
}



/******************************************************
 * READ-ONLY REGRESSION TEST: CLIENT SOURCE REWRITE
 ******************************************************/
function PIM_testClientSourceRewriteReadOnly(){
  const cases = [
    {
      name:"Simple client + role",
      text:"Aslesha yalmanchili – Interview – The HOLT Group - Business Intelligence – 8:30 PM IST – Duration: 30 Mins (2nd Round)",
      source:"The HOLT Group",
      canonical:"The HOLT Group",
      partCount:1,
      expected:"Aslesha yalmanchili - Interview - The HOLT Group - Business Intelligence - 8:30 PM IST - Duration: 30 Mins (2nd Round)"
    },
    {
      name:"Client name contains dash",
      text:"Aslesha yalamanchili – Interview – H - E Parts International - Data and Integration Engineer – 6:30 PM IST – Duration: 30 Mins (1st Round)",
      source:"H - E Parts International",
      canonical:"H - E Parts International",
      partCount:2,
      expected:"Aslesha yalamanchili - Interview - H - E Parts International - Data and Integration Engineer - 6:30 PM IST - Duration: 30 Mins (1st Round)"
    },
    {
      name:"Multiple role parts",
      text:"Deepanshu R (Ireland) – Interview – EBay - Software Engineer - Cloud Infrastructure – 3:30 PM IST – Duration: 20 Mins (1st Round)",
      source:"EBay",
      canonical:"eBay",
      partCount:1,
      expected:"Deepanshu R (Ireland) - Interview - eBay - Software Engineer - Cloud Infrastructure - 3:30 PM IST - Duration: 20 Mins (1st Round)"
    },
    {
      name:"Just born source from live format",
      text:"Candidate Name – Interview – Just born - Convenience Sales Analyst – 8:30 PM IST – Duration: 30 Mins (1st Round)",
      source:"Just born",
      canonical:"Just born",
      partCount:1,
      expected:"Candidate Name - Interview - Just born - Convenience Sales Analyst - 8:30 PM IST - Duration: 30 Mins (1st Round)"
    }
  ];

  const results = cases.map(function(item){
    const rewritten = PIM_rewriteInterviewText_(
      item.text,
      "client",
      item.source,
      item.canonical,
      {clientPartCount:item.partCount}
    );

    return {
      name:item.name,
      ok:
        PIM_normalizeLoose_(rewritten) ===
        PIM_normalizeLoose_(item.expected),
      rewritten:rewritten
    };
  });

  const result = {
    ok:results.every(function(item){ return item.ok; }),
    mode:"READ_ONLY_CLIENT_SOURCE_REWRITE",
    version:PORTAL_IDENTITY_MAPPING.VERSION,
    results:results
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


function PIM_flexibleSourceRegex_(value){
  const source = PIM_cleanDisplay_(value);
  if(!source){ return null; }

  const parts = source
    .replace(/[–—−]/g,"-")
    .split(/\s*-\s*/)
    .map(PIM_cleanDisplay_)
    .filter(Boolean);

  if(!parts.length){ return null; }

  function flexiblePart(part){
    return String(part || "")
      .split(/\s+/)
      .map(function(token){
        return token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      })
      .join("\\s+");
  }

  const pattern = parts.map(flexiblePart).join("\\s*[–—−-]+\\s*");
  return new RegExp(pattern,"i");
}


/******************************************************
 * ACCESS / SOURCE VALIDATION
 ******************************************************/
function PIM_assertIdentityEditable_(call){
  const callId = String(call && call.callId || "").trim();
  if(!callId){ throw new Error("CALL_ID_REQUIRED"); }

  if(
    (typeof PCO_findPendingOutcomeByCallId_ === "function" && PCO_findPendingOutcomeByCallId_(callId)) ||
    (typeof PCO_findPendingReassignmentByCallId_ === "function" && PCO_findPendingReassignmentByCallId_(callId)) ||
    (typeof PCO_findPendingCorrectionByCallId_ === "function" && PCO_findPendingCorrectionByCallId_(callId)) ||
    (typeof PCO_findLatestApprovedOutcomeByCallId_ === "function" && PCO_findLatestApprovedOutcomeByCallId_(callId))
  ){
    throw new Error("IDENTITY_MAPPING_LOCKED_AFTER_OUTCOME");
  }

  try{
    const statusEntry = PC_loadStatusMap_().byId[callId] || null;
    if(statusEntry){
      const status = PC_normalizeStatus_(statusEntry.status);
      if(status && status !== "Scheduled"){
        throw new Error("IDENTITY_MAPPING_LOCKED_AFTER_OUTCOME");
      }
    }
  }catch(error){
    if(String(error && error.message || error) === "IDENTITY_MAPPING_LOCKED_AFTER_OUTCOME"){
      throw error;
    }
  }
}


function PIM_requireCallAccess_(user,call){
  if(PIM_userIsAdmin_(user)){
    return;
  }

  if(
    String(user && user.role || "") === "Handler" &&
    PC_handlerKey_(call && call.handler || "") ===
      PC_handlerKey_(user && user.handler || "")
  ){
    return;
  }

  throw new Error("CALL_ACCESS_DENIED");
}


function PIM_userIsAdmin_(user){
  const accessRole = String(user && user.accessRole || "").trim().toUpperCase();
  return accessRole === "SUPER_ADMIN" ||
    accessRole === "ADMIN" ||
    String(user && user.role || "") === "Admin";
}


function PIM_validateSourceValue_(call,type,sourceValue){
  return PIM_validateSourceSelection_(
    call,
    type,
    sourceValue
  ).value;
}

function PIM_validateSourceSelection_(
  call,
  type,
  sourceValue
){
  const parsed =
    PIM_parseInterviewTextForPortal_(
      call.originalText
    );

  if(type === "candidate"){
    const incoming =
      parsed.candidateSource || "";

    if(!incoming){
      throw new Error(
        "CANDIDATE_SOURCE_NOT_FOUND"
      );
    }

    return {
      value:incoming,
      partCount:0
    };
  }

  const candidates =
    PIM_prefixCandidates_(
      parsed.clientCandidateParts || []
    );

  const requested =
    PIM_cleanDisplay_(sourceValue);

  const requestedKey =
    PIM_key_(requested);

  let matchedIndex = -1;

  for(let i=0;i<candidates.length;i++){
    if(
      PIM_key_(candidates[i]) ===
      requestedKey
    ){
      matchedIndex = i;
      break;
    }
  }

  if(matchedIndex < 0){
    throw new Error(
      "CLIENT_SOURCE_SELECTION_INVALID"
    );
  }

  return {
    value:candidates[matchedIndex],
    partCount:matchedIndex + 1
  };
}



/******************************************************
 * READ-ONLY PERFORMANCE TEST
 ******************************************************/
function PIM_testIdentityPerformanceReadOnly(){
  PIM_clearIdentityCaches_();

  const coldStart = new Date().getTime();
  const cold = PIM_masterIndex_();
  const coldMs = new Date().getTime() - coldStart;

  // Simulate a new Apps Script execution by dropping only the
  // execution-local object. Persistent Script Cache remains.
  PIM_MASTER_CACHE_ = null;
  const warmStart = new Date().getTime();
  const warm = PIM_masterIndex_();
  const warmMs = new Date().getTime() - warmStart;

  const sampleName = cold.candidateRecords.length ? cold.candidateRecords[0].name : "";
  const fuzzyStart = new Date().getTime();
  if(sampleName){ PIM_candidateSuggestions_(sampleName,cold); }
  const fuzzyMs = new Date().getTime() - fuzzyStart;

  const result = {
    ok:true,
    mode:"READ_ONLY_IDENTITY_PERFORMANCE",
    version:PORTAL_IDENTITY_MAPPING.VERSION,
    candidateCount:warm.candidateRecords.length,
    clientCount:warm.clientRecords.length,
    coldMasterLoadMs:coldMs,
    warmPersistentCacheLoadMs:warmMs,
    sampleFuzzySuggestionMs:fuzzyMs
  };
  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/******************************************************
 * PARSER HELPERS
 ******************************************************/
function PIM_normalizeInterview_(text){
  return String(text || "")
    .replace(/\u00A0/g," ")
    .replace(/[–—−]/g," - ")
    .replace(/-{2,}/g," - ")
    .replace(/\s*-\s*/g," - ")
    .replace(/\s+/g," ")
    .trim();
}


function PIM_activityMatch_(text){
  const regex = /\b(?:final\s+interview|phone\s+interview|coding\s+interview|technical\s+interview|video\s+interview|panel\s+interview|hiring\s+manager\s+interview|manager\s+interview|assessment\s+interview|interview|phone\s+call|recruiter\s+call|phone\s+screen|prep\s+call)\b/i;
  return regex.exec(String(text || ""));
}


function PIM_isDescriptor_(part){
  const value = PIM_key_(part);
  if(!value){ return true; }
  return /^(?:interview|final interview|phone interview|coding interview|technical interview|technical coding interview|video interview|panel interview|hiring manager interview|manager interview|assessment interview|assessment through interview|loop interview|behavioral interview|phone call|recruiter call|phone screen|prep call|discussion|discussion round|technical discussion|final discussion|final technical discussion|technical round|screening round)$/.test(value);
}


function PIM_middleInfo_(normalized,activity,timeInfo){
  if(!activity){
    return {leadingParts:[],clientParts:[]};
  }

  const start = activity.index + activity[0].length;
  const end = timeInfo && timeInfo.index >= 0 ? timeInfo.index : normalized.length;
  let middle = normalized.substring(start,end)
    .replace(/^\s*-\s*/,"")
    .replace(/\s*-\s*$/,"")
    .trim();

  const allParts = middle
    ? middle.split(/\s+-\s+/).map(PIM_cleanDisplay_).filter(Boolean)
    : [];

  const leadingParts = [];
  const clientParts = allParts.slice();

  while(clientParts.length && PIM_isDescriptor_(clientParts[0])){
    leadingParts.push(clientParts.shift());
  }

  // Remove explicit round/duration leftovers accidentally placed before time.
  while(clientParts.length){
    const last = clientParts[clientParts.length - 1];
    if(/^(?:\d+\s*(?:st|nd|rd|th)\s*round|round\s*\d+|duration\b.*)$/i.test(last)){
      clientParts.pop();
    }else{
      break;
    }
  }

  return {leadingParts:leadingParts,clientParts:clientParts};
}


function PIM_roundInfo_(text){
  const value = String(text || "");
  const patterns = [
    /\b(\d{1,2})\s*(?:st|nd|rd|th)\s*(?:round|rnd)\b/i,
    /\bround\s*[-:#]?\s*(\d{1,2})\b/i,
    /\br\s*[-:#]?\s*(\d{1,2})\b/i
  ];

  for(let i=0;i<patterns.length;i++){
    const m = patterns[i].exec(value);
    if(m){
      const n = Number(m[1] || 0);
      if(n > 0){
        return {round:PIM_roundLabel_(n),roundNo:n};
      }
    }
  }

  if(/\bfinal\s+round\b/i.test(value)){
    return {round:"Final",roundNo:999};
  }

  return {round:"",roundNo:0};
}


function PIM_roundLabel_(n){
  n = Number(n || 0);
  if(n <= 0){ return ""; }
  const mod100 = n % 100;
  let suffix = "th";
  if(mod100 < 11 || mod100 > 13){
    if(n % 10 === 1){ suffix = "st"; }
    else if(n % 10 === 2){ suffix = "nd"; }
    else if(n % 10 === 3){ suffix = "rd"; }
  }
  return n + suffix + " Round";
}


function PIM_timeInfo_(text){
  const value = String(text || "");
  const regex = /\b(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*([ap])\.?\s*m\.?\b/i;
  const match = regex.exec(value);
  if(!match){
    return {time:"",index:-1,length:0};
  }

  const hour = Number(match[1] || 0);
  const minute = ("0" + Number(match[2] || 0)).slice(-2);
  const meridiem = String(match[3] || "").toUpperCase() + "M";
  return {
    time: hour + ":" + minute + " " + meridiem,
    index: match.index,
    length: match[0].length
  };
}


function PIM_durationText_(text){
  const value = String(text || "");
  let m = value.match(/\b(\d+)\s*(?:hours?|hrs?|hr)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|min)\b/i);
  if(m){
    return Number(m[1]) + " Hour" + (Number(m[1]) === 1 ? "" : "s") + " " + Number(m[2]) + " Mins";
  }

  m = value.match(/\bduration\b\s*[:=\-]*\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|min|hours?|hrs?|hr)\b/i) ||
      value.match(/\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|min|hours?|hrs?|hr)\b/i);

  if(!m){
    return "";
  }

  const number = Number(m[1]);
  const unit = String(m[2] || "").toLowerCase();
  return unit.indexOf("h") === 0
    ? number + (number === 1 ? " Hour" : " Hours")
    : number + " Mins";
}


function PIM_prefixCandidates_(parts){
  const out = [];
  for(let i=1;i<=(parts || []).length;i++){
    out.push(parts.slice(0,i).join(" - "));
  }
  return out;
}


/******************************************************
 * AUDIT
 ******************************************************/
function PIM_appendAudit_(entry){
  const ss = PIM_controlWorkbook_({allowActiveFallback:true});
  let sheet = ss.getSheetByName(PORTAL_IDENTITY_MAPPING.AUDIT);
  if(!sheet){
    sheet = ss.insertSheet(PORTAL_IDENTITY_MAPPING.AUDIT);
  }

  const headers = [
    "Timestamp","Team","Call ID","Source Row","Entity Type",
    "Original Value","Canonical ID","Canonical Value","Action",
    "Actor Email","Notes"
  ];

  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    new Date(),
    entry.team || "",
    entry.callId || "",
    Number(entry.sourceRow || 0),
    entry.entityType || "",
    entry.originalValue || "",
    entry.canonicalId || "",
    entry.canonicalValue || "",
    entry.action || "",
    entry.actorEmail || "",
    entry.notes || ""
  ]);
}


/******************************************************
 * GENERIC HELPERS
 ******************************************************/
function PIM_entityType_(value){
  const key = String(value || "").trim().toLowerCase();
  return key === "candidate" || key === "client" ? key : "";
}


function PIM_cleanDisplay_(value){
  return String(value || "")
    .replace(/\u00A0/g," ")
    .replace(/\s+/g," ")
    .trim();
}


function PIM_key_(value){
  let text = String(value || "")
    .replace(/\u00A0/g," ")
    .toLowerCase();

  try{
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  }catch(error){}

  return text
    .replace(/[–—−]/g,"-")
    .replace(/&/g," and ")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}


function PIM_normalizeLoose_(value){
  return String(value || "")
    .replace(/\u00A0/g," ")
    .replace(/[–—−]/g,"-")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase();
}


function PIM_tokens_(value){
  const key = PIM_key_(value);
  return key ? key.split(" ") : [];
}


function PIM_dateKeyFromValue_(value,display){
  if(value instanceof Date && !isNaN(value.getTime())){
    return Utilities.formatDate(value,PORTAL_CALL_OPS.TIME_ZONE,"yyyy-MM-dd");
  }

  const text = String(display || value || "").trim();
  let m = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if(m){
    return m[3] + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
  }
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m){
    return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  }
  return "";
}
