/***************************************************************
 * TEAMRUNTIME.GS - HYDERABAD OPERATIONS RUNTIME v3.0
 * Team: Hyderabad Team (TEAM-HYD)
 * Bound workbook: HYD Incentive Tracker
 *
 * Runtime source of truth for handler names:
 *   central V2 Handler Master -> TEAM-HYD -> Active = TRUE
 *
 * User-confirmed Hyderabad handlers used for bootstrap/validation:
 *   Stephen, Karthikeya, Uday, Anji, Akhil, Vamshidhar
 *
 * IMPORTANT:
 * - Normal assignment reads the central Handler Master dynamically.
 * - The local list is only a safe bootstrap/compatibility fallback.
 * - No other-team handler names are used here.
 ***************************************************************/

const TEAM_RUNTIME_CONFIG = Object.freeze({
  TEAM_ID: "TEAM-HYD",
  TEAM_NAME: "Hyderabad Team",
  MAIN_SHEET: "HYD Interview Bot 2026",
  RAW_SHEET: "HYD Raw Data",
  TEAM_DATA_SHEET: "HYD Team Data",
  BUSY_SHEET: "BusySlots",
  CENTRAL_HANDLER_MASTER_SHEET: "V2 Handler Master",
  CENTRAL_ADMIN_ID_PROPERTY: "CENTRAL_ADMIN_SPREADSHEET_ID",
  BOUND_ID_PROPERTY: "TEAM_OPERATIONS_SPREADSHEET_ID",
  SPECIAL_HANDLER_PROPERTY: "TEAM_SPECIAL_HANDLER",
  ROSTER_CACHE_PROPERTY: "TEAM_HANDLER_ROSTER_JSON",
  ROSTER_CACHE_AT_PROPERTY: "TEAM_HANDLER_ROSTER_REFRESHED_AT",
  HANDLER_ALIASES_PROPERTY: "TEAM_HANDLER_ALIASES_JSON",
  ROSTER_TTL_MS: 5 * 60 * 1000
});


function TR_expectedHydHandlers_(){
  if(
    typeof HYD_DEFAULT_HANDLERS !== "undefined" &&
    Array.isArray(HYD_DEFAULT_HANDLERS)
  ){
    return HYD_DEFAULT_HANDLERS.slice();
  }

  return [
    "Stephen",
    "Karthikeya",
    "Uday",
    "Anji",
    "Akhil",
    "Vamshidhar Reddy"
  ];
}


function setupHydOperationsProject(centralAdminSpreadsheetId, specialHandlerName){
  return TR_setupTeamOperations_(centralAdminSpreadsheetId, specialHandlerName);
}


function TR_setupTeamOperations_(centralAdminSpreadsheetId, specialHandlerName){
  const active = SpreadsheetApp.getActive();
  if(!active){
    throw new Error("RUN_SETUP_FROM_HYD_INCENTIVE_TRACKER_BOUND_EDITOR");
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty(
    TEAM_RUNTIME_CONFIG.BOUND_ID_PROPERTY,
    active.getId()
  );

  const suppliedCentralId = String(centralAdminSpreadsheetId || "").trim();
  if(suppliedCentralId){
    props.setProperty(
      TEAM_RUNTIME_CONFIG.CENTRAL_ADMIN_ID_PROPERTY,
      suppliedCentralId
    );
  }

  if(specialHandlerName !== undefined && specialHandlerName !== null){
    props.setProperty(
      TEAM_RUNTIME_CONFIG.SPECIAL_HANDLER_PROPERTY,
      String(specialHandlerName || "").trim()
    );
  }

  const required = [
    TEAM_RUNTIME_CONFIG.MAIN_SHEET,
    TEAM_RUNTIME_CONFIG.RAW_SHEET,
    TEAM_RUNTIME_CONFIG.TEAM_DATA_SHEET
  ];

  const missingSheets = required.filter(function(name){
    return !active.getSheetByName(name);
  });

  if(missingSheets.length){
    throw new Error(
      "MISSING_REQUIRED_HYD_SHEETS: " + missingSheets.join(", ")
    );
  }

  if(!active.getSheetByName(TEAM_RUNTIME_CONFIG.BUSY_SHEET)){
    const busy = active.insertSheet(TEAM_RUNTIME_CONFIG.BUSY_SHEET);
    busy.getRange(1,1,1,3).setValues([
      ["Handler","Start Time","Duration"]
    ]);
    busy.setFrozenRows(1);
  }

  const centralId = TR_centralAdminSpreadsheetId_();
  let roster;
  let rosterSource = "CENTRAL_HANDLER_MASTER";
  let rosterWarning = "";

  if(centralId){
    try{
      roster = TR_refreshRosterNow();
    }catch(error){
      rosterWarning = String(error && error.message || error);
    }
  }else{
    rosterWarning = "CENTRAL_ADMIN_SPREADSHEET_ID_NOT_CONFIGURED";
  }

  if(!roster){
    rosterSource = "HYD_BOOTSTRAP_FALLBACK";
    roster = TR_bootstrapRoster_();
    TR_saveRosterCache_(roster);
  }

  const validation = TR_validateExpectedRoster_(roster.allHandlers || []);

  return {
    ok:true,
    teamId:TEAM_RUNTIME_CONFIG.TEAM_ID,
    teamName:TEAM_RUNTIME_CONFIG.TEAM_NAME,
    workbookId:active.getId(),
    mainSheet:TEAM_RUNTIME_CONFIG.MAIN_SHEET,
    rawSheet:TEAM_RUNTIME_CONFIG.RAW_SHEET,
    teamDataSheet:TEAM_RUNTIME_CONFIG.TEAM_DATA_SHEET,
    handlers:roster.mainHandlers || [],
    specialHandler:roster.specialHandler || "",
    rosterSource:rosterSource,
    rosterWarning:rosterWarning,
    expectedHandlers:TR_expectedHydHandlers_(),
    missingExpectedHandlers:validation.missing,
    unexpectedActiveHandlers:validation.extra
  };
}


function TR_boundSpreadsheetId_(){
  const props = PropertiesService.getScriptProperties();
  const saved = String(
    props.getProperty(TEAM_RUNTIME_CONFIG.BOUND_ID_PROPERTY) || ""
  ).trim();

  if(saved) return saved;

  const active = SpreadsheetApp.getActive();
  if(active) return active.getId();

  throw new Error("TEAM_OPERATIONS_SPREADSHEET_ID_NOT_CONFIGURED");
}


function TR_centralAdminSpreadsheetId_(){
  return String(
    PropertiesService
      .getScriptProperties()
      .getProperty(TEAM_RUNTIME_CONFIG.CENTRAL_ADMIN_ID_PROPERTY) || ""
  ).trim();
}


function TR_setCentralAdminSpreadsheetId(id){
  const value = String(id || "").trim();
  if(!value){
    throw new Error("CENTRAL_ADMIN_SPREADSHEET_ID_REQUIRED");
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      TEAM_RUNTIME_CONFIG.CENTRAL_ADMIN_ID_PROPERTY,
      value
    );

  return TR_refreshRosterNow();
}


function TR_bootstrapRoster_(){
  const names = TR_expectedHydHandlers_();

  return {
    teamId:TEAM_RUNTIME_CONFIG.TEAM_ID,
    teamName:TEAM_RUNTIME_CONFIG.TEAM_NAME,
    mainHandlers:names.slice(),
    specialHandler:"",
    allHandlers:names.slice(),
    source:"HYD_BOOTSTRAP_FALLBACK",
    refreshedAt:new Date().toISOString()
  };
}


function TR_saveRosterCache_(roster){
  const props = PropertiesService.getScriptProperties();
  props.setProperty(
    TEAM_RUNTIME_CONFIG.ROSTER_CACHE_PROPERTY,
    JSON.stringify(roster || {})
  );
  props.setProperty(
    TEAM_RUNTIME_CONFIG.ROSTER_CACHE_AT_PROPERTY,
    String(Date.now())
  );
}


function TR_refreshRosterNow(){
  const roster = TR_fetchRosterFromCentral_();
  TR_saveRosterCache_(roster);
  return roster;
}


function TR_getRosterSnapshot_(){
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(TEAM_RUNTIME_CONFIG.ROSTER_CACHE_PROPERTY);
  const at = Number(
    props.getProperty(TEAM_RUNTIME_CONFIG.ROSTER_CACHE_AT_PROPERTY) || 0
  );

  if(raw && at && (Date.now() - at) < TEAM_RUNTIME_CONFIG.ROSTER_TTL_MS){
    try{
      const parsed = JSON.parse(raw);
      if(parsed && Array.isArray(parsed.mainHandlers)){
        return parsed;
      }
    }catch(error){}
  }

  try{
    return TR_refreshRosterNow();
  }catch(error){
    Logger.log(
      "Central Hyderabad roster refresh failed; using cached/bootstrap roster: " +
      String(error && error.message || error)
    );

    if(raw){
      try{
        const cached = JSON.parse(raw);
        if(cached && Array.isArray(cached.mainHandlers)){
          return cached;
        }
      }catch(ignore){}
    }

    return TR_bootstrapRoster_();
  }
}


function TR_getRosterSnapshotSafe_(){
  try{
    return TR_getRosterSnapshot_();
  }catch(error){
    Logger.log("Hyderabad roster bootstrap fallback: " + error.message);
    return TR_bootstrapRoster_();
  }
}


function TR_headerIndex_(headerMap, aliases){
  for(let i=0;i<aliases.length;i++){
    const key = String(aliases[i] || "").toLowerCase();
    if(headerMap[key] !== undefined){
      return headerMap[key];
    }
  }
  return -1;
}


function TR_fetchRosterFromCentral_(){
  const id = TR_centralAdminSpreadsheetId_();
  if(!id){
    throw new Error("CENTRAL_ADMIN_SPREADSHEET_ID_NOT_CONFIGURED");
  }

  const ss = SpreadsheetApp.openById(id);
  const sheet = ss.getSheetByName(
    TEAM_RUNTIME_CONFIG.CENTRAL_HANDLER_MASTER_SHEET
  );

  if(!sheet){
    throw new Error("V2_HANDLER_MASTER_NOT_FOUND");
  }

  const values = sheet.getDataRange().getDisplayValues();
  if(!values.length){
    throw new Error("V2_HANDLER_MASTER_EMPTY");
  }

  const hm = {};
  values[0].forEach(function(value,index){
    hm[String(value || "").trim().toLowerCase()] = index;
  });

  const nameCol = TR_headerIndex_(hm,[
    "handler name",
    "name",
    "handler"
  ]);

  const teamCol = TR_headerIndex_(hm,[
    "team id",
    "teamid",
    "team"
  ]);

  const activeCol = TR_headerIndex_(hm,[
    "active",
    "status",
    "enabled"
  ]);

  if(nameCol < 0){
    throw new Error("V2_HANDLER_MASTER_MISSING_HANDLER_NAME_COLUMN");
  }
  if(teamCol < 0){
    throw new Error("V2_HANDLER_MASTER_MISSING_TEAM_ID_COLUMN");
  }
  if(activeCol < 0){
    throw new Error("V2_HANDLER_MASTER_MISSING_ACTIVE_COLUMN");
  }

  const activeNames = [];

  for(let i=1;i<values.length;i++){
    const row = values[i];
    const name = String(row[nameCol] || "").trim();
    const teamId = String(row[teamCol] || "").trim();
    const activeText = String(row[activeCol] || "")
      .trim()
      .toLowerCase();

    const active = [
      "true","yes","y","1","active","enabled"
    ].indexOf(activeText) !== -1;

    if(
      name &&
      teamId.toUpperCase() === TEAM_RUNTIME_CONFIG.TEAM_ID &&
      active
    ){
      activeNames.push(name);
    }
  }

  const unique = [];
  const seen = {};

  activeNames.forEach(function(name){
    const key = name.toLowerCase();
    if(!seen[key]){
      seen[key] = true;
      unique.push(name);
    }
  });

  if(!unique.length){
    throw new Error(
      "NO_ACTIVE_HANDLERS_FOR_TEAM: " + TEAM_RUNTIME_CONFIG.TEAM_ID
    );
  }

  const requestedSpecial = String(
    PropertiesService
      .getScriptProperties()
      .getProperty(TEAM_RUNTIME_CONFIG.SPECIAL_HANDLER_PROPERTY) || ""
  ).trim();

  let specialHandler = "";

  if(requestedSpecial){
    specialHandler = unique.find(function(name){
      return name.toLowerCase() === requestedSpecial.toLowerCase();
    }) || "";
  }

  const mainHandlers = unique.filter(function(name){
    return !specialHandler ||
      name.toLowerCase() !== specialHandler.toLowerCase();
  });

  return {
    teamId:TEAM_RUNTIME_CONFIG.TEAM_ID,
    teamName:TEAM_RUNTIME_CONFIG.TEAM_NAME,
    mainHandlers:mainHandlers,
    specialHandler:specialHandler,
    allHandlers:unique,
    source:"CENTRAL_HANDLER_MASTER",
    refreshedAt:new Date().toISOString()
  };
}


function TR_validateExpectedRoster_(actualNames){
  const expected = TR_expectedHydHandlers_();
  const actual = Array.isArray(actualNames) ? actualNames : [];

  const expectedMap = {};
  expected.forEach(function(name){
    expectedMap[String(name).toLowerCase()] = name;
  });

  const actualMap = {};
  actual.forEach(function(name){
    actualMap[String(name).toLowerCase()] = name;
  });

  return {
    missing:expected.filter(function(name){
      return !actualMap[String(name).toLowerCase()];
    }),
    extra:actual.filter(function(name){
      return !expectedMap[String(name).toLowerCase()];
    })
  };
}


function validateHydHandlerRoster(){
  const roster = TR_refreshRosterNow();
  const validation = TR_validateExpectedRoster_(roster.allHandlers || []);

  const result = {
    ok:validation.missing.length === 0,
    teamId:TEAM_RUNTIME_CONFIG.TEAM_ID,
    expected:TR_expectedHydHandlers_(),
    active:roster.allHandlers || [],
    missing:validation.missing,
    extra:validation.extra
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/***************************************************************
 * DYNAMIC HANDLER / FIXED-HANDLER MATCHING
 ***************************************************************/

function TR_handlerAliases_(){
  const aliases = {};

  try{
    const raw = PropertiesService
      .getScriptProperties()
      .getProperty(TEAM_RUNTIME_CONFIG.HANDLER_ALIASES_PROPERTY);

    if(!raw) return aliases;

    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object") return aliases;

    Object.keys(parsed).forEach(function(handler){
      const list = Array.isArray(parsed[handler])
        ? parsed[handler]
        : [parsed[handler]];

      aliases[String(handler || "").trim().toLowerCase()] =
        list
          .map(function(value){
            return String(value || "").trim();
          })
          .filter(Boolean);
    });
  }catch(error){
    Logger.log(
      "TEAM_HANDLER_ALIASES_JSON ignored: " +
      String(error && error.message || error)
    );
  }

  return aliases;
}


function TR_normalizeHandlerText_(value){
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}


function TR_handlerKeywordEntries_(){
  const roster = TR_getRosterSnapshotSafe_();
  const handlers = Array.isArray(roster.allHandlers)
    ? roster.allHandlers.slice()
    : [];

  const firstNameCount = {};

  handlers.forEach(function(handler){
    const normalized = TR_normalizeHandlerText_(handler);
    const first = normalized.split(" ")[0] || "";
    if(first){
      firstNameCount[first] = Number(firstNameCount[first] || 0) + 1;
    }
  });

  const aliases = TR_handlerAliases_();

  return handlers.map(function(handler){
    const canonical = String(handler || "").trim();
    const normalized = TR_normalizeHandlerText_(canonical);
    const first = normalized.split(" ")[0] || "";
    const keywords = [];

    if(normalized) keywords.push(normalized);

    if(first && firstNameCount[first] === 1){
      keywords.push(first);
    }

    (aliases[canonical.toLowerCase()] || []).forEach(function(alias){
      const key = TR_normalizeHandlerText_(alias);
      if(key) keywords.push(key);
    });

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
      handler:canonical,
      keywords:unique
    };
  });
}


function TR_findFixedHandlerInText_(text){
  const source = " " + TR_normalizeHandlerText_(text) + " ";
  if(source === "  ") return null;

  const entries = TR_handlerKeywordEntries_();

  for(let i=0;i<entries.length;i++){
    const entry = entries[i];

    for(let j=0;j<entry.keywords.length;j++){
      const keyword = " " + entry.keywords[j] + " ";
      if(source.indexOf(keyword) !== -1){
        return entry.handler;
      }
    }
  }

  return null;
}


/***************************************************************
 * LEGACY-COMPATIBLE GLOBAL ROSTER
 ***************************************************************/

const TR_BOOTSTRAP_ROSTER_ = TR_getRosterSnapshotSafe_();
const MAIN_HANDLERS = TR_BOOTSTRAP_ROSTER_.mainHandlers.slice();
const SPECIAL_HANDLER = String(TR_BOOTSTRAP_ROSTER_.specialHandler || "");
const SUPPORT_HANDLER = "Support";


function getSchedulerAssignableHandlers_(){
  const roster = TR_getRosterSnapshotSafe_();
  const out = Array.isArray(roster.mainHandlers)
    ? roster.mainHandlers.slice()
    : MAIN_HANDLERS.slice();

  const special = String(roster.specialHandler || SPECIAL_HANDLER || "");
  if(special && out.indexOf(special) === -1){
    out.push(special);
  }

  return out;
}


function getSchedulerDisplayHandlers_(){
  const out = getSchedulerAssignableHandlers_();
  if(out.indexOf(SUPPORT_HANDLER) === -1){
    out.push(SUPPORT_HANDLER);
  }
  return out;
}


function testTeamRosterReadOnly(){
  const result = TR_refreshRosterNow();
  Logger.log(JSON.stringify(result,null,2));
  return result;
}


function testHydFixedHandlerDetection(){
  const names = TR_expectedHydHandlers_();
  const results = names.map(function(name){
    return {
      input:"Strictly " + name,
      detected:TR_findFixedHandlerInText_("Strictly " + name)
    };
  });

  const pass = results.every(function(item,index){
    return item.detected === names[index];
  });

  const output = {
    ok:pass,
    teamId:TEAM_RUNTIME_CONFIG.TEAM_ID,
    results:results
  };

  Logger.log(JSON.stringify(output,null,2));
  return output;
}
