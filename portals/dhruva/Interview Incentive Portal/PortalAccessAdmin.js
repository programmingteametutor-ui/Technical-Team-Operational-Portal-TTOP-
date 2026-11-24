/******************************************************
 * PORTALACCESSADMIN.GS
 * Interview Operations Portal V2
 * Super Admin access/resource administration
 *
 * INSTALL IN:
 *   Interview Portal Control -> Apps Script
 *
 * VERSION:
 *   V2-PORTAL-ACCESS-ADMIN-1.3.0
 *
 * PURPOSE
 * -------
 * - Manage V2 User Access roles/scopes from the portal.
 * - Manage Handler / Setup Support / combined Technical Support
 *   master identities used by Test As and future scheduling.
 * - Bootstrap existing handler identities without guessing teams.
 *
 * SAFETY
 * ------
 * - REAL SUPER_ADMIN only.
 * - Test View is not permitted for writes.
 * - No Raw Data, Team Data, Call Tracker, incentive, recovery,
 *   scheduler, Phase 2/3/4, or bridge writes.
 * - No delete operations. Use Active=false instead.
 ******************************************************/

const PORTAL_ACCESS_ADMIN = Object.freeze({
  VERSION: "V2-PORTAL-ACCESS-ADMIN-1.3.1",

  MASTER_DEFS: Object.freeze({
    HANDLER: Object.freeze({
      sheet: "V2 Handler Master",
      idHeader: "Handler ID",
      nameHeader: "Handler Name",
      prefix: "HAN",
      headers: Object.freeze([
        "Handler ID",
        "Handler Name",
        "Team ID",
        "Active",
        "Night Eligible",
        "Shift Start",
        "Shift End",
        "Notes",
        "Email",
        "Aliases"
      ])
    }),

    SETUP_SUPPORT: Object.freeze({
      sheet: "V2 Setup Support Master",
      idHeader: "Support ID",
      nameHeader: "Support Name",
      prefix: "SUP",
      headers: Object.freeze([
        "Support ID",
        "Support Name",
        "Team Scope",
        "Active",
        "Night Eligible",
        "Notes",
        "Email"
      ])
    }),

    TECH_SUPPORT: Object.freeze({
      sheet: "V2 Technical Support Master",
      idHeader: "Technical Support ID",
      nameHeader: "Technical Support Name",
      prefix: "TS",
      headers: Object.freeze([
        "Technical Support ID",
        "Technical Support Name",
        "Home Team ID",
        "Developer Capability",
        "Screen Operator Capability",
        "Active",
        "Notes",
        "Email",
        "Legacy Developer ID",
        "Legacy Operator ID"
      ])
    })
  })
});


/******************************************************
 * MANUAL READ-ONLY — HANDLER MASTER HEALTH
 * Run from Apps Script editor after deploying this update.
 ******************************************************/
function PAA_testHandlerMasterHealthReadOnly(){

  const ss = PAC_backend_();
  const sheet = ss.getSheetByName("V2 Handler Master");
  if(!sheet){
    throw new Error("V2_HANDLER_MASTER_NOT_FOUND");
  }

  const values = sheet.getDataRange().getValues();
  const display = sheet.getDataRange().getDisplayValues();
  const hm = PAA_headerMap_(display[0] || []);

  let handlers = 0;
  let shiftDateObjects = 0;
  let invalidDisplayedTimes = 0;
  let emailsInMaster = 0;

  for(let i=1;i<values.length;i++){
    if(PAC_text_(display[i][hm["handler id"]])) handlers++;

    ["shift start","shift end"].forEach(function(key){
      if(hm[key] === undefined) return;
      if(values[i][hm[key]] instanceof Date){
        shiftDateObjects++;
      }
      const shown = PAC_text_(display[i][hm[key]]);
      if(shown && !PAA_normalizeTime_(shown)){
        invalidDisplayedTimes++;
      }
    });

    if(hm["email"] !== undefined && PAC_email_(display[i][hm["email"]])){
      emailsInMaster++;
    }
  }

  const result = {
    ok: true,
    mode: "READ_ONLY_HEALTH",
    version: PORTAL_ACCESS_ADMIN.VERSION,
    handlers: handlers,
    emailColumnReady: hm["email"] !== undefined,
    emailsInMaster: emailsInMaster,
    shiftDateObjectCellsRemaining: shiftDateObjects,
    invalidDisplayedTimes: invalidDisplayedTimes,
    note: "Date-object cells are converted to clean time-only text when Save All Handler Changes is used."
  };

  Logger.log("========== HANDLER MASTER HEALTH ==========");
  Logger.log(JSON.stringify(result,null,2));
  Logger.log("===========================================");
  return result;
}



/******************************************************
 * MANUAL READ-ONLY — TECHNICAL SUPPORT HEALTH
 ******************************************************/
function PAA_testTechnicalSupportHealthReadOnly(){

  const ss = PAC_backend_();
  const sheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.TECH_SUPPORT_MASTER
    );

  if(!sheet){
    throw new Error(
      "V2_TECHNICAL_SUPPORT_MASTER_NOT_FOUND"
    );
  }

  const rows =
    sheet.getLastRow() >= 2
      ? PAC_readSheetObjects_(sheet)
      : [];

  let developerCapable = 0;
  let screenCapable = 0;
  let bothCapable = 0;
  let noCapability = 0;
  let active = 0;

  const ids = {};
  const emails = {};
  let duplicateIds = 0;
  let duplicateEmails = 0;

  rows.forEach(function(row){

    const id =
      PAC_text_(
        row["Technical Support ID"]
      );

    const email =
      PAC_email_(
        row["Email"]
      );

    const dev =
      PAC_active_(
        row["Developer Capability"]
      );

    const screen =
      PAC_active_(
        row["Screen Operator Capability"]
      );

    if(PAC_active_(row["Active"])){
      active++;
    }

    if(dev) developerCapable++;
    if(screen) screenCapable++;
    if(dev && screen) bothCapable++;
    if(!dev && !screen) noCapability++;

    if(id){
      if(ids[id]) duplicateIds++;
      ids[id] = true;
    }

    if(email){
      if(emails[email]) duplicateEmails++;
      emails[email] = true;
    }
  });

  const result = {
    ok:
      duplicateIds === 0 &&
      duplicateEmails === 0 &&
      noCapability === 0,
    mode: "READ_ONLY_HEALTH",
    version: PORTAL_ACCESS_ADMIN.VERSION,
    rows: rows.length,
    active: active,
    developerCapable: developerCapable,
    screenOperatorCapable: screenCapable,
    bothCapable: bothCapable,
    noCapability: noCapability,
    duplicateIdCount: duplicateIds,
    duplicateEmailCount: duplicateEmails
  };

  Logger.log(
    "========== TECHNICAL SUPPORT HEALTH =========="
  );
  Logger.log(
    JSON.stringify(result,null,2)
  );
  Logger.log(
    "=============================================="
  );

  return result;
}


/******************************************************
 * PUBLIC — ADMINISTRATION PAGE DATA
 ******************************************************/
function getPortalAdministrationData(token){

  const context =
    PAA_requireWritableSuperAdmin_(token,false);

  PAC_ensureUserAccessSchema_();
  PAC_ensureUserRolesSchema_();
  PAC_ensureTechnicalSupportMaster_();

  Object.keys(PORTAL_ACCESS_ADMIN.MASTER_DEFS)
    .forEach(function(key){
      PAA_ensureMasterSheet_(
        PORTAL_ACCESS_ADMIN.MASTER_DEFS[key]
      );
    });

  const users = PAA_userRows_();
  const handlers = PAA_masterRows_("HANDLER");
  const supports = PAA_masterRows_("SETUP_SUPPORT");
  const technicalSupports =
    PAA_masterRows_("TECH_SUPPORT");
  const teams = PAC_teamOptions_();

  const activeUsers =
    users.filter(function(x){
      return x.active;
    });

  function roleCount(role){
    return activeUsers.filter(function(user){
      return (
        Array.isArray(user.roles) &&
        user.roles.indexOf(role) !== -1
      );
    }).length;
  }

  return {
    ok: true,
    version: PORTAL_ACCESS_ADMIN.VERSION,
    actor: PAC_publicIdentity_(context.actor),
    summary: {
      users: users.length,
      superAdmins: roleCount("SUPER_ADMIN"),
      admins: roleCount("ADMIN"),
      handlerUsers: roleCount("HANDLER"),
      supportsUsers: roleCount("SETUP_SUPPORT"),
      technicalSupportUsers: roleCount("TECH_SUPPORT"),
      handlers: handlers.length,
      supports: supports.length,
      technicalSupports: technicalSupports.length,
      teams: teams.length,
      handlersWithoutTeam: handlers.filter(function(x){
        return x.active && !x.teamId;
      }).length
    },
    teams: teams,
    users: users,
    handlers: handlers,
    supports: supports,
    technicalSupports: technicalSupports
  };
}


/******************************************************
 * PUBLIC — BOOTSTRAP EXISTING HANDLERS
 *
 * Source priority:
 * 1) Active HANDLER rows in V2 User Access.
 * 2) Legacy Portal Users handler name for that email, when needed.
 *
 * Team is intentionally NOT inferred.
 ******************************************************/
function bootstrapPortalHandlerMaster(token){

  const context =
    PAA_requireWritableSuperAdmin_(token,true);

  const userSheet = PAC_ensureUserAccessSchema_();
  const handlerSheet =
    PAA_ensureMasterSheet_(
      PORTAL_ACCESS_ADMIN.MASTER_DEFS.HANDLER
    );

  const userValues = userSheet.getDataRange().getValues();
  if(userValues.length < 2){
    return {
      ok: true,
      version: PORTAL_ACCESS_ADMIN.VERSION,
      added: 0,
      linkedUsers: 0,
      alreadyPresent: 0,
      unresolved: 0,
      message: "No V2 users are available to bootstrap."
    };
  }

  const uh = PAA_headerMap_(userValues[0]);
  const required = [
    "email","official name","role","handler id","primary team id","active"
  ];
  required.forEach(function(name){
    if(uh[name] === undefined){
      throw new Error(
        "ACCESS_USER_COLUMN_MISSING|column=" + name
      );
    }
  });

  const existing = PAA_masterRows_("HANDLER");
  const byId = {};
  const byName = {};
  existing.forEach(function(item){
    byId[PAA_key_(item.id)] = item;
    byName[PAA_key_(item.name)] = item;
  });

  let next = PAA_nextMasterNumber_(handlerSheet,"Handler ID","HAN");
  let added = 0;
  let linkedUsers = 0;
  let alreadyPresent = 0;
  let unresolved = 0;

  for(let i=1;i<userValues.length;i++){

    const role = PAC_role_(userValues[i][uh["role"]]);
    const active = PAC_active_(userValues[i][uh["active"]]);

    if(role !== "HANDLER" || !active){
      continue;
    }

    const email = PAC_email_(userValues[i][uh["email"]]);
    let name = PAC_text_(userValues[i][uh["official name"]]);
    const currentId = PAC_text_(userValues[i][uh["handler id"]]);

    if(!name && email){
      const legacy = PAC_readLegacyPortalUser_(email);
      if(legacy && legacy.role === "Handler"){
        name = PAC_text_(legacy.handler);
      }
    }

    if(!name){
      unresolved++;
      continue;
    }

    let master = currentId
      ? byId[PAA_key_(currentId)] || null
      : null;

    if(!master){
      master = byName[PAA_key_(name)] || null;
    }

    if(master){
      alreadyPresent++;
    }else{
      const id = PAA_formatMasterId_("HAN",next++);
      handlerSheet.appendRow([
        id,
        name,
        "",
        true,
        "",
        "",
        "",
        "Bootstrapped from V2 User Access; assign Team ID in Administration",
        email
      ]);
      master = {
        id: id,
        name: name,
        teamId: "",
        active: true
      };
      byId[PAA_key_(id)] = master;
      byName[PAA_key_(name)] = master;
      added++;
    }

    if(currentId !== master.id){
      userSheet
        .getRange(i+1,uh["handler id"]+1)
        .setValue(master.id);
      linkedUsers++;
    }

    const currentTeam =
      PAC_text_(userValues[i][uh["primary team id"]]);

    if(!currentTeam && master.teamId){
      userSheet
        .getRange(i+1,uh["primary team id"]+1)
        .setValue(master.teamId);
    }
  }

  PAA_syncHandlerMasterEmailsFromUserAccess_();

  SpreadsheetApp.flush();

  PAA_audit_(context,{ 
    action: "Bootstrap Handler Master",
    targetType: "Access Master",
    targetId: "V2 Handler Master",
    details:
      "added=" + added +
      " | linkedUsers=" + linkedUsers +
      " | alreadyPresent=" + alreadyPresent +
      " | unresolved=" + unresolved
  });

  return {
    ok: true,
    version: PORTAL_ACCESS_ADMIN.VERSION,
    added: added,
    linkedUsers: linkedUsers,
    alreadyPresent: alreadyPresent,
    unresolved: unresolved,
    data: getPortalAdministrationData(token)
  };
}


/******************************************************
 * PUBLIC — SAVE / CREATE V2 PORTAL USER
 ******************************************************/
function savePortalAccessUser(token,payload){

  const context =
    PAA_requireWritableSuperAdmin_(token,true);

  const input = payload || {};
  const userSheet =
    PAC_ensureUserAccessSchema_();
  const roleSheet =
    PAC_ensureUserRolesSchema_();

  const values =
    userSheet.getDataRange().getValues();

  const headers =
    values.length
      ? values[0].map(PAC_text_)
      : PORTAL_ACCESS_V2.USER_ACCESS_BASE_HEADERS
          .concat(
            PORTAL_ACCESS_V2.USER_ACCESS_EXTRA_HEADERS
          );

  const hm =
    PAA_headerMap_(headers);

  const email =
    PAC_email_(input.email);

  if(!PAA_validEmail_(email)){
    throw new Error("VALID_EMAIL_REQUIRED");
  }

  const officialName =
    PAC_text_(input.officialName) ||
    PAC_emailLocal_(email);

  const active =
    PAA_bool_(input.active,true);

  let roles =
    Array.isArray(input.roles)
      ? input.roles
      : (
          input.role
            ? [input.role]
            : []
        );

  roles =
    roles
      .map(PAC_role_)
      .filter(function(role,index,all){
        return (
          PORTAL_ACCESS_V2.ROLES.indexOf(role) !== -1 &&
          all.indexOf(role) === index
        );
      });

  if(!roles.length){
    throw new Error("AT_LEAST_ONE_ROLE_REQUIRED");
  }

  let defaultRole =
    PAC_role_(
      input.defaultRole ||
      input.role
    );

  if(
    !defaultRole ||
    roles.indexOf(defaultRole) === -1
  ){
    defaultRole =
      PAC_defaultRoleFromList_(roles);
  }

  const actorEmail =
    PAC_email_(context.actor.email);

  if(
    actorEmail === email &&
    (
      roles.indexOf("SUPER_ADMIN") === -1 ||
      !active
    )
  ){
    throw new Error(
      "CANNOT_REMOVE_SUPER_ADMIN_FROM_CURRENT_ACCOUNT"
    );
  }

  let rowNumber = 0;
  let existing = null;

  for(let i=1;i<values.length;i++){
    if(
      PAC_email_(
        values[i][hm["email"]]
      ) === email
    ){
      rowNumber = i+1;
      existing = values[i].slice();
      break;
    }
  }

  let userId =
    existing
      ? PAC_text_(
          existing[hm["user id"]]
        )
      : PAC_text_(input.userId);

  if(!userId){
    userId =
      "USR-" +
      PAC_shortHash_(email);
  }

  const configs =
    input.roleConfig &&
    typeof input.roleConfig === "object"
      ? input.roleConfig
      : {};

  const oldHandlerId =
    existing
      ? PAC_text_(
          existing[hm["handler id"]]
        )
      : "";
  const oldSupportId =
    existing
      ? PAC_text_(
          existing[hm["support id"]]
        )
      : "";
  const oldDeveloperId =
    existing &&
    hm["developer id"] !== undefined
      ? PAC_text_(
          existing[hm["developer id"]]
        )
      : "";
  const oldOperatorId =
    existing &&
    hm["operator id"] !== undefined
      ? PAC_text_(
          existing[hm["operator id"]]
        )
      : "";
  const oldTechnicalSupportId =
    existing &&
    hm["technical support id"] !== undefined
      ? PAC_text_(
          existing[hm["technical support id"]]
        )
      : "";

  const resourceLinks = {
    HANDLER: oldHandlerId,
    SETUP_SUPPORT: oldSupportId,
    TECH_SUPPORT: oldTechnicalSupportId
  };

  const roleScopes = {};

  // Validate every requested scope before creating/updating any resource
  // master row, so an invalid later role cannot leave a partial write.
  roles.forEach(function(role){

    if(role === "SUPER_ADMIN"){
      return;
    }

    const cfg = configs[role] || {};

    if(role === "ADMIN"){
      const team = PAC_findTeamById_(
        cfg.teamId ||
        cfg.targetId ||
        input.primaryTeamId ||
        input.targetId
      );
      if(!team){
        throw new Error("ADMIN_TEAM_REQUIRED");
      }
      return;
    }

    const team = PAC_findTeamById_(
      cfg.teamId ||
      cfg.targetId ||
      input.primaryTeamId
    );

    if(!team){
      throw new Error(role + "_TEAM_REQUIRED");
    }

    if(
      role === "SETUP_SUPPORT" &&
      PAA_isSelfSupportTeam_(team)
    ){
      throw new Error(
        "SETUP_SUPPORT_NOT_REQUIRED_FOR_SELF_SUPPORT_TEAM"
      );
    }
  });

  roles.forEach(function(role){

    if(role === "SUPER_ADMIN"){
      roleScopes[role] = {
        teamId: "",
        resourceId: ""
      };
      return;
    }

    const cfg =
      configs[role] || {};

    if(role === "ADMIN"){
      const team =
        PAC_findTeamById_(
          cfg.teamId ||
          cfg.targetId ||
          input.primaryTeamId ||
          input.targetId
        );

      if(!team){
        throw new Error("ADMIN_TEAM_REQUIRED");
      }

      roleScopes[role] = {
        teamId: team.id,
        resourceId: ""
      };
      return;
    }

    const team =
      PAC_findTeamById_(
        cfg.teamId ||
        cfg.targetId ||
        input.primaryTeamId
      );

    if(!team){
      throw new Error(
        role + "_TEAM_REQUIRED"
      );
    }

    if(
      role === "SETUP_SUPPORT" &&
      PAA_isSelfSupportTeam_(team)
    ){
      throw new Error(
        "SETUP_SUPPORT_NOT_REQUIRED_FOR_SELF_SUPPORT_TEAM"
      );
    }

    const resourceId =
      PAA_ensureResourceForPortalUser_({
        role: role,
        userId: userId,
        email: email,
        officialName: officialName,
        teamId: team.id,
        currentResourceId:
          resourceLinks[role] || "",
        active: active,
        notes:
          PAC_text_(input.notes),
        developerCapable:
          role === "TECH_SUPPORT"
            ? PAA_bool_(
                cfg.developerCapable,
                false
              )
            : false,
        screenOperatorCapable:
          role === "TECH_SUPPORT"
            ? PAA_bool_(
                cfg.screenOperatorCapable,
                false
              )
            : false
      });

    resourceLinks[role] =
      resourceId;

    roleScopes[role] = {
      teamId: team.id,
      resourceId: resourceId
    };
  });

  // Removing a role does not delete its resource identity.
  // It is simply made inactive and the stable ID remains linked.
  [
    "HANDLER",
    "SETUP_SUPPORT",
    "TECH_SUPPORT"
  ].forEach(function(role){
    if(
      roles.indexOf(role) === -1 &&
      resourceLinks[role]
    ){
      PAA_setResourceActive_(
        role,
        resourceLinks[role],
        false
      );
    }
  });

  // Legacy/default compatibility columns continue to exist.
  // They store all linked resource IDs plus the selected default role.
  let primaryTeamId = "";

  if(
    roleScopes[defaultRole] &&
    roleScopes[defaultRole].teamId
  ){
    primaryTeamId =
      roleScopes[defaultRole].teamId;
  }else{
    const firstScoped =
      roles
        .map(function(role){
          return roleScopes[role] || null;
        })
        .find(function(scope){
          return scope && scope.teamId;
        });
    primaryTeamId =
      firstScoped
        ? firstScoped.teamId
        : "";
  }

  const record = {
    "User ID": userId,
    "Email": email,
    "Official Name": officialName,
    "Role": defaultRole,
    "Primary Team ID": primaryTeamId,
    "Handler ID": resourceLinks.HANDLER || "",
    "Support ID": resourceLinks.SETUP_SUPPORT || "",
    "Active": active,
    "Notes": PAC_text_(input.notes),

    // Preserve legacy IDs for historical references only.
    "Developer ID": oldDeveloperId,
    "Operator ID": oldOperatorId,

    // New combined technical sector identity.
    "Technical Support ID":
      resourceLinks.TECH_SUPPORT || ""
  };

  const outputRow =
    headers.map(function(header){
      return record[header] !== undefined
        ? record[header]
        : "";
    });

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    if(rowNumber){
      userSheet
        .getRange(
          rowNumber,
          1,
          1,
          headers.length
        )
        .setValues([outputRow]);
    }else{
      userSheet
        .getRange(
          userSheet.getLastRow()+1,
          1,
          1,
          headers.length
        )
        .setValues([outputRow]);
    }

    PAA_syncUserRoleAssignments_(
      roleSheet,
      userId,
      email,
      roles,
      roleScopes
    );

  }finally{
    lock.releaseLock();
  }

  SpreadsheetApp.flush();

  PAA_audit_(context,{
    action:
      rowNumber
        ? "Update Portal User Multi Role Access"
        : "Create Portal User Multi Role Access",
    targetType: "Portal User",
    targetId: userId,
    details:
      email +
      " | roles=" +
      roles.join(",") +
      " | default=" +
      defaultRole +
      " | active=" +
      active
  });

  return {
    ok: true,
    version: PORTAL_ACCESS_ADMIN.VERSION,
    userId: userId,
    roles: roles,
    defaultRole: defaultRole,
    data: getPortalAdministrationData(token)
  };
}


/******************************************************
 * PUBLIC — SAVE RESOURCE MASTERS
 ******************************************************/
function savePortalHandlerMaster(token,payload){
  const result = savePortalHandlerMasterBatch(token,[payload || {}]);
  return {
    ok: result.ok,
    version: result.version,
    id: result.ids && result.ids.length ? result.ids[0] : "",
    data: result.data
  };
}


/******************************************************
 * PUBLIC — SAVE ALL HANDLER MASTER ROWS
 *
 * - Existing + manually entered handlers can be saved in one action.
 * - Email is optional. When supplied, V2 User Access is created/linked
 *   as HANDLER using the same stable Handler ID.
 * - Shift values are stored as clean time-only text (e.g. 11:00 AM).
 * - If Shift End <= Shift Start, the shift ends on the next calendar day.
 * - Night Eligible is intentionally preserved internally for old imported
 *   rows but is no longer exposed in the Handler Master UI.
 ******************************************************/
function savePortalHandlerMasterBatch(token,payloads){

  const context =
    PAA_requireWritableSuperAdmin_(token,true);

  const items = Array.isArray(payloads)
    ? payloads
    : [];

  if(!items.length){
    throw new Error("NO_HANDLER_ROWS_TO_SAVE");
  }

  if(items.length > 150){
    throw new Error("TOO_MANY_HANDLER_ROWS");
  }

  const def = PORTAL_ACCESS_ADMIN.MASTER_DEFS.HANDLER;
  const sheet = PAA_ensureMasterSheet_(def);
  const userSheet = PAC_ensureUserAccessSchema_();

  const masterValues = sheet.getDataRange().getValues();
  const mh = PAA_headerMap_(masterValues[0] || def.headers);
  const displayValues = sheet.getDataRange().getDisplayValues();

  const existingById = {};
  const existingNameOwner = {};
  const existingEmailOwner = {};

  for(let i=1;i<masterValues.length;i++){
    const id = PAC_text_(masterValues[i][mh["handler id"]]);
    const name = PAC_text_(masterValues[i][mh["handler name"]]);
    const email = mh["email"] === undefined
      ? ""
      : PAC_email_(masterValues[i][mh["email"]]);

    if(id){
      existingById[id] = {
        rowNumber: i+1,
        id: id,
        name: name,
        email: email,
        nightEligible: mh["night eligible"] === undefined
          ? ""
          : masterValues[i][mh["night eligible"]],
        aliases: mh["aliases"] === undefined
          ? ""
          : PAA_normalizeHandlerAliases_(
              masterValues[i][mh["aliases"]]
            )
      };
    }
    if(name){
      existingNameOwner[PAA_key_(name)] = id;
    }
    if(email){
      existingEmailOwner[email] = id;
    }
  }

  // User Access lookup used both for validation and email linking.
  const userValues = userSheet.getDataRange().getValues();
  const uh = PAA_headerMap_(userValues[0] || []);
  const usersByEmail = {};
  for(let i=1;i<userValues.length;i++){
    const email = PAC_email_(userValues[i][uh["email"]]);
    if(email){
      usersByEmail[email] = {
        rowNumber: i+1,
        row: userValues[i]
      };
    }
  }

  let nextId = PAA_nextMasterNumber_(sheet,"Handler ID","HAN");
  const prepared = [];
  const batchNames = {};
  const batchEmails = {};

  items.forEach(function(raw,index){

    const input = raw || {};
    const id = PAC_text_(input.id);
    const name = PAC_text_(input.name);
    const email = PAC_email_(input.email);
    const teamId = PAC_text_(input.teamId);
    const shiftStart = PAA_normalizeTime_(input.shiftStart);
    const shiftEnd = PAA_normalizeTime_(input.shiftEnd);
    const notes = PAC_text_(input.notes);
    const active = PAA_bool_(input.active,true);
    const suppliedAliases = input.aliases !== undefined;
    const inputAliases = suppliedAliases
      ? PAA_normalizeHandlerAliases_(input.aliases)
      : "";

    // Completely blank manual draft rows are ignored.
    if(!id && !name && !email && !teamId && !shiftStart && !shiftEnd && !notes){
      return;
    }

    if(!name){
      throw new Error("HANDLER_NAME_REQUIRED|row=" + (index+1));
    }

    if(email && !PAA_validEmail_(email)){
      throw new Error("VALID_HANDLER_EMAIL_REQUIRED|row=" + (index+1));
    }

    if(teamId && !PAC_findTeamById_(teamId)){
      throw new Error("INVALID_HANDLER_TEAM|row=" + (index+1));
    }

    if(PAC_text_(input.shiftStart) && !shiftStart){
      throw new Error("INVALID_SHIFT_START|row=" + (index+1));
    }
    if(PAC_text_(input.shiftEnd) && !shiftEnd){
      throw new Error("INVALID_SHIFT_END|row=" + (index+1));
    }

    let existing = null;
    let finalId = id;
    if(id){
      existing = existingById[id] || null;
      if(!existing){
        throw new Error("HANDLER_ID_NOT_FOUND|id=" + id);
      }
    }else{
      finalId = PAA_formatMasterId_("HAN",nextId++);
    }

    const nameKey = PAA_key_(name);
    if(batchNames[nameKey] && batchNames[nameKey] !== finalId){
      throw new Error("DUPLICATE_HANDLER_NAME|name=" + name);
    }
    batchNames[nameKey] = finalId;

    const oldNameOwner = existingNameOwner[nameKey];
    if(oldNameOwner && oldNameOwner !== finalId){
      throw new Error("DUPLICATE_HANDLER_NAME|name=" + name);
    }

    if(email){
      if(batchEmails[email] && batchEmails[email] !== finalId){
        throw new Error("DUPLICATE_HANDLER_EMAIL|email=" + email);
      }
      batchEmails[email] = finalId;

      const oldEmailOwner = existingEmailOwner[email];
      if(oldEmailOwner && oldEmailOwner !== finalId){
        throw new Error("DUPLICATE_HANDLER_EMAIL|email=" + email);
      }

      const access = usersByEmail[email];
      if(access){
        const role = PAC_role_(access.row[uh["role"]]);
        const linkedHandlerId = PAC_text_(access.row[uh["handler id"]]);
        if(role && role !== "HANDLER"){
          throw new Error("HANDLER_EMAIL_USED_BY_OTHER_ROLE|email=" + email);
        }
        if(linkedHandlerId && linkedHandlerId !== finalId){
          throw new Error("HANDLER_EMAIL_ALREADY_LINKED|email=" + email);
        }
      }
    }

    if(existing && existing.email && email && existing.email !== email){
      throw new Error(
        "HANDLER_EMAIL_CHANGE_USE_USERS_ROLES|handler=" + finalId
      );
    }

    prepared.push({
      rowNumber: existing ? existing.rowNumber : 0,
      id: finalId,
      name: name,
      email: email || (existing ? existing.email : ""),
      teamId: teamId,
      active: active,
      nightEligible: existing ? existing.nightEligible : "",
      shiftStart: shiftStart,
      shiftEnd: shiftEnd,
      notes: notes,
      aliases: suppliedAliases
        ? inputAliases
        : (existing ? (existing.aliases || "") : "")
    });
  });

  if(!prepared.length){
    throw new Error("NO_HANDLER_ROWS_TO_SAVE");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try{
    prepared.forEach(function(item){
      const record = {
        "Handler ID": item.id,
        "Handler Name": item.name,
        "Team ID": item.teamId,
        "Active": item.active,
        "Night Eligible": item.nightEligible,
        "Shift Start": item.shiftStart,
        "Shift End": item.shiftEnd,
        "Notes": item.notes,
        "Email": item.email,
        "Aliases": item.aliases
      };

      const outputRow = def.headers.map(function(header){
        return record[header] !== undefined ? record[header] : "";
      });

      const targetRow = item.rowNumber || (sheet.getLastRow()+1);

      // Force shift columns to plain text so Google Sheets cannot
      // serialize them as 30-Dec-1899 Date objects.
      if(mh["shift start"] !== undefined){
        sheet.getRange(targetRow,mh["shift start"]+1).setNumberFormat("@");
      }
      if(mh["shift end"] !== undefined){
        sheet.getRange(targetRow,mh["shift end"]+1).setNumberFormat("@");
      }

      sheet
        .getRange(targetRow,1,1,def.headers.length)
        .setValues([outputRow]);

      PAA_upsertHandlerPortalUser_(
        userSheet,
        uh,
        usersByEmail,
        item
      );

      // Also keep any already-linked V2 Handler user synchronized even
      // when the Handler Master email column was previously blank.
      PAA_syncHandlerTeamToUsers_(item.id,item.teamId,item.active);
    });
  }finally{
    lock.releaseLock();
  }

  SpreadsheetApp.flush();

  PAA_audit_(context,{
    action: "Save All Handler Master",
    targetType: "Access Master",
    targetId: "V2 Handler Master",
    details: "rowsSaved=" + prepared.length
  });

  return {
    ok: true,
    version: PORTAL_ACCESS_ADMIN.VERSION,
    saved: prepared.length,
    ids: prepared.map(function(x){ return x.id; }),
    data: getPortalAdministrationData(token)
  };
}

function savePortalSetupSupportMaster(token,payload){
  return PAA_saveMaster_(token,"SETUP_SUPPORT",payload);
}

function savePortalDeveloperMaster(token,payload){
  throw new Error(
    "LEGACY_DEVELOPER_MASTER_RETIRED|use=Technical Support"
  );
}

function savePortalScreenOperatorMaster(token,payload){
  throw new Error(
    "LEGACY_SCREEN_OPERATOR_MASTER_RETIRED|use=Technical Support"
  );
}

function savePortalTechnicalSupportMaster(token,payload){
  return PAA_saveMaster_(
    token,
    "TECH_SUPPORT",
    payload
  );
}



/******************************************************
 * PRIVATE — SAVE GENERIC MASTER
 ******************************************************/
function PAA_saveMaster_(token,type,payload){

  const context =
    PAA_requireWritableSuperAdmin_(token,true);

  const def = PORTAL_ACCESS_ADMIN.MASTER_DEFS[type];
  if(!def){
    throw new Error("INVALID_MASTER_TYPE");
  }

  const input = payload || {};
  const sheet = PAA_ensureMasterSheet_(def);
  const values = sheet.getDataRange().getValues();
  const hm = PAA_headerMap_(values[0] || def.headers);

  const id = PAC_text_(input.id);
  const name = PAC_text_(input.name);
  if(!name){
    throw new Error("RESOURCE_NAME_REQUIRED");
  }

  let rowNumber = 0;
  let existingId = "";
  let existingRow = null;

  for(let i=1;i<values.length;i++){
    const rowId = PAC_text_(values[i][hm[PAA_key_(def.idHeader)]]);
    const rowName = PAC_text_(values[i][hm[PAA_key_(def.nameHeader)]]);

    if(id && rowId === id){
      rowNumber = i+1;
      existingId = rowId;
      existingRow = values[i];
      continue;
    }

    if(
      PAA_key_(rowName) === PAA_key_(name) &&
      (!id || rowId !== id)
    ){
      throw new Error("DUPLICATE_RESOURCE_NAME");
    }
  }

  if(id && !rowNumber){
    throw new Error("RESOURCE_ID_NOT_FOUND");
  }

  const finalId = existingId ||
    PAA_formatMasterId_(
      def.prefix,
      PAA_nextMasterNumber_(sheet,def.idHeader,def.prefix)
    );

  const record = {};
  if(existingRow){
    def.headers.forEach(function(header){
      const col = hm[PAA_key_(header)];
      record[header] =
        col === undefined
          ? ""
          : existingRow[col];
    });
  }

  record[def.idHeader] = finalId;
  record[def.nameHeader] = name;

  if(type === "HANDLER"){
    const teamId = PAC_text_(input.teamId);
    if(teamId && !PAC_findTeamById_(teamId)){
      throw new Error("INVALID_HANDLER_TEAM");
    }
    record["Team ID"] = teamId;
    record["Active"] = PAA_bool_(input.active,true);
    if(input.nightEligible !== undefined){
      record["Night Eligible"] = PAA_optionalBoolValue_(input.nightEligible);
    }
    record["Shift Start"] = PAA_normalizeTime_(input.shiftStart);
    record["Shift End"] = PAA_normalizeTime_(input.shiftEnd);
    record["Notes"] = PAC_text_(input.notes);
  }

  if(type === "SETUP_SUPPORT"){
    if(input.teamScope !== undefined){
      record["Team Scope"] = PAC_text_(input.teamScope);
    }
    record["Active"] = PAA_bool_(input.active,true);
    if(input.nightEligible !== undefined){
      record["Night Eligible"] = PAA_optionalBoolValue_(input.nightEligible);
    }
    record["Notes"] = PAC_text_(input.notes);
  }

  if(type === "TECH_SUPPORT"){
    const teamId =
      PAC_text_(
        input.teamId ||
        input.homeTeamId
      );

    if(teamId && !PAC_findTeamById_(teamId)){
      throw new Error("INVALID_TECH_SUPPORT_TEAM");
    }

    const developerCapable =
      PAA_bool_(
        input.developerCapable,
        PAC_active_(record["Developer Capability"])
      );

    const screenOperatorCapable =
      PAA_bool_(
        input.screenOperatorCapable,
        PAC_active_(record["Screen Operator Capability"])
      );

    if(
      !developerCapable &&
      !screenOperatorCapable
    ){
      throw new Error("TECH_SUPPORT_CAPABILITY_REQUIRED");
    }

    record["Home Team ID"] = teamId;
    record["Developer Capability"] =
      developerCapable;
    record["Screen Operator Capability"] =
      screenOperatorCapable;
    record["Active"] = PAA_bool_(input.active,true);
    record["Notes"] = PAC_text_(input.notes);
  }

  const outputRow = def.headers.map(function(header){
    return record[header] !== undefined
      ? record[header]
      : "";
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    if(rowNumber){
      sheet
        .getRange(rowNumber,1,1,def.headers.length)
        .setValues([outputRow]);
    }else{
      sheet
        .getRange(sheet.getLastRow()+1,1,1,def.headers.length)
        .setValues([outputRow]);
    }
  }finally{
    lock.releaseLock();
  }

  if(type === "HANDLER"){
    PAA_syncHandlerTeamToUsers_(
      finalId,
      PAC_text_(record["Team ID"]),
      PAA_bool_(record["Active"],true)
    );
  }

  if(type === "TECH_SUPPORT"){
    PAA_syncTechnicalSupportToUsers_(
      finalId,
      PAC_text_(record["Home Team ID"]),
      PAA_bool_(record["Active"],true)
    );
  }

  SpreadsheetApp.flush();

  PAA_audit_(context,{
    action: rowNumber ? "Update " + type + " Master" : "Create " + type + " Master",
    targetType: "Resource Master",
    targetId: finalId,
    details: name
  });

  return {
    ok: true,
    version: PORTAL_ACCESS_ADMIN.VERSION,
    id: finalId,
    data: getPortalAdministrationData(token)
  };
}


/******************************************************
 * PRIVATE — USER SCOPE VALIDATION
 ******************************************************/
function PAA_resolveUserScope_(role,input){

  const result = {
    primaryTeamId: "",
    handlerId: "",
    supportId: "",
    technicalSupportId: "",
    developerId: "",
    operatorId: "",
    targetId: ""
  };

  if(role === "SUPER_ADMIN"){
    result.targetId = "GLOBAL";
    return result;
  }

  if(role === "ADMIN"){
    const team = PAC_findTeamById_(input.targetId || input.primaryTeamId);
    if(!team){
      throw new Error("ADMIN_TEAM_REQUIRED");
    }
    result.primaryTeamId = team.id;
    result.targetId = team.id;
    return result;
  }

  if(role === "HANDLER"){
    const handler = PAC_findHandlerById_(input.targetId || input.handlerId);
    if(!handler){
      throw new Error("HANDLER_ID_REQUIRED");
    }
    result.handlerId = handler.id;
    result.primaryTeamId = handler.teamId || "";
    result.targetId = handler.id;
    return result;
  }

  if(role === "SETUP_SUPPORT"){
    const support = PAC_findSupportById_(input.targetId || input.supportId);
    if(!support){
      throw new Error("SUPPORT_ID_REQUIRED");
    }
    result.supportId = support.id;
    result.primaryTeamId =
      support.teamId || support.teamScope || "";
    result.targetId = support.id;
    return result;
  }

  if(role === "TECH_SUPPORT"){
    const tech =
      PAC_findTechnicalSupportById_(
        input.targetId ||
        input.technicalSupportId
      );
    if(!tech){
      throw new Error("TECH_SUPPORT_ID_REQUIRED");
    }
    result.technicalSupportId = tech.id;
    result.primaryTeamId = tech.teamId || "";
    result.targetId = tech.id;
    return result;
  }

  throw new Error("UNSUPPORTED_ROLE");
}


/******************************************************
 * PRIVATE — DATA READERS
 ******************************************************/
function PAA_userRows_(){

  const sheet =
    PAC_ensureUserAccessSchema_();

  if(sheet.getLastRow() < 2){
    return [];
  }

  return PAC_readSheetObjects_(sheet)
    .map(function(row){

      const userId =
        PAC_text_(row["User ID"]);
      const email =
        PAC_email_(row["Email"]);

      const assignments =
        PAC_roleAssignmentsForUser_(
          userId,
          email,
          row
        );

      const roles =
        assignments
          .filter(function(item){
            return item.active === true;
          })
          .map(function(item){
            return item.role;
          })
          .filter(function(role,index,all){
            return (
              role &&
              all.indexOf(role) === index
            );
          });

      const defaultRole =
        PAC_defaultRoleFromRow_(
          row,
          roles
        );

      const roleConfig = {};

      assignments.forEach(function(item){
        if(!item.role) return;

        const cfg = {
          teamId: item.teamId || "",
          teamName:
            PAC_teamName_(
              item.teamId || ""
            ),
          resourceId:
            item.resourceId || ""
        };

        if(item.role === "TECH_SUPPORT"){
          const tech =
            item.resourceId
              ? PAC_findTechnicalSupportById_(
                  item.resourceId
                )
              : null;
          cfg.developerCapable =
            tech
              ? tech.developerCapable === true
              : false;
          cfg.screenOperatorCapable =
            tech
              ? tech.screenOperatorCapable === true
              : false;
        }

        roleConfig[item.role] = cfg;
      });

      const handlerId =
        PAC_text_(row["Handler ID"]);
      const supportId =
        PAC_text_(row["Support ID"]);
      const technicalSupportId =
        PAC_text_(
          row["Technical Support ID"]
        );

      if(
        roles.indexOf("HANDLER") !== -1 &&
        !roleConfig.HANDLER
      ){
        const item =
          handlerId
            ? PAC_findHandlerById_(handlerId)
            : null;
        roleConfig.HANDLER = {
          teamId:
            item ? item.teamId : "",
          teamName:
            item
              ? PAC_teamName_(item.teamId)
              : "",
          resourceId: handlerId
        };
      }

      if(
        roles.indexOf("SETUP_SUPPORT") !== -1 &&
        !roleConfig.SETUP_SUPPORT
      ){
        const item =
          supportId
            ? PAC_findSupportById_(supportId)
            : null;
        const teamId =
          item
            ? PAC_text_(
                item.teamId ||
                item.teamScope
              )
            : "";
        roleConfig.SETUP_SUPPORT = {
          teamId: teamId,
          teamName:
            PAC_teamName_(teamId),
          resourceId: supportId
        };
      }

      if(
        roles.indexOf("TECH_SUPPORT") !== -1 &&
        !roleConfig.TECH_SUPPORT
      ){
        const item =
          technicalSupportId
            ? PAC_findTechnicalSupportById_(
                technicalSupportId
              )
            : null;

        roleConfig.TECH_SUPPORT = {
          teamId:
            item ? item.teamId : "",
          teamName:
            item ? item.teamName : "",
          resourceId:
            technicalSupportId,
          developerCapable:
            item
              ? item.developerCapable === true
              : false,
          screenOperatorCapable:
            item
              ? item.screenOperatorCapable === true
              : false
        };
      }

      return {
        userId: userId,
        email: email,
        officialName:
          PAC_text_(
            row["Official Name"]
          ),
        role: defaultRole,
        defaultRole: defaultRole,
        roles: roles,
        roleConfig: roleConfig,
        primaryTeamId:
          PAC_text_(
            row["Primary Team ID"]
          ),
        handlerId: handlerId,
        supportId: supportId,
        technicalSupportId:
          technicalSupportId,

        // Historical compatibility IDs only.
        developerId:
          PAC_text_(row["Developer ID"]),
        operatorId:
          PAC_text_(row["Operator ID"]),

        active:
          PAC_active_(
            row["Active"]
          ),
        notes:
          PAC_text_(
            row["Notes"]
          )
      };
    })
    .sort(function(a,b){

      const aSuper =
        a.roles.indexOf(
          "SUPER_ADMIN"
        ) !== -1;

      const bSuper =
        b.roles.indexOf(
          "SUPER_ADMIN"
        ) !== -1;

      if(aSuper !== bSuper){
        return aSuper ? -1 : 1;
      }

      return String(
        a.officialName ||
        a.email
      ).localeCompare(
        String(
          b.officialName ||
          b.email
        )
      );
    });
}


function PAA_masterRows_(type){

  const def =
    PORTAL_ACCESS_ADMIN.MASTER_DEFS[type];

  if(!def) return [];

  const sheet =
    PAA_ensureMasterSheet_(def);

  if(sheet.getLastRow() < 2){
    return [];
  }

  const handlerEmails =
    type === "HANDLER"
      ? PAA_handlerEmailMap_()
      : {};

  return PAA_readSheetDisplayObjects_(sheet)
    .filter(function(row){
      return (
        PAC_text_(row[def.idHeader]) &&
        PAC_text_(row[def.nameHeader])
      );
    })
    .map(function(row){

      const base = {
        id:
          PAC_text_(
            row[def.idHeader]
          ),
        name:
          PAC_text_(
            row[def.nameHeader]
          ),
        active:
          PAC_active_(
            row["Active"]
          ),
        notes:
          PAC_text_(
            row["Notes"]
          ),
        email:
          PAC_email_(
            row["Email"]
          )
      };

      if(type === "HANDLER"){
        base.teamId =
          PAC_text_(
            row["Team ID"]
          );
        base.teamName =
          PAC_teamName_(
            base.teamId
          );
        base.aliases =
          PAA_normalizeHandlerAliases_(
            row["Aliases"]
          );
        base.nightEligible =
          PAA_optionalBool_(
            row["Night Eligible"]
          );
        base.shiftStart =
          PAA_normalizeTime_(
            row["Shift Start"]
          );
        base.shiftEnd =
          PAA_normalizeTime_(
            row["Shift End"]
          );
        base.email =
          base.email ||
          handlerEmails[base.id] ||
          "";
        base.shiftEndsNextDay =
          PAA_shiftEndsNextDay_(
            base.shiftStart,
            base.shiftEnd
          );
        base.shiftDurationMinutes =
          PAA_shiftDurationMinutes_(
            base.shiftStart,
            base.shiftEnd
          );
      }

      if(type === "SETUP_SUPPORT"){
        base.teamScope =
          PAC_text_(
            row["Team Scope"]
          );
        base.teamId =
          base.teamScope;
        base.teamName =
          PAC_teamName_(
            base.teamId
          );
        base.nightEligible =
          PAA_optionalBool_(
            row["Night Eligible"]
          );
      }

      if(type === "TECH_SUPPORT"){
        base.teamId =
          PAC_text_(
            row["Home Team ID"]
          );
        base.teamName =
          PAC_teamName_(
            base.teamId
          );
        base.developerCapable =
          PAC_active_(
            row["Developer Capability"]
          );
        base.screenOperatorCapable =
          PAC_active_(
            row["Screen Operator Capability"]
          );
        base.legacyDeveloperId =
          PAC_text_(
            row["Legacy Developer ID"]
          );
        base.legacyOperatorId =
          PAC_text_(
            row["Legacy Operator ID"]
          );
      }

      return base;
    })
    .sort(function(a,b){
      return String(a.name)
        .localeCompare(
          String(b.name)
        );
    });
}


/******************************************************
 * PRIVATE — MASTER SHEET / IDS
 ******************************************************/
function PAA_normalizeHandlerAliases_(value){

  const text =
    String(value || "")
      .replace(/\r?\n/g, ",")
      .replace(/[;|]/g, ",")
      .trim();

  if(!text){
    return "";
  }

  const seen = {};

  return text
    .split(",")
    .map(function(alias){
      return String(alias || "")
        .replace(/\s+/g," ")
        .trim();
    })
    .filter(function(alias){

      if(!alias){
        return false;
      }

      const key =
        alias.toLowerCase();

      if(seen[key]){
        return false;
      }

      seen[key] = true;
      return true;

    })
    .join(", ");
}


function PAA_ensureMasterSheet_(def){

  const ss = PAC_backend_();
  let sheet = ss.getSheetByName(def.sheet);

  if(!sheet){
    sheet = ss.insertSheet(def.sheet);
    sheet.getRange(1,1,1,def.headers.length)
      .setValues([def.headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,def.headers.length)
      .setValues([def.headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Append-only schema evolution is allowed. Existing columns are never
  // shifted or renamed. This is used to add Handler Email safely at the end.
  const width = Math.max(sheet.getLastColumn(),def.headers.length);
  const existing = sheet
    .getRange(1,1,1,width)
    .getDisplayValues()[0]
    .map(PAC_text_);

  for(let i=0;i<def.headers.length;i++){
    if(!existing[i]){
      sheet.getRange(1,i+1).setValue(def.headers[i]);
      existing[i] = def.headers[i];
    }else if(existing[i] !== def.headers[i]){
      throw new Error(
        "MASTER_HEADER_MISMATCH|sheet=" + def.sheet +
        "|column=" + (i+1)
      );
    }
  }

  sheet.setFrozenRows(1);
  return sheet;
}


function PAA_nextMasterNumber_(sheet,idHeader,prefix){

  if(sheet.getLastRow() < 2) return 1;

  const values = sheet.getDataRange().getDisplayValues();
  const hm = PAA_headerMap_(values[0]);
  const col = hm[PAA_key_(idHeader)];
  if(col === undefined) return 1;

  let max = 0;
  const re = new RegExp("^" + prefix + "-(\\d+)$","i");

  for(let i=1;i<values.length;i++){
    const m = PAC_text_(values[i][col]).match(re);
    if(m){
      max = Math.max(max,Number(m[1]) || 0);
    }
  }

  return max + 1;
}


function PAA_formatMasterId_(prefix,number){
  return prefix + "-" + String(number).padStart(6,"0");
}


function PAA_syncHandlerTeamToUsers_(handlerId,teamId,handlerActive){

  const sheet =
    PAC_ensureUserAccessSchema_();

  if(sheet.getLastRow() < 2){
    return;
  }

  const values =
    sheet.getDataRange().getValues();

  const hm =
    PAA_headerMap_(
      values[0]
    );

  if(
    hm["handler id"] === undefined
  ){
    return;
  }

  const roleSheet =
    PAC_ensureUserRolesSchema_();

  for(let i=1;i<values.length;i++){

    if(
      PAC_text_(
        values[i][hm["handler id"]]
      ) !== handlerId
    ){
      continue;
    }

    const userId =
      PAC_text_(
        values[i][hm["user id"]]
      );

    const email =
      PAC_email_(
        values[i][hm["email"]]
      );

    const defaultRole =
      hm["role"] === undefined
        ? ""
        : PAC_role_(
            values[i][hm["role"]]
          );

    // Primary Team ID is only the legacy/default-role compatibility
    // scope. Do not overwrite an Admin/Technical Support default scope just
    // because this same person also has a Handler role.
    if(
      hm["primary team id"] !== undefined &&
      defaultRole === "HANDLER"
    ){
      sheet
        .getRange(
          i+1,
          hm["primary team id"]+1
        )
        .setValue(teamId || "");
    }

    if(userId && email){
      PAA_upsertOneUserRoleAssignment_(
        roleSheet,
        userId,
        email,
        "HANDLER",
        teamId || "",
        handlerId,
        handlerActive === undefined
          ? true
          : handlerActive === true,
        "Synchronized from Handler Master"
      );
    }
  }
}

function PAA_syncTechnicalSupportToUsers_(
  technicalSupportId,
  teamId,
  resourceActive
){

  const userSheet =
    PAC_ensureUserAccessSchema_();

  if(userSheet.getLastRow() < 2){
    return;
  }

  const values =
    userSheet.getDataRange().getValues();

  const hm =
    PAA_headerMap_(values[0]);

  if(
    hm["technical support id"] === undefined
  ){
    return;
  }

  const roleSheet =
    PAC_ensureUserRolesSchema_();

  for(let i=1;i<values.length;i++){

    if(
      PAC_text_(
        values[i][hm["technical support id"]]
      ) !== technicalSupportId
    ){
      continue;
    }

    const userId =
      PAC_text_(
        values[i][hm["user id"]]
      );

    const email =
      PAC_email_(
        values[i][hm["email"]]
      );

    const defaultRole =
      hm["role"] === undefined
        ? ""
        : PAC_role_(
            values[i][hm["role"]]
          );

    if(
      hm["primary team id"] !== undefined &&
      defaultRole === "TECH_SUPPORT"
    ){
      userSheet
        .getRange(
          i+1,
          hm["primary team id"]+1
        )
        .setValue(teamId || "");
    }

    if(userId && email){
      PAA_upsertOneUserRoleAssignment_(
        roleSheet,
        userId,
        email,
        "TECH_SUPPORT",
        teamId || "",
        technicalSupportId,
        resourceActive === undefined
          ? true
          : resourceActive === true,
        "Synchronized from Technical Support Master"
      );
    }
  }
}



/******************************************************
 * PRIVATE — HANDLER EMAIL / TIME HELPERS
 ******************************************************/
function PAA_readSheetDisplayObjects_(sheet){
  const values = sheet.getDataRange().getDisplayValues();
  if(!values.length) return [];
  const headers = values[0].map(PAC_text_);
  return values.slice(1).map(function(row){
    const obj = {};
    headers.forEach(function(header,index){
      if(header) obj[header] = row[index];
    });
    return obj;
  });
}


function PAA_handlerEmailMap_(){
  const result = {};
  const sheet = PAC_ensureUserAccessSchema_();
  if(sheet.getLastRow() < 2) return result;

  const values = sheet.getDataRange().getValues();
  const hm = PAA_headerMap_(values[0]);
  if(hm["handler id"] === undefined || hm["email"] === undefined){
    return result;
  }

  for(let i=1;i<values.length;i++){
    const handlerId = PAC_text_(values[i][hm["handler id"]]);
    const email = PAC_email_(values[i][hm["email"]]);

    // Multi-role users may have ADMIN/SUPER_ADMIN/TECH_SUPPORT as their
    // default role while still owning a valid Handler ID.
    if(handlerId && email){
      result[handlerId] = email;
    }
  }
  return result;
}


function PAA_syncHandlerMasterEmailsFromUserAccess_(){
  const def = PORTAL_ACCESS_ADMIN.MASTER_DEFS.HANDLER;
  const sheet = PAA_ensureMasterSheet_(def);
  if(sheet.getLastRow() < 2) return 0;

  const emailMap = PAA_handlerEmailMap_();
  const values = sheet.getDataRange().getValues();
  const hm = PAA_headerMap_(values[0]);
  if(hm["handler id"] === undefined || hm["email"] === undefined){
    return 0;
  }

  let updated = 0;
  for(let i=1;i<values.length;i++){
    const id = PAC_text_(values[i][hm["handler id"]]);
    const current = PAC_email_(values[i][hm["email"]]);
    const wanted = emailMap[id] || "";
    if(id && wanted && current !== wanted){
      sheet.getRange(i+1,hm["email"]+1).setValue(wanted);
      updated++;
    }
  }
  return updated;
}


function PAA_upsertHandlerPortalUser_(
  userSheet,
  uh,
  usersByEmail,
  handler
){
  if(!handler.email) return;

  const email =
    PAC_email_(handler.email);

  let existing =
    usersByEmail[email] || null;

  let rowNumber =
    existing
      ? existing.rowNumber
      : 0;

  let row =
    existing
      ? existing.row.slice()
      : [];

  const width =
    userSheet.getLastColumn();

  while(row.length < width){
    row.push("");
  }

  if(existing){
    const linked =
      PAC_text_(
        row[uh["handler id"]]
      );
    if(
      linked &&
      linked !== handler.id
    ){
      throw new Error(
        "HANDLER_EMAIL_ALREADY_LINKED|email=" +
        email
      );
    }
  }else{
    rowNumber =
      userSheet.getLastRow()+1;
    row[uh["user id"]] =
      "USR-" +
      PAC_shortHash_(email);
    row[uh["email"]] =
      email;
    row[uh["role"]] =
      "HANDLER";
    if(uh["notes"] !== undefined){
      row[uh["notes"]] =
        "Created from Handler Master";
    }
  }

  row[uh["email"]] = email;
  row[uh["official name"]] =
    handler.name;

  // Preserve an existing user's default role and other resource links.
  if(
    !PAC_role_(
      row[uh["role"]]
    )
  ){
    row[uh["role"]] =
      "HANDLER";
  }

  row[uh["handler id"]] =
    handler.id;

  if(
    PAC_role_(
      row[uh["role"]]
    ) === "HANDLER"
  ){
    row[uh["primary team id"]] =
      handler.teamId || "";
  }

  if(!existing){
    row[uh["active"]] =
      handler.active === true;
  }

  userSheet
    .getRange(
      rowNumber,
      1,
      1,
      width
    )
    .setValues([
      row.slice(0,width)
    ]);

  usersByEmail[email] = {
    rowNumber: rowNumber,
    row: row.slice(0,width)
  };

  // Add/activate the Handler role assignment without removing other roles.
  const roleSheet =
    PAC_ensureUserRolesSchema_();

  const userId =
    PAC_text_(
      row[uh["user id"]]
    );

  PAA_upsertOneUserRoleAssignment_(
    roleSheet,
    userId,
    email,
    "HANDLER",
    handler.teamId || "",
    handler.id,
    handler.active === true,
    "Linked from Handler Master"
  );
}


function PAA_normalizeTime_(value){
  const text = PAC_text_(value);
  if(!text) return "";

  // Accept display values such as 11:00 AM, 11:00:00 AM, 23:00,
  // 11 AM and compact 11:00AM. Reject date strings completely.
  if(/[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}/.test(text)){
    return "";
  }

  let m = text.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([AaPp])\.?[Mm]\.?$/);
  let hour, minute;
  if(m){
    hour = Number(m[1]);
    minute = Number(m[2] || 0);
    if(hour < 1 || hour > 12 || minute < 0 || minute > 59) return "";
    const ap = m[3].toUpperCase();
    let h24 = hour % 12;
    if(ap === "P") h24 += 12;
    return PAA_formatMinutesAsTime_(h24*60 + minute);
  }

  m = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if(m){
    hour = Number(m[1]);
    minute = Number(m[2]);
    if(hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
    return PAA_formatMinutesAsTime_(hour*60 + minute);
  }

  return "";
}


function PAA_timeMinutes_(value){
  const normalized = PAA_normalizeTime_(value);
  if(!normalized) return null;
  const m = normalized.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/);
  if(!m) return null;
  let hour = Number(m[1]) % 12;
  const minute = Number(m[2]);
  if(m[3] === "PM") hour += 12;
  return hour*60 + minute;
}


function PAA_formatMinutesAsTime_(minutes){
  const total = ((Number(minutes)||0) % 1440 + 1440) % 1440;
  const h24 = Math.floor(total/60);
  const minute = total % 60;
  const ap = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return h12 + ":" + String(minute).padStart(2,"0") + " " + ap;
}


function PAA_shiftEndsNextDay_(start,end){
  const s = PAA_timeMinutes_(start);
  const e = PAA_timeMinutes_(end);
  return s !== null && e !== null && e <= s;
}


function PAA_shiftDurationMinutes_(start,end){
  const s = PAA_timeMinutes_(start);
  const e = PAA_timeMinutes_(end);
  if(s === null || e === null) return 0;
  let diff = e - s;
  if(diff <= 0) diff += 1440;
  return diff;
}




/******************************************************
 * PRIVATE — MULTI-ROLE / AUTO RESOURCE MANAGEMENT
 ******************************************************/
function PAA_syncUserRoleAssignments_(
  roleSheet,
  userId,
  email,
  selectedRoles,
  roleScopes
){

  const roles =
    PORTAL_ACCESS_V2.ROLES;

  const selected =
    Array.isArray(selectedRoles)
      ? selectedRoles
      : [];

  roles.forEach(function(role){

    const scope =
      roleScopes[role] || {};

    PAA_upsertOneUserRoleAssignment_(
      roleSheet,
      userId,
      email,
      role,
      scope.teamId || "",
      scope.resourceId || "",
      selected.indexOf(role) !== -1,
      ""
    );
  });
}


function PAA_upsertOneUserRoleAssignment_(
  roleSheet,
  userId,
  email,
  role,
  teamId,
  resourceId,
  active,
  notes
){

  const values =
    roleSheet.getDataRange().getValues();

  const hm =
    PAA_headerMap_(
      values[0] ||
      PORTAL_ACCESS_V2.USER_ROLES_HEADERS
    );

  const normalizedRole =
    PAC_role_(role);

  let rowNumber = 0;
  let existing = null;

  for(let i=1;i<values.length;i++){
    if(
      PAC_text_(
        values[i][hm["user id"]]
      ) === userId &&
      PAC_role_(
        values[i][hm["role"]]
      ) === normalizedRole
    ){
      rowNumber = i+1;
      existing = values[i];
      break;
    }
  }

  const now =
    new Date();

  const record = {
    "User Role ID":
      existing
        ? PAC_text_(
            existing[hm["user role id"]]
          )
        : (
            "UR-" +
            PAC_shortHash_(
              userId +
              "|" +
              normalizedRole
            )
          ),
    "User ID": userId,
    "Email": email,
    "Role": normalizedRole,
    "Team ID":
      teamId ||
      (
        existing
          ? PAC_text_(
              existing[hm["team id"]]
            )
          : ""
      ),
    "Resource ID":
      resourceId ||
      (
        existing
          ? PAC_text_(
              existing[hm["resource id"]]
            )
          : ""
      ),
    "Active": active === true,
    "Notes":
      notes ||
      (
        existing
          ? PAC_text_(
              existing[hm["notes"]]
            )
          : ""
      ),
    "Created At":
      existing &&
      existing[hm["created at"]]
        ? existing[hm["created at"]]
        : now,
    "Updated At": now
  };

  const output =
    PORTAL_ACCESS_V2.USER_ROLES_HEADERS
      .map(function(header){
        return record[header] !== undefined
          ? record[header]
          : "";
      });

  if(rowNumber){
    roleSheet
      .getRange(
        rowNumber,
        1,
        1,
        output.length
      )
      .setValues([output]);
  }else{
    roleSheet
      .getRange(
        roleSheet.getLastRow()+1,
        1,
        1,
        output.length
      )
      .setValues([output]);
  }
}


function PAA_ensureResourceForPortalUser_(args){

  const role =
    PAC_role_(args.role);

  const map = {
    HANDLER: "HANDLER",
    SETUP_SUPPORT: "SETUP_SUPPORT",
    TECH_SUPPORT: "TECH_SUPPORT"
  };

  const type =
    map[role];

  if(!type){
    return "";
  }

  const def =
    PORTAL_ACCESS_ADMIN.MASTER_DEFS[type];

  const sheet =
    PAA_ensureMasterSheet_(def);

  const values =
    sheet.getDataRange().getValues();

  const hm =
    PAA_headerMap_(
      values[0] ||
      def.headers
    );

  const email =
    PAC_email_(args.email);

  const name =
    PAC_text_(args.officialName);

  const currentId =
    PAC_text_(
      args.currentResourceId
    );

  let rowNumber = 0;
  let finalId = currentId;
  let existing = null;

  for(let i=1;i<values.length;i++){

    const rowId =
      PAC_text_(
        values[i][
          hm[PAA_key_(def.idHeader)]
        ]
      );

    const rowEmail =
      hm["email"] === undefined
        ? ""
        : PAC_email_(
            values[i][hm["email"]]
          );

    if(
      currentId &&
      rowId === currentId
    ){
      rowNumber = i+1;
      existing = values[i];
      finalId = rowId;
      break;
    }

    if(
      !currentId &&
      email &&
      rowEmail === email
    ){
      rowNumber = i+1;
      existing = values[i];
      finalId = rowId;
      break;
    }
  }

  if(!finalId){
    finalId =
      PAA_formatMasterId_(
        def.prefix,
        PAA_nextMasterNumber_(
          sheet,
          def.idHeader,
          def.prefix
        )
      );
  }

  const record = {};

  if(existing){
    def.headers.forEach(function(header){
      const col =
        hm[PAA_key_(header)];
      record[header] =
        col === undefined
          ? ""
          : existing[col];
    });
  }

  record[def.idHeader] =
    finalId;
  record[def.nameHeader] =
    name;
  record["Active"] =
    args.active === true;
  record["Notes"] =
    record["Notes"] ||
    PAC_text_(args.notes);
  record["Email"] =
    email;

  if(role === "HANDLER"){
    record["Team ID"] =
      args.teamId || "";
    record["Shift Start"] =
      PAA_normalizeTime_(
        record["Shift Start"]
      );
    record["Shift End"] =
      PAA_normalizeTime_(
        record["Shift End"]
      );
  }

  if(role === "SETUP_SUPPORT"){
    record["Team Scope"] =
      args.teamId || "";
  }

  if(role === "TECH_SUPPORT"){
    record["Home Team ID"] =
      args.teamId || "";
    record["Developer Capability"] =
      args.developerCapable === true;
    record["Screen Operator Capability"] =
      args.screenOperatorCapable === true;

    if(
      !record["Developer Capability"] &&
      !record["Screen Operator Capability"]
    ){
      throw new Error(
        "TECH_SUPPORT_CAPABILITY_REQUIRED"
      );
    }
  }

  const output =
    def.headers.map(function(header){
      return record[header] !== undefined
        ? record[header]
        : "";
    });

  const targetRow =
    rowNumber ||
    (sheet.getLastRow()+1);

  sheet
    .getRange(
      targetRow,
      1,
      1,
      output.length
    )
    .setValues([output]);

  return finalId;
}


function PAA_setResourceActive_(
  role,
  resourceId,
  active
){

  const map = {
    HANDLER: "HANDLER",
    SETUP_SUPPORT: "SETUP_SUPPORT",
    TECH_SUPPORT: "TECH_SUPPORT"
  };

  const type =
    map[PAC_role_(role)];

  if(!type || !resourceId){
    return;
  }

  const def =
    PORTAL_ACCESS_ADMIN.MASTER_DEFS[type];

  const sheet =
    PAA_ensureMasterSheet_(def);

  const values =
    sheet.getDataRange().getValues();

  const hm =
    PAA_headerMap_(
      values[0] ||
      def.headers
    );

  const idCol =
    hm[PAA_key_(def.idHeader)];

  const activeCol =
    hm["active"];

  if(
    idCol === undefined ||
    activeCol === undefined
  ){
    return;
  }

  for(let i=1;i<values.length;i++){
    if(
      PAC_text_(values[i][idCol]) ===
      PAC_text_(resourceId)
    ){
      sheet
        .getRange(
          i+1,
          activeCol+1
        )
        .setValue(active === true);
      return;
    }
  }
}


function PAA_isSelfSupportTeam_(team){

  const mode =
    PAC_text_(
      team &&
      team.supportMode
    )
      .toLowerCase();

  return (
    PAC_text_(team && team.id) === "TEAM-HYD" ||
    mode.indexOf("self") !== -1
  );
}

/******************************************************
 * PRIVATE — SECURITY / AUDIT
 ******************************************************/
function PAA_requireWritableSuperAdmin_(token,forWrite){

  const context = PAC_requireRealSuperAdminContext_(token);

  if(
    forWrite &&
    context.testViewActive === true
  ){
    throw new Error("TEST_VIEW_READ_ONLY");
  }

  return context;
}


function PAA_audit_(context,entry){

  //--------------------------------------------------
  // Access/master administration is GLOBAL control
  // data.  Never route this audit through a selected
  // operational team such as HYD.
  //--------------------------------------------------

  const appendAudit =
    typeof PO_appendCentralAudit_ === "function"
      ? PO_appendCentralAudit_
      : (
          typeof PO_appendAudit_ === "function"
            ? PO_appendAudit_
            : null
        );

  if(!appendAudit){
    return;
  }

  appendAudit({
    actorEmail: context && context.actor
      ? context.actor.email
      : "",
    role: "SUPER_ADMIN",
    action: entry.action || "Access Administration",
    targetType: entry.targetType || "Access",
    targetId: entry.targetId || "",
    oldValue: "",
    newValue: "",
    handler: "",
    details: entry.details || ""
  });
}


/******************************************************
 * PRIVATE — HELPERS
 ******************************************************/
function PAA_headerMap_(headers){
  const map = {};
  (headers || []).forEach(function(value,index){
    const key = PAA_key_(value);
    if(key) map[key] = index;
  });
  return map;
}

function PAA_key_(value){
  return PAC_text_(value).toLowerCase();
}

function PAA_validEmail_(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function PAA_bool_(value,defaultValue){
  if(value === true || value === false) return value;
  const key = PAA_key_(value);
  if(["true","yes","y","1","active"].indexOf(key) !== -1) return true;
  if(["false","no","n","0","inactive"].indexOf(key) !== -1) return false;
  return defaultValue === true;
}

function PAA_optionalBool_(value){
  const text = PAC_text_(value);
  if(!text) return null;
  return PAA_bool_(value,false);
}

function PAA_optionalBoolValue_(value){
  if(value === null || value === undefined || PAC_text_(value) === ""){
    return "";
  }
  return PAA_bool_(value,false);
}
