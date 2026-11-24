/******************************************************
 * PORTALACCESSCONTROL.GS
 * Interview Operations Portal V2
 * Central role / scope foundation + Super Admin Test As
 *
 * INSTALL IN:
 *   Interview Portal Control -> Apps Script
 *
 * VERSION:
 *   V2-PORTAL-ACCESS-1.3.0
 *
 * PURPOSE
 * -------
 * 1) Centralize portal identity, role and scope.
 * 2) Keep the existing OTP/session system.
 * 3) Allow one real SUPER_ADMIN login to safely test the
 *    portal as Admin / Handler / Setup Support / Technical Support.
 * 4) Preserve old Admin/Handler behavior while modules are
 *    migrated one-by-one to team/resource-aware filtering.
 *
 * IMPORTANT SAFETY
 * ----------------
 * - Test View is flagged READ ONLY for the UI.
 * - The real authenticated email is NEVER replaced.
 * - VERSION-1 rollback compatibility:
 *     SUPER_ADMIN     -> Admin
 *     ADMIN           -> Admin
 *     HANDLER         -> Handler
 *     SETUP_SUPPORT   -> SetupSupport
 *     TECH_SUPPORT    -> TechnicalSupport
 * - ADMIN intentionally uses legacy global Admin behavior because
 *   the locked rollback target is Version-1 behavior + Administration.
 ******************************************************/

const PORTAL_ACCESS_V2 = Object.freeze({
  VERSION: "V2-PORTAL-ACCESS-1.3.3-MULTI-TEAM",

  SHEETS: Object.freeze({
    USER_ACCESS: "V2 User Access",
    TEAM_MASTER: "V2 Team Master",
    HANDLER_MASTER: "V2 Handler Master",
    SUPPORT_MASTER: "V2 Setup Support Master",
    DEVELOPER_MASTER: "V2 Developer Master",
    OPERATOR_MASTER: "V2 Screen Operator Master",
    TECH_SUPPORT_MASTER: "V2 Technical Support Master",
    USER_ROLES: "V2 User Roles"
  }),

  USER_ACCESS_BASE_HEADERS: Object.freeze([
    "User ID",
    "Email",
    "Official Name",
    "Role",
    "Primary Team ID",
    "Handler ID",
    "Support ID",
    "Active",
    "Notes"
  ]),

  USER_ACCESS_EXTRA_HEADERS: Object.freeze([
    "Developer ID",
    "Operator ID",
    "Technical Support ID"
  ]),

  ROLES: Object.freeze([
    "SUPER_ADMIN",
    "ADMIN",
    "HANDLER",
    "SETUP_SUPPORT",
    "TECH_SUPPORT"
  ]),

  TEST_VIEW_PREFIX: "PORTAL_TEST_VIEW_",
  CURRENT_ROLE_PREFIX: "PORTAL_CURRENT_ROLE_",
  USER_ROLES_HEADERS: Object.freeze([
    "User Role ID",
    "User ID",
    "Email",
    "Role",
    "Team ID",
    "Resource ID",
    "Active",
    "Notes",
    "Created At",
    "Updated At"
  ])
});


// ====================================================
// VERSION-1 COMPATIBLE PROTECTED-READ PERFORMANCE MEMO
// Execution-scoped ONLY. Nothing persists across requests.
// ====================================================
let PAC_FAST_BACKEND_MEMO_ = null;
let PAC_FAST_LOGIN_ACTOR_EMAIL_ = "";
let PAC_FAST_LOGIN_ACTOR_ = null;
let PAC_FAST_MASTER_OPTIONS_MEMO_ = {};


/******************************************************
 * PUBLIC — ACCESS CONTEXT FOR PORTAL UI
 ******************************************************/
function getPortalAccessContext(token){

  const auth =
    PA_validateSession_(token);

  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const context =
    auth.accessContext ||
    PAC_buildContextFromAuth_(
      auth,
      token
    );

  return {
    ok: true,
    version: PORTAL_ACCESS_V2.VERSION,
    actor: PAC_publicIdentity_(context.actor),
    effective: PAC_publicIdentity_(context.effective),
    availableRoles:
      (context.availableRoles || []).slice(),
    currentRole:
      context.currentRole || "",
    roleAssignments:
      PAC_publicRoleAssignments_(
        context.actor &&
        context.actor.roleAssignments
          ? context.actor.roleAssignments
          : []
      ),
    testViewActive: context.testViewActive === true,
    readOnlyTest: context.readOnlyTest === true,
    testViewLabel: context.testViewLabel || "",
    permissions: context.permissions || {},
    navigation: context.navigation || {allowedPages:["dashboard"]},
    compatibilityRole:
      context.compatibilityRole ||
      (auth.user ? auth.user.role : ""),
    teamContext:
      auth.teamContext ||
      (typeof PTR_currentContext_ === "function"
        ? PTR_currentContext_()
        : null)
  };
}




/******************************************************
 * PUBLIC — SWITCH AMONG THE LOGGED-IN USER'S REAL ROLES
 *
 * Same authenticated email/session. No OTP or re-login.
 * The requested role must already be an active assignment
 * for the real authenticated user.
 ******************************************************/
function setPortalCurrentRole(
  token,
  requestedRole
){

  const auth =
    PA_validateSession_(token);

  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const context =
    auth.accessContext ||
    PAC_buildContextFromAuth_(auth,token);

  if(context.testViewActive === true){
    throw new Error("EXIT_TEST_VIEW_BEFORE_SWITCHING_ROLE");
  }

  const role =
    PAC_role_(requestedRole);

  if(!role){
    throw new Error("INVALID_CURRENT_ROLE");
  }

  const allowed =
    context.actor &&
    Array.isArray(context.actor.availableRoles)
      ? context.actor.availableRoles
      : [];

  if(allowed.indexOf(role) === -1){
    throw new Error("ROLE_NOT_ASSIGNED_TO_USER");
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      PAC_currentRoleKey_(token),
      role
    );

  return getPortalAccessContext(token);
}

/******************************************************
 * PUBLIC — SUPER ADMIN TEST-AS OPTIONS
 ******************************************************/
function getPortalTestAsOptions(token){

  const context =
    PAC_requireRealSuperAdminContext_(token);

  return {
    ok: true,
    version: PORTAL_ACCESS_V2.VERSION,
    actor: PAC_publicIdentity_(context.actor),
    roles: [
      {value:"SUPER_ADMIN", label:"Super Admin"},
      {value:"ADMIN", label:"Admin (choose team)"},
      {value:"HANDLER", label:"Handler"},
      {value:"SETUP_SUPPORT", label:"Setup Support"},
      {value:"TECH_SUPPORT", label:"Technical Support"}
    ],
    teams: PAC_teamOptions_(),
    handlers: PAC_handlerOptions_(),
    supports: PAC_supportOptions_(),
    technicalSupports: PAC_technicalSupportOptions_()
  };
}


/******************************************************
 * PUBLIC — SET SUPER ADMIN TEST VIEW
 *
 * SUPER_ADMIN clears the simulation and returns to the
 * real global Super Admin context.
 ******************************************************/
function setPortalTestView(
  token,
  requestedRole,
  targetId
){

  const context =
    PAC_requireRealSuperAdminContext_(token);

  const role =
    PAC_role_(requestedRole);

  if(!role){
    throw new Error("INVALID_TEST_ROLE");
  }

  if(role === "SUPER_ADMIN"){
    PAC_clearTestViewForToken_(token);
    return getPortalAccessContext(token);
  }

  const target =
    PAC_resolveTestTarget_(
      role,
      targetId
    );

  if(!target){
    throw new Error("INVALID_TEST_TARGET");
  }

  const state = {
    role: role,
    targetId: target.targetId,
    actorEmail: context.actor.email,
    createdAt: new Date().toISOString(),
    readOnly: true
  };

  PropertiesService
    .getScriptProperties()
    .setProperty(
      PAC_testViewKey_(token),
      JSON.stringify(state)
    );

  return getPortalAccessContext(token);
}


/******************************************************
 * PUBLIC — EXIT TEST VIEW
 ******************************************************/
function clearPortalTestView(token){

  PAC_requireRealSuperAdminContext_(token);
  PAC_clearTestViewForToken_(token);

  return getPortalAccessContext(token);
}


/******************************************************
 * PUBLIC — ONE-TIME / RE-RUNNABLE ACCESS FOUNDATION
 *
 * Protected by real Super Admin / legacy global Admin.
 * Safe behavior:
 * - preserves the original first 9 V2 User Access columns
 * - appends Developer ID + Operator ID + Technical Support ID when missing
 * - does not overwrite existing V2 users except that the
 *   currently logged-in legacy global Admin is explicitly
 *   promoted to SUPER_ADMIN for the new V2 model
 * - syncs missing legacy Portal Users for compatibility
 ******************************************************/
function initializePortalAccessFoundation(token){

  const baseAuth =
    PA_validateSession_(token);

  if(!baseAuth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const email =
    PAC_email_(
      baseAuth.user &&
      baseAuth.user.email
    );

  const context =
    baseAuth.accessContext ||
    PAC_buildContextFromAuth_(
      baseAuth,
      token
    );

  const legacy =
    PAC_readLegacyPortalUser_(email);

  const permitted =
    (
      context.actor &&
      PAC_actorHasRole_(
        context.actor,
        "SUPER_ADMIN"
      )
    ) ||
    (
      legacy &&
      legacy.role === "Admin"
    );

  if(!permitted){
    throw new Error("SUPER_ADMIN_ACCESS_REQUIRED");
  }

  const sheet =
    PAC_ensureUserAccessSchema_();

  PAC_ensureTechnicalSupportMaster_();

  const currentPromotion =
    PAC_promoteCurrentLegacyAdmin_(
      sheet,
      email
    );

  const sync =
    PAC_syncLegacyPortalUsers_(sheet);

  PAC_ensureUserRolesSchema_();

  const migration =
    PAC_migrateSingleRoleUsersToRoleAssignments_();

  const technicalMigration =
    PAC_migrateLegacyTechnicalSupport_();

  return {
    ok: true,
    version: PORTAL_ACCESS_V2.VERSION,
    userAccessSheet: PORTAL_ACCESS_V2.SHEETS.USER_ACCESS,
    userRolesSheet: PORTAL_ACCESS_V2.SHEETS.USER_ROLES,
    technicalSupportSheet:
      PORTAL_ACCESS_V2.SHEETS.TECH_SUPPORT_MASTER,
    developerIdColumnReady: true,
    operatorIdColumnReady: true,
    technicalSupportIdColumnReady: true,
    currentActorPromotedToSuperAdmin: currentPromotion,
    syncedLegacyUsers: sync.added,
    skippedExistingUsers: sync.skipped,
    unresolvedLegacyHandlers: sync.unresolvedHandlers,
    roleAssignmentsCreated:
      migration.created,
    technicalSupportMigration:
      technicalMigration,
    health: PAC_accessHealth_()
  };
}


/******************************************************
 * PUBLIC — READ-ONLY HEALTH CHECK
 ******************************************************/
function PAC_testAccessHealthReadOnly(){

  const result =
    PAC_accessHealth_();

  Logger.log(
    "========== V2 PORTAL ACCESS HEALTH =========="
  );
  Logger.log(
    JSON.stringify(result,null,2)
  );
  Logger.log(
    "============================================="
  );

  return result;
}



/******************************************************
 * READ-ONLY VERSION-1 FAST PROTECTED READ TIMING
 ******************************************************/
function PAC_testVersion1FastProtectedReadPerformanceReadOnly(){

  const started = Date.now();
  const backendStarted = Date.now();
  const ss = PAC_backend_();
  const backendResolveMs = Date.now() - backendStarted;

  const sheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.USER_ACCESS
    );

  if(!sheet || sheet.getLastRow() < 2){
    throw new Error("V2_USER_ACCESS_NOT_AVAILABLE");
  }

  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0] || [];
  const emailCol = headers.indexOf("Email");
  const activeCol = headers.indexOf("Active");

  let email = "";

  for(let i=1;i<rows.length;i++){

    if(
      emailCol >= 0 &&
      rows[i][emailCol] &&
      (
        activeCol < 0 ||
        PAC_active_(rows[i][activeCol])
      )
    ){
      email = PAC_email_(rows[i][emailCol]);
      if(email) break;
    }

  }

  if(!email){
    throw new Error("NO_ACTIVE_V2_USER_FOUND");
  }

  const firstStarted = Date.now();
  const first = PAC_getLoginUserByEmail_(email);
  const firstActorResolveMs = Date.now() - firstStarted;

  const secondStarted = Date.now();
  const second = PAC_getLoginUserByEmail_(email);
  const sameExecutionWarmResolveMs = Date.now() - secondStarted;

  const result = {
    ok: Boolean(first && second),
    mode: "READ_ONLY_VERSION1_COMPAT_FAST_PROTECTED_READ",
    version: PORTAL_ACCESS_V2.VERSION,
    backend: ss.getName(),
    email: email,
    backendResolveMs: backendResolveMs,
    firstActorResolveMs: firstActorResolveMs,
    sameExecutionWarmResolveMs: sameExecutionWarmResolveMs,
    totalMs: Date.now() - started,
    compatibility: {
      superAdmin: PAC_compatRole_("SUPER_ADMIN"),
      admin: PAC_compatRole_("ADMIN"),
      handler: PAC_compatRole_("HANDLER")
    },
    roles:
      first && Array.isArray(first.availableRoles)
        ? first.availableRoles
        : []
  };

  Logger.log(
    "========== VERSION-1 FAST PROTECTED READ =========="
  );
  Logger.log(
    JSON.stringify(result,null,2)
  );
  Logger.log(
    "==================================================="
  );

  return result;

}


/******************************************************
 * READ-ONLY VERSION-1 ROLLBACK COMPATIBILITY TEST
 ******************************************************/
function PAC_testVersion1RollbackCompatibilityReadOnly(){

  const result = {
    ok:
      PAC_compatRole_("SUPER_ADMIN") === "Admin" &&
      PAC_compatRole_("ADMIN") === "Admin" &&
      PAC_compatRole_("HANDLER") === "Handler",
    mode:
      "READ_ONLY_VERSION1_ROLLBACK_COMPATIBILITY",
    version:
      PORTAL_ACCESS_V2.VERSION,
    superAdminCompatibility:
      PAC_compatRole_("SUPER_ADMIN"),
    adminCompatibility:
      PAC_compatRole_("ADMIN"),
    handlerCompatibility:
      PAC_compatRole_("HANDLER"),
    note:
      "ADMIN intentionally restores legacy global Admin behavior."
  };

  Logger.log(
    "========== VERSION-1 ROLLBACK COMPATIBILITY =========="
  );
  Logger.log(
    JSON.stringify(result,null,2)
  );
  Logger.log(
    "======================================================"
  );

  return result;
}


/******************************************************
 * AUTH HOOK — CALLED BY PATCHED PortalAuth.gs
 *
 * baseResult is the already validated legacy session.
 ******************************************************/
function PAC_applySessionAccess_(
  baseResult,
  token
){

  if(
    !baseResult ||
    baseResult.ok !== true ||
    !baseResult.user
  ){
    return baseResult;
  }

  const context =
    PAC_buildContextFromAuth_(
      baseResult,
      token
    );

  const user =
    PAC_compatUser_(
      context.actor,
      context.effective,
      context.testViewActive,
      context.readOnlyTest
    );

  return {
    ok: true,
    user: user,
    actor: PAC_publicIdentity_(context.actor),
    effective: PAC_publicIdentity_(context.effective),
    accessContext: context,
    expiresAt: baseResult.expiresAt,
    rememberDevice: baseResult.rememberDevice === true
  };
}


/******************************************************
 * AUTH LOGIN LOOKUP HOOK
 *
 * Called by patched PA_getAuthorizedUserByEmail_ BEFORE
 * the old 4-column Portal Users fallback.
 ******************************************************/
function PAC_getLoginUserByEmail_(email){

  const normalizedEmail =
    PAC_email_(email);

  let actor = null;

  if(
    normalizedEmail &&
    PAC_FAST_LOGIN_ACTOR_ &&
    PAC_FAST_LOGIN_ACTOR_EMAIL_ === normalizedEmail
  ){
    actor =
      PAC_FAST_LOGIN_ACTOR_;
  }else{
    actor =
      PAC_resolveActorByEmail_(
        normalizedEmail,
        null
      );

    if(actor){
      PAC_FAST_LOGIN_ACTOR_EMAIL_ =
        normalizedEmail;

      PAC_FAST_LOGIN_ACTOR_ =
        actor;
    }
  }

  if(!actor){
    return null;
  }

  const defaultRole =
    PAC_defaultRoleForActor_(
      actor
    );

  const effective =
    defaultRole === actor.accessRole
      ? PAC_copy_(
          actor
        )
      : PAC_identityForRole_(
          actor,
          defaultRole
        );

  if(!effective){
    return null;
  }

  return PAC_compatUser_(
    actor,
    effective,
    false,
    false
  );
}


/******************************************************
 * PRIVATE — BUILD ACCESS CONTEXT
 ******************************************************/
function PAC_buildContextFromAuth_(
  auth,
  token
){

  const legacyUser =
    auth && auth.user
      ? auth.user
      : null;

  const authEmail =
    PAC_email_(
      legacyUser &&
      legacyUser.email
    );

  const actor =
    (
      PAC_FAST_LOGIN_ACTOR_ &&
      PAC_FAST_LOGIN_ACTOR_EMAIL_ === authEmail
    )
      ? PAC_FAST_LOGIN_ACTOR_
      : PAC_resolveActorByEmail_(
          authEmail,
          legacyUser
        );

  if(!actor){
    throw new Error("PORTAL_ACCESS_IDENTITY_NOT_FOUND");
  }

  const availableRoles =
    Array.isArray(actor.availableRoles)
      ? actor.availableRoles.slice()
      : [];

  if(!availableRoles.length){
    throw new Error("PORTAL_ACCESS_ROLE_NOT_ASSIGNED");
  }

  let currentRole =
    PAC_readCurrentRole_(token);

  if(availableRoles.indexOf(currentRole) === -1){
    currentRole =
      PAC_defaultRoleForActor_(actor);
    PAC_writeCurrentRole_(token,currentRole);
  }

  let effective =
    (
      currentRole === actor.accessRole
    )
      ? PAC_copy_(actor)
      : PAC_identityForRole_(
          actor,
          currentRole
        );

  if(!effective){
    throw new Error("PORTAL_ACCESS_ROLE_SCOPE_NOT_FOUND");
  }

  let testViewActive = false;
  let readOnlyTest = false;
  let testViewLabel = "";

  if(
    PAC_actorHasRole_(
      actor,
      "SUPER_ADMIN"
    ) &&
    currentRole === "SUPER_ADMIN"
  ){

    const state =
      PAC_readTestView_(token);

    if(state){

      const target =
        PAC_resolveTestTarget_(
          state.role,
          state.targetId
        );

      if(target){
        effective = target.identity;
        testViewActive = true;
        readOnlyTest = true;
        testViewLabel =
          PAC_testViewLabel_(effective);
      }else{
        PAC_clearTestViewForToken_(token);
      }

    }

  }else{
    PAC_clearTestViewForToken_(token);
  }

  const permissions =
    PAC_permissions_(
      effective.accessRole
    );

  const navigation =
    PAC_navigation_(
      effective.accessRole
    );

  return {
    version: PORTAL_ACCESS_V2.VERSION,
    actor: actor,
    effective: effective,
    availableRoles: availableRoles,
    currentRole: currentRole,
    testViewActive: testViewActive,
    readOnlyTest: readOnlyTest,
    testViewLabel: testViewLabel,
    compatibilityRole:
      PAC_compatRole_(
        effective.accessRole
      ),
    permissions: permissions,
    navigation: navigation
  };
}


/******************************************************
 * PRIVATE — RESOLVE REAL USER FROM V2 USER ACCESS
 *
 * Transitional rule:
 * A legacy global Portal Users Admin whose V2 row still says
 * ADMIN is treated as SUPER_ADMIN.
 * This preserves current global access until the one-time
 * initialization explicitly stores SUPER_ADMIN.
 ******************************************************/
function PAC_resolveActorByEmail_(
  email,
  legacyUser
){

  const normalizedEmail =
    PAC_email_(email);

  if(!normalizedEmail){
    return null;
  }

  const row =
    PAC_userAccessRecordByEmail_(
      normalizedEmail
    );

  if(row && !PAC_active_(row["Active"])){
    // Once V2 User Access contains an email, it is authoritative.
    // An inactive V2 user must never fall back to an older active
    // Portal Users row.
    return null;
  }

  if(row && PAC_active_(row["Active"])){

    const assignments =
      PAC_roleAssignmentsForUser_(
        PAC_text_(row["User ID"]),
        normalizedEmail,
        row
      );

    const availableRoles =
      assignments
        .filter(function(item){
          return item.active === true;
        })
        .map(function(item){
          return item.role;
        })
        .filter(function(role,index,all){
          return role && all.indexOf(role) === index;
        });

    if(availableRoles.length){

      const defaultRole =
        PAC_defaultRoleFromRow_(
          row,
          availableRoles
        );

      const base =
        PAC_identityFromUserAccess_(
          row,
          {
            role: defaultRole,
            teamId: "",
            resourceId: "",
            active: true
          },
          legacyUser
        );

      base.availableRoles =
        availableRoles.slice();

      base.roleAssignments =
        assignments.map(function(item){
          return PAC_copy_(item);
        });

      base.accessRole =
        defaultRole;

      return base;
    }

    // V2 row exists but has no valid active role assignment/default role.
    // Fail closed instead of reviving legacy permissions.
    return null;
  }

  //----------------------------------------------------
  // Backward-compatible fallback while V2 User Access is
  // being rolled out.
  //----------------------------------------------------
  const fallback =
    PAC_readLegacyPortalUser_(
      normalizedEmail
    );

  if(!fallback){
    return null;
  }

  if(fallback.role === "Admin"){
    return {
      userId: "LEGACY-" + PAC_shortHash_(normalizedEmail),
      email: normalizedEmail,
      officialName: fallback.handler || "Super Admin",
      accessRole: "SUPER_ADMIN",
      availableRoles: ["SUPER_ADMIN"],
      roleAssignments: [{
        role: "SUPER_ADMIN",
        teamId: "",
        resourceId: "",
        active: true,
        source: "LEGACY_PORTAL_USERS"
      }],
      primaryTeamId: "",
      teamName: "",
      handlerId: "",
      handlerName: fallback.handler || "Admin",
      supportId: "",
      supportName: "",
      teamScope: "",
      technicalSupportId: "",
      technicalSupportName: "",
      developerCapable: false,
      screenOperatorCapable: false,
      developerId: "",
      developerName: "",
      operatorId: "",
      operatorName: "",
      active: true,
      source: "LEGACY_PORTAL_USERS"
    };
  }

  if(fallback.role === "Handler"){

    const handler =
      PAC_findHandlerByName_(
        fallback.handler
      );

    return {
      userId: "LEGACY-" + PAC_shortHash_(normalizedEmail),
      email: normalizedEmail,
      officialName: fallback.handler,
      accessRole: "HANDLER",
      availableRoles: ["HANDLER"],
      roleAssignments: [{
        role: "HANDLER",
        teamId: handler ? handler.teamId : "",
        resourceId: handler ? handler.id : "",
        active: true,
        source: "LEGACY_PORTAL_USERS"
      }],
      primaryTeamId:
        handler ? handler.teamId : "",
      teamName:
        handler ? PAC_teamName_(handler.teamId) : "",
      handlerId:
        handler ? handler.id : "",
      handlerName: fallback.handler,
      supportId: "",
      supportName: "",
      teamScope: "",
      technicalSupportId: "",
      technicalSupportName: "",
      developerCapable: false,
      screenOperatorCapable: false,
      developerId: "",
      developerName: "",
      operatorId: "",
      operatorName: "",
      active: true,
      source: "LEGACY_PORTAL_USERS"
    };
  }

  return null;
}


function PAC_identityFromUserAccess_(
  row,
  assignment,
  legacyUser
){

  const role =
    PAC_role_(
      assignment &&
      assignment.role
    );

  const rowHandlerId =
    PAC_text_(row["Handler ID"]);
  const rowSupportId =
    PAC_text_(row["Support ID"]);
  const rowDeveloperId =
    PAC_text_(row["Developer ID"]);
  const rowOperatorId =
    PAC_text_(row["Operator ID"]);
  const rowTechnicalSupportId =
    PAC_text_(row["Technical Support ID"]);

  let primaryTeamId =
    PAC_text_(
      assignment &&
      assignment.teamId
    ) ||
    PAC_text_(row["Primary Team ID"]);

  let handlerId = rowHandlerId;
  let supportId = rowSupportId;
  let technicalSupportId = rowTechnicalSupportId;

  const resourceId =
    PAC_text_(
      assignment &&
      assignment.resourceId
    );

  if(role === "HANDLER" && resourceId){
    handlerId = resourceId;
  }else if(role === "SETUP_SUPPORT" && resourceId){
    supportId = resourceId;
  }else if(role === "TECH_SUPPORT" && resourceId){
    technicalSupportId = resourceId;
  }

  const handler =
    handlerId
      ? PAC_findHandlerById_(handlerId)
      : null;
  const support =
    supportId
      ? PAC_findSupportById_(supportId)
      : null;
  const technicalSupport =
    technicalSupportId
      ? PAC_findTechnicalSupportById_(technicalSupportId)
      : null;

  if(role === "HANDLER" && handler && handler.teamId){
    primaryTeamId = handler.teamId;
  }else if(role === "SETUP_SUPPORT" && support){
    primaryTeamId =
      PAC_text_(support.teamId || support.teamScope) ||
      primaryTeamId;
  }else if(
    role === "TECH_SUPPORT" &&
    technicalSupport &&
    technicalSupport.teamId
  ){
    primaryTeamId = technicalSupport.teamId;
  }

  if(role === "SUPER_ADMIN"){
    primaryTeamId = "";
  }

  const officialName =
    PAC_text_(row["Official Name"]) ||
    (handler ? handler.name : "") ||
    (support ? support.name : "") ||
    (technicalSupport ? technicalSupport.name : "") ||
    (
      legacyUser &&
      legacyUser.handler
        ? legacyUser.handler
        : ""
    ) ||
    PAC_emailLocal_(row["Email"]);

  return {
    userId:
      PAC_text_(row["User ID"]) ||
      ("USR-" + PAC_shortHash_(row["Email"])),
    email: PAC_email_(row["Email"]),
    officialName: officialName,
    accessRole: role,
    primaryTeamId: primaryTeamId,
    teamName: PAC_teamName_(primaryTeamId),
    handlerId: handlerId,
    handlerName:
      handler
        ? handler.name
        : (
            role === "HANDLER" &&
            legacyUser &&
            legacyUser.handler
              ? PAC_text_(legacyUser.handler)
              : ""
          ),
    supportId: supportId,
    supportName: support ? support.name : "",
    teamScope: support ? support.teamScope : "",
    technicalSupportId: technicalSupportId,
    technicalSupportName:
      technicalSupport ? technicalSupport.name : "",
    developerCapable:
      technicalSupport
        ? technicalSupport.developerCapable === true
        : false,
    screenOperatorCapable:
      technicalSupport
        ? technicalSupport.screenOperatorCapable === true
        : false,

    // Historical compatibility only. New access/call assignments use
    // Technical Support ID, not separate Developer/Operator identities.
    developerId: rowDeveloperId,
    developerName: "",
    operatorId: rowOperatorId,
    operatorName: "",

    active: true,
    source: "V2_USER_ACCESS"
  };
}


/******************************************************
 * PRIVATE — COMPATIBILITY USER FOR EXISTING MODULES
 ******************************************************/
function PAC_compatUser_(
  actor,
  effective,
  testViewActive,
  readOnlyTest
){

  const role =
    PAC_compatRole_(
      effective.accessRole
    );

  let handler = "";

  if(effective.accessRole === "SUPER_ADMIN"){
    handler =
      actor.handlerName ||
      actor.officialName ||
      "Admin";
  }else if(effective.accessRole === "HANDLER"){
    handler =
      effective.handlerName || "";
  }

  return {
    // Preserve real actor email for audit/session identity.
    email: actor.email,
    handler: handler,
    role: role,

    userId: effective.userId || "",
    officialName: effective.officialName || "",
    accessRole: effective.accessRole || "",
    availableRoles:
      Array.isArray(actor.availableRoles)
        ? actor.availableRoles.slice()
        : [],
    primaryTeamId: effective.primaryTeamId || "",
    teamName: effective.teamName || "",
    handlerId: effective.handlerId || "",
    supportId: effective.supportId || "",
    supportName: effective.supportName || "",
    technicalSupportId: effective.technicalSupportId || "",
    technicalSupportName: effective.technicalSupportName || "",
    developerCapable: effective.developerCapable === true,
    screenOperatorCapable:
      effective.screenOperatorCapable === true,

    // Legacy compatibility fields are retained only for historical reads.
    developerId: effective.developerId || "",
    developerName: effective.developerName || "",
    operatorId: effective.operatorId || "",
    operatorName: effective.operatorName || "",

    actorEmail: actor.email,
    actorAccessRole: actor.accessRole,
    testViewActive: testViewActive === true,
    readOnlyTest: readOnlyTest === true
  };
}


function PAC_compatRole_(role){

  /****************************************************
   * VERSION-1 ROLLBACK COMPATIBILITY
   *
   * Existing Version-1 operational endpoints understand
   * legacy Admin / Handler roles only.
   *
   * ADMIN intentionally returns legacy global "Admin".
   ****************************************************/

  switch(PAC_role_(role)){
    case "SUPER_ADMIN":
      return "Admin";
    case "ADMIN":
      return "Admin";
    case "HANDLER":
      return "Handler";
    case "SETUP_SUPPORT":
      return "SetupSupport";
    case "TECH_SUPPORT":
      return "TechnicalSupport";
    default:
      return "";
  }
}


/******************************************************
 * PRIVATE — NAVIGATION / PERMISSIONS
 ******************************************************/
function PAC_navigation_(role){

  const accessRole =
    PAC_role_(role);

  const allPages = [
    "dashboard",
    "interviewgateway",
    "callscheduledashboard",
    "callschedule",
    "callscheduleteam",
    "interviews",
    "capacityscheduling",
    "todaystotalcalls",
    "incentivedashboard",
    "incentiveteam",
    "tracker",
    "monthly",
    "promotions",
    "recovery",
    "dataintegrity",
    "systemhealth",
    "jobsoperations",
    "administration",
    "reports"
  ];

  const map = {
    SUPER_ADMIN: allPages,

    ADMIN: [
      "dashboard",
      "interviewgateway",
      "callscheduledashboard",
      "callschedule",
      "callscheduleteam",
      "interviews",
      "capacityscheduling",
      "todaystotalcalls",
      "incentivedashboard",
      "incentiveteam",
      "tracker",
      "monthly",
      "promotions",
      "recovery",
      "dataintegrity",
      "jobsoperations",
      "reports"
    ],

    HANDLER: [
      "dashboard",
      "callschedule",
      "interviews",
      "tracker",
      "monthly",
      "promotions",
      "recovery",
      "reports"
    ],

    SETUP_SUPPORT: [
      "dashboard",
      "callschedule",
      "capacityscheduling",
      "todaystotalcalls",
      "reports"
    ],

    TECH_SUPPORT: [
      "dashboard",
      "todaystotalcalls",
      "reports"
    ]
  };

  return {
    allowedPages:
      (map[accessRole] || ["dashboard"]).slice()
  };
}


function PAC_permissions_(role){

  const r = PAC_role_(role);

  return {
    viewGlobal: r === "SUPER_ADMIN",
    viewTeam: r === "SUPER_ADMIN" || r === "ADMIN",
    viewOwn: r !== "SUPER_ADMIN" && r !== "ADMIN",
    viewSystemHealth: r === "SUPER_ADMIN",
    manageAdministration: r === "SUPER_ADMIN",
    manageAllTeams: r === "SUPER_ADMIN",
    manageTeam: r === "ADMIN",
    testAs: r === "SUPER_ADMIN"
  };
}




/******************************************************
 * PRIVATE — MULTI-ROLE ASSIGNMENTS / CURRENT ROLE
 ******************************************************/
function PAC_ensureUserRolesSchema_(){

  const ss = PAC_backend_();
  let sheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.USER_ROLES
    );

  const headers =
    PORTAL_ACCESS_V2.USER_ROLES_HEADERS;

  if(!sheet){
    sheet =
      ss.insertSheet(
        PORTAL_ACCESS_V2.SHEETS.USER_ROLES
      );
    sheet
      .getRange(1,1,1,headers.length)
      .setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if(sheet.getLastRow() === 0){
    sheet
      .getRange(1,1,1,headers.length)
      .setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const existing =
    sheet
      .getRange(
        1,
        1,
        1,
        Math.max(
          sheet.getLastColumn(),
          headers.length
        )
      )
      .getDisplayValues()[0]
      .map(PAC_text_);

  for(let i=0;i<headers.length;i++){
    if(!existing[i]){
      sheet
        .getRange(1,i+1)
        .setValue(headers[i]);
    }else if(existing[i] !== headers[i]){
      throw new Error(
        "PAC_USER_ROLES_HEADER_MISMATCH|column=" +
        (i+1)
      );
    }
  }

  sheet.setFrozenRows(1);
  return sheet;
}


function PAC_migrateSingleRoleUsersToRoleAssignments_(){

  const userSheet =
    PAC_ensureUserAccessSchema_();
  const roleSheet =
    PAC_ensureUserRolesSchema_();

  const users =
    PAC_readSheetObjects_(userSheet);
  const roles =
    PAC_readSheetObjects_(roleSheet);

  const seen = {};
  roles.forEach(function(row){
    const userId = PAC_text_(row["User ID"]);
    const role = PAC_role_(row["Role"]);
    if(userId && role){
      seen[userId + "|" + role] = true;
    }
  });

  const now = new Date();
  const rows = [];

  users.forEach(function(row){

    const userId = PAC_text_(row["User ID"]);
    const email = PAC_email_(row["Email"]);
    const role = PAC_role_(row["Role"]);

    if(
      !userId ||
      !email ||
      !role ||
      seen[userId + "|" + role]
    ){
      return;
    }

    let teamId = "";
    let resourceId = "";

    if(role === "ADMIN"){
      teamId =
        PAC_text_(row["Primary Team ID"]);
    }else if(role === "HANDLER"){
      resourceId =
        PAC_text_(row["Handler ID"]);
      const item =
        resourceId
          ? PAC_findHandlerById_(resourceId)
          : null;
      teamId =
        item && item.teamId
          ? item.teamId
          : PAC_text_(row["Primary Team ID"]);
    }else if(role === "SETUP_SUPPORT"){
      resourceId =
        PAC_text_(row["Support ID"]);
      const item =
        resourceId
          ? PAC_findSupportById_(resourceId)
          : null;
      teamId =
        item
          ? PAC_text_(
              item.teamId ||
              item.teamScope
            )
          : PAC_text_(row["Primary Team ID"]);
    }else if(role === "TECH_SUPPORT"){
      resourceId =
        PAC_text_(row["Technical Support ID"]);
      const item =
        resourceId
          ? PAC_findTechnicalSupportById_(resourceId)
          : null;
      teamId =
        item
          ? PAC_text_(item.teamId)
          : PAC_text_(row["Primary Team ID"]);
    }

    rows.push([
      "UR-" +
        PAC_shortHash_(
          userId + "|" + role
        ),
      userId,
      email,
      role,
      teamId,
      resourceId,
      true,
      "Migrated from V2 User Access default role",
      now,
      now
    ]);

    seen[userId + "|" + role] = true;
  });

  if(rows.length){
    roleSheet
      .getRange(
        roleSheet.getLastRow()+1,
        1,
        rows.length,
        PORTAL_ACCESS_V2.USER_ROLES_HEADERS.length
      )
      .setValues(rows);
  }

  return {
    created: rows.length
  };
}


function PAC_roleAssignmentsForUser_(
  userId,
  email,
  userAccessRow
){

  const id = PAC_text_(userId);
  const mail = PAC_email_(email);
  const sheet =
    PAC_backend_()
      .getSheetByName(
        PORTAL_ACCESS_V2.SHEETS.USER_ROLES
      );

  let result = [];

  if(sheet && sheet.getLastRow() >= 2){
    result =
      PAC_readSheetObjects_(sheet)
        .filter(function(row){
          const rowUserId =
            PAC_text_(row["User ID"]);
          const rowEmail =
            PAC_email_(row["Email"]);
          return (
            (id && rowUserId === id) ||
            (!id && mail && rowEmail === mail)
          );
        })
        .map(function(row){
          return {
            assignmentId:
              PAC_text_(row["User Role ID"]),
            role:
              PAC_role_(row["Role"]),
            teamId:
              PAC_text_(row["Team ID"]),
            resourceId:
              PAC_text_(row["Resource ID"]),
            active:
              PAC_active_(row["Active"]),
            notes:
              PAC_text_(row["Notes"]),
            source:
              "V2_USER_ROLES"
          };
        })
        .filter(function(item){
          return Boolean(item.role);
        });
  }

  if(!result.length && userAccessRow){
    const role =
      PAC_role_(
        userAccessRow["Role"]
      );
    if(role){
      let teamId =
        PAC_text_(
          userAccessRow["Primary Team ID"]
        );
      let resourceId = "";

      if(role === "HANDLER"){
        resourceId =
          PAC_text_(
            userAccessRow["Handler ID"]
          );
      }else if(role === "SETUP_SUPPORT"){
        resourceId =
          PAC_text_(
            userAccessRow["Support ID"]
          );
      }else if(role === "TECH_SUPPORT"){
        resourceId =
          PAC_text_(
            userAccessRow["Technical Support ID"]
          );
      }

      result.push({
        assignmentId: "",
        role: role,
        teamId: teamId,
        resourceId: resourceId,
        active: true,
        notes: "",
        source:
          "V2_USER_ACCESS_FALLBACK"
      });
    }
  }

  return result;
}


function PAC_defaultRoleFromRow_(
  row,
  availableRoles
){

  const preferred =
    PAC_role_(row["Role"]);

  if(
    preferred &&
    availableRoles.indexOf(preferred) !== -1
  ){
    return preferred;
  }

  return PAC_defaultRoleFromList_(
    availableRoles
  );
}


function PAC_defaultRoleForActor_(actor){

  if(
    actor &&
    actor.accessRole &&
    Array.isArray(actor.availableRoles) &&
    actor.availableRoles.indexOf(
      actor.accessRole
    ) !== -1
  ){
    return actor.accessRole;
  }

  return PAC_defaultRoleFromList_(
    actor &&
    Array.isArray(actor.availableRoles)
      ? actor.availableRoles
      : []
  );
}


function PAC_defaultRoleFromList_(roles){

  const list =
    Array.isArray(roles)
      ? roles
      : [];

  const priority = [
    "SUPER_ADMIN",
    "ADMIN",
    "HANDLER",
    "SETUP_SUPPORT",
    "TECH_SUPPORT"
  ];

  for(let i=0;i<priority.length;i++){
    if(list.indexOf(priority[i]) !== -1){
      return priority[i];
    }
  }

  return "";
}


function PAC_identityForRole_(
  actor,
  role
){

  const requested =
    PAC_role_(role);

  if(
    !actor ||
    !requested ||
    !Array.isArray(actor.availableRoles) ||
    actor.availableRoles.indexOf(requested) === -1
  ){
    return null;
  }

  const assignment =
    (actor.roleAssignments || [])
      .find(function(item){
        return (
          item.active === true &&
          item.role === requested
        );
      }) ||
    {
      role: requested,
      teamId: "",
      resourceId: "",
      active: true
    };

  const row =
    PAC_userAccessRecordByEmail_(
      actor.email
    );

  if(!row){
    const copy = PAC_copy_(actor);
    copy.accessRole = requested;
    return copy;
  }

  const identity =
    PAC_identityFromUserAccess_(
      row,
      assignment,
      null
    );

  identity.availableRoles =
    actor.availableRoles.slice();
  identity.roleAssignments =
    (actor.roleAssignments || [])
      .map(function(item){
        return PAC_copy_(item);
      });

  return identity;
}


function PAC_actorHasRole_(
  actor,
  role
){

  const requested =
    PAC_role_(role);

  return Boolean(
    actor &&
    requested &&
    Array.isArray(actor.availableRoles) &&
    actor.availableRoles.indexOf(requested) !== -1
  );
}


function PAC_publicRoleAssignments_(items){

  return (items || [])
    .filter(function(item){
      return item && item.active === true;
    })
    .map(function(item){
      return {
        role: item.role || "",
        roleLabel:
          PAC_roleLabel_(item.role),
        teamId:
          item.teamId || "",
        teamName:
          PAC_teamName_(item.teamId || ""),
        resourceId:
          item.resourceId || ""
      };
    });
}


function PAC_readCurrentRole_(token){

  const t = PAC_text_(token);
  if(!t) return "";

  return PAC_role_(
    PropertiesService
      .getScriptProperties()
      .getProperty(
        PAC_currentRoleKey_(t)
      )
  );
}


function PAC_writeCurrentRole_(
  token,
  role
){

  const t = PAC_text_(token);
  const r = PAC_role_(role);

  if(!t || !r) return;

  PropertiesService
    .getScriptProperties()
    .setProperty(
      PAC_currentRoleKey_(t),
      r
    );
}


function PAC_currentRoleKey_(token){
  return (
    PORTAL_ACCESS_V2.CURRENT_ROLE_PREFIX +
    PAC_shortHash_(token)
  );
}


function PAC_clearCurrentRoleForToken_(token){

  const t = PAC_text_(token);
  if(!t) return;

  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      PAC_currentRoleKey_(t)
    );
}

/******************************************************
 * PRIVATE — TEST VIEW TARGET RESOLUTION
 ******************************************************/
function PAC_resolveTestTarget_(
  role,
  targetId
){

  const r = PAC_role_(role);
  const id = PAC_text_(targetId);

  if(r === "ADMIN"){
    const item = PAC_findTeamById_(id);
    if(!item) return null;
    return {
      targetId: item.id,
      identity: {
        userId: "TEST-ADMIN-" + item.id,
        email: "",
        officialName: item.name + " Admin",
        accessRole: "ADMIN",
        primaryTeamId: item.id,
        teamName: item.name,
        handlerId: "",
        handlerName: "",
        supportId: "",
        supportName: "",
        teamScope: "",
        technicalSupportId: "",
        technicalSupportName: "",
        developerCapable: false,
        screenOperatorCapable: false,
        developerId: "",
        developerName: "",
        operatorId: "",
        operatorName: "",
        active: true,
        source: "TEST_VIEW"
      }
    };
  }

  if(r === "HANDLER"){
    const item = PAC_findHandlerById_(id);
    if(!item) return null;
    return {
      targetId: item.id,
      identity: {
        userId: "TEST-HANDLER-" + item.id,
        email: "",
        officialName: item.name,
        accessRole: "HANDLER",
        primaryTeamId: item.teamId || "",
        teamName: item.teamName || PAC_teamName_(item.teamId || ""),
        handlerId: item.id,
        handlerName: item.name,
        supportId: "",
        supportName: "",
        teamScope: "",
        technicalSupportId: "",
        technicalSupportName: "",
        developerCapable: false,
        screenOperatorCapable: false,
        developerId: "",
        developerName: "",
        operatorId: "",
        operatorName: "",
        active: true,
        source: "TEST_VIEW"
      }
    };
  }

  if(r === "SETUP_SUPPORT"){
    const item = PAC_findSupportById_(id);
    if(!item) return null;
    return {
      targetId: item.id,
      identity: {
        userId: "TEST-SUPPORT-" + item.id,
        email: "",
        officialName: item.name,
        accessRole: "SETUP_SUPPORT",
        primaryTeamId: item.teamId || item.teamScope || "",
        teamName: PAC_teamName_(item.teamId || item.teamScope || ""),
        handlerId: "",
        handlerName: "",
        supportId: item.id,
        supportName: item.name,
        teamScope: item.teamScope,
        technicalSupportId: "",
        technicalSupportName: "",
        developerCapable: false,
        screenOperatorCapable: false,
        developerId: "",
        developerName: "",
        operatorId: "",
        operatorName: "",
        active: true,
        source: "TEST_VIEW"
      }
    };
  }

  if(r === "TECH_SUPPORT"){
    const item = PAC_findTechnicalSupportById_(id);
    if(!item) return null;
    return {
      targetId: item.id,
      identity: {
        userId: "TEST-TECH-" + item.id,
        email: "",
        officialName: item.name,
        accessRole: "TECH_SUPPORT",
        primaryTeamId: item.teamId || "",
        teamName: item.teamName || PAC_teamName_(item.teamId || ""),
        handlerId: "",
        handlerName: "",
        supportId: "",
        supportName: "",
        teamScope: "",
        technicalSupportId: item.id,
        technicalSupportName: item.name,
        developerCapable: item.developerCapable === true,
        screenOperatorCapable:
          item.screenOperatorCapable === true,
        developerId: item.legacyDeveloperId || "",
        developerName: "",
        operatorId: item.legacyOperatorId || "",
        operatorName: "",
        active: true,
        source: "TEST_VIEW"
      }
    };
  }

  return null;
}


function PAC_testViewLabel_(identity){

  const role =
    PAC_roleLabel_(identity.accessRole);

  const parts = [role];

  if(identity.officialName){
    parts.push(identity.officialName);
  }
  if(identity.teamName){
    parts.push(identity.teamName);
  }else if(identity.teamScope){
    parts.push(identity.teamScope);
  }

  return parts.join(" • ");
}


function PAC_readTestView_(token){

  const raw =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        PAC_testViewKey_(token)
      );

  if(!raw){
    return null;
  }

  try{
    const state = JSON.parse(raw);
    if(
      !state ||
      !PAC_role_(state.role) ||
      !state.targetId
    ){
      return null;
    }
    return state;
  }catch(error){
    PAC_clearTestViewForToken_(token);
    return null;
  }
}


function PAC_clearTestViewForToken_(token){

  const t = PAC_text_(token);
  if(!t) return;

  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      PAC_testViewKey_(t)
    );
}


function PAC_testViewKey_(token){
  return (
    PORTAL_ACCESS_V2.TEST_VIEW_PREFIX +
    PAC_shortHash_(token)
  );
}


/******************************************************
 * PRIVATE — SUPER ADMIN GUARD
 ******************************************************/
function PAC_requireRealSuperAdminContext_(token){

  const auth =
    PA_validateSession_(token);

  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const context =
    auth.accessContext ||
    PAC_buildContextFromAuth_(auth,token);

  if(
    !context.actor ||
    !PAC_actorHasRole_(
      context.actor,
      "SUPER_ADMIN"
    )
  ){
    throw new Error("SUPER_ADMIN_ACCESS_REQUIRED");
  }

  if(context.currentRole !== "SUPER_ADMIN"){
    throw new Error("SWITCH_TO_SUPER_ADMIN_ROLE_REQUIRED");
  }

  return context;
}


/******************************************************
 * PRIVATE — V2 USER ACCESS SCHEMA / LEGACY SYNC
 ******************************************************/
function PAC_ensureUserAccessSchema_(){

  const ss = PAC_backend_();
  let sheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.USER_ACCESS
    );

  const required =
    PORTAL_ACCESS_V2.USER_ACCESS_BASE_HEADERS
      .concat(
        PORTAL_ACCESS_V2.USER_ACCESS_EXTRA_HEADERS
      );

  if(!sheet){
    sheet = ss.insertSheet(
      PORTAL_ACCESS_V2.SHEETS.USER_ACCESS
    );
    sheet.getRange(1,1,1,required.length)
      .setValues([required]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,required.length)
      .setValues([required]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const base =
    sheet
      .getRange(
        1,
        1,
        1,
        PORTAL_ACCESS_V2.USER_ACCESS_BASE_HEADERS.length
      )
      .getDisplayValues()[0]
      .map(PAC_text_);

  for(
    let i=0;
    i<PORTAL_ACCESS_V2.USER_ACCESS_BASE_HEADERS.length;
    i++
  ){
    if(
      base[i] !==
      PORTAL_ACCESS_V2.USER_ACCESS_BASE_HEADERS[i]
    ){
      throw new Error(
        "PAC_USER_ACCESS_BASE_HEADER_MISMATCH|column=" +
        (i+1)
      );
    }
  }

  let headers =
    sheet
      .getRange(
        1,
        1,
        1,
        Math.max(
          sheet.getLastColumn(),
          PORTAL_ACCESS_V2.USER_ACCESS_BASE_HEADERS.length
        )
      )
      .getDisplayValues()[0]
      .map(PAC_text_);

  PORTAL_ACCESS_V2.USER_ACCESS_EXTRA_HEADERS
    .forEach(function(header){
      if(headers.indexOf(header) === -1){
        const col = sheet.getLastColumn() + 1;
        sheet.getRange(1,col).setValue(header);
        headers.push(header);
      }
    });

  sheet.setFrozenRows(1);
  return sheet;
}


function PAC_promoteCurrentLegacyAdmin_(
  sheet,
  email
){

  const legacy =
    PAC_readLegacyPortalUser_(email);

  if(!legacy || legacy.role !== "Admin"){
    return false;
  }

  const data =
    sheet.getDataRange().getValues();
  if(!data.length) return false;

  const headers =
    PAC_headerMap_(data[0]);

  const emailCol = headers["email"];
  const roleCol = headers["role"];

  if(emailCol === undefined || roleCol === undefined){
    throw new Error("PAC_USER_ACCESS_REQUIRED_COLUMNS_MISSING");
  }

  for(let i=1;i<data.length;i++){
    if(
      PAC_email_(data[i][emailCol]) ===
      PAC_email_(email)
    ){
      const existingRole =
        PAC_role_(data[i][roleCol]);

      if(existingRole !== "SUPER_ADMIN"){
        sheet
          .getRange(i+1,roleCol+1)
          .setValue("SUPER_ADMIN");
        return true;
      }
      return false;
    }
  }

  return false;
}


function PAC_syncLegacyPortalUsers_(sheet){

  const result = {
    added: 0,
    skipped: 0,
    unresolvedHandlers: 0
  };

  let legacySheet;
  try{
    legacySheet = portalUsers_();
  }catch(error){
    return result;
  }

  const values =
    legacySheet.getDataRange().getValues();

  if(values.length < 2){
    return result;
  }

  const legacyHeaders =
    PAC_headerMap_(values[0]);

  const eCol = legacyHeaders["email"];
  const hCol = legacyHeaders["handler"];
  const rCol = legacyHeaders["role"];
  const aCol = legacyHeaders["active"];

  if(
    eCol === undefined ||
    rCol === undefined ||
    aCol === undefined
  ){
    return result;
  }

  const current =
    PAC_readSheetObjects_(sheet);

  const knownEmails = {};
  current.forEach(function(row){
    const e = PAC_email_(row["Email"]);
    if(e) knownEmails[e] = true;
  });

  const headers =
    sheet
      .getRange(1,1,1,sheet.getLastColumn())
      .getDisplayValues()[0]
      .map(PAC_text_);

  const rowsToAdd = [];

  for(let i=1;i<values.length;i++){

    if(!PAC_active_(values[i][aCol])){
      continue;
    }

    const email = PAC_email_(values[i][eCol]);
    if(!email) continue;

    if(knownEmails[email]){
      result.skipped++;
      continue;
    }

    const legacyRole =
      PAC_legacyRole_(values[i][rCol]);

    if(!legacyRole) continue;

    const handlerName =
      hCol === undefined
        ? ""
        : PAC_text_(values[i][hCol]);

    let role = "";
    let handlerId = "";
    let teamId = "";

    if(legacyRole === "Admin"){
      // Existing legacy Admins historically had global access.
      // Keep that privilege during migration.
      role = "SUPER_ADMIN";
    }else if(legacyRole === "Handler"){
      role = "HANDLER";
      const handler =
        PAC_findHandlerByName_(handlerName);
      if(handler){
        handlerId = handler.id;
        teamId = handler.teamId;
      }else{
        result.unresolvedHandlers++;
      }
    }

    const record = {
      "User ID": "USR-" + PAC_shortHash_(email),
      "Email": email,
      "Official Name":
        handlerName || PAC_emailLocal_(email),
      "Role": role,
      "Primary Team ID": teamId,
      "Handler ID": handlerId,
      "Support ID": "",
      "Active": true,
      "Notes": "Synced from legacy Portal Users",
      "Developer ID": "",
      "Operator ID": ""
    };

    rowsToAdd.push(
      headers.map(function(header){
        return record[header] !== undefined
          ? record[header]
          : "";
      })
    );

    knownEmails[email] = true;
  }

  if(rowsToAdd.length){
    sheet
      .getRange(
        sheet.getLastRow()+1,
        1,
        rowsToAdd.length,
        headers.length
      )
      .setValues(rowsToAdd);
    result.added = rowsToAdd.length;
  }

  return result;
}



/******************************************************
 * PRIVATE — TECHNICAL SUPPORT MASTER
 *
 * Developer and Screen Operator are one common resource
 * sector. The two duties remain independent call-level
 * assignments/capabilities.
 *
 * Legacy Developer/Screen Operator masters are preserved
 * unchanged for historical references.
 ******************************************************/
function PAC_ensureTechnicalSupportMaster_(){

  const ss = PAC_backend_();
  const name =
    PORTAL_ACCESS_V2.SHEETS.TECH_SUPPORT_MASTER;

  const headers = [
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
  ];

  let sheet = ss.getSheetByName(name);

  if(!sheet){
    sheet = ss.insertSheet(name);
    sheet.getRange(1,1,1,headers.length)
      .setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,headers.length)
      .setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const existing =
    sheet
      .getRange(
        1,1,1,
        Math.max(sheet.getLastColumn(),headers.length)
      )
      .getDisplayValues()[0]
      .map(PAC_text_);

  for(let i=0;i<headers.length;i++){
    if(!existing[i]){
      sheet.getRange(1,i+1).setValue(headers[i]);
    }else if(existing[i] !== headers[i]){
      throw new Error(
        "TECH_SUPPORT_HEADER_MISMATCH|column=" + (i+1)
      );
    }
  }

  sheet.setFrozenRows(1);
  return sheet;
}


function PAC_nextTechnicalSupportId_(sheet){

  if(!sheet || sheet.getLastRow() < 2){
    return "TS-000001";
  }

  const rows =
    sheet.getDataRange().getDisplayValues();

  const headers = PAC_headerMap_(rows[0] || []);
  const col = headers["technical support id"];

  let max = 0;
  if(col !== undefined){
    for(let i=1;i<rows.length;i++){
      const match =
        PAC_text_(rows[i][col])
          .match(/^TS-(\d+)$/i);
      if(match){
        max = Math.max(max,Number(match[1]) || 0);
      }
    }
  }

  return "TS-" + String(max+1).padStart(6,"0");
}


function PAC_migrateLegacyTechnicalSupport_(){

  const ss = PAC_backend_();
  const userSheet = PAC_ensureUserAccessSchema_();
  const roleSheet = PAC_ensureUserRolesSchema_();
  const techSheet = PAC_ensureTechnicalSupportMaster_();

  const users =
    PAC_readSheetObjects_(userSheet);

  const developerSheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.DEVELOPER_MASTER
    );
  const operatorSheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.OPERATOR_MASTER
    );

  const developers =
    developerSheet && developerSheet.getLastRow() >= 2
      ? PAC_readSheetObjects_(developerSheet)
      : [];
  const operators =
    operatorSheet && operatorSheet.getLastRow() >= 2
      ? PAC_readSheetObjects_(operatorSheet)
      : [];

  const devById = {};
  developers.forEach(function(row){
    const id = PAC_text_(row["Developer ID"]);
    if(id) devById[id] = row;
  });

  const opById = {};
  operators.forEach(function(row){
    const id = PAC_text_(row["Operator ID"]);
    if(id) opById[id] = row;
  });

  const techRows =
    techSheet.getLastRow() >= 2
      ? PAC_readSheetObjects_(techSheet)
      : [];

  const techById = {};
  const techByEmail = {};
  const techByName = {};

  techRows.forEach(function(row){
    const id = PAC_text_(row["Technical Support ID"]);
    const email = PAC_email_(row["Email"]);
    const name = PAC_key_(row["Technical Support Name"]);
    if(id) techById[id] = row;
    if(email) techByEmail[email] = row;
    if(name) techByName[name] = row;
  });

  const userValues =
    userSheet.getDataRange().getValues();
  const uh = PAC_headerMap_(userValues[0] || []);

  const roleValues =
    roleSheet.getDataRange().getValues();
  const rh = PAC_headerMap_(roleValues[0] || []);

  let created = 0;
  let linkedUsers = 0;
  let roleAssignmentsUpdated = 0;
  let duplicatesDeactivated = 0;

  users.forEach(function(user){

    const userId = PAC_text_(user["User ID"]);
    const email = PAC_email_(user["Email"]);
    const name =
      PAC_text_(user["Official Name"]) ||
      PAC_emailLocal_(email);

    const legacyDevId =
      PAC_text_(user["Developer ID"]);
    const legacyOpId =
      PAC_text_(user["Operator ID"]);
    let technicalId =
      PAC_text_(user["Technical Support ID"]);

    const dev =
      legacyDevId ? devById[legacyDevId] || null : null;
    const op =
      legacyOpId ? opById[legacyOpId] || null : null;

    let legacyDeveloperRole =
      PAC_key_(user["Role"]) === "developer";

    let legacyScreenRole =
      [
        "screen operator",
        "screenoperator",
        "operator"
      ].indexOf(
        PAC_key_(user["Role"])
      ) !== -1;

    for(let ri=1;ri<roleValues.length;ri++){
      const rowUserId =
        PAC_text_(roleValues[ri][rh["user id"]]);
      const rowEmail =
        PAC_email_(roleValues[ri][rh["email"]]);

      if(
        !(
          (userId && rowUserId === userId) ||
          (!userId && email && rowEmail === email)
        )
      ){
        continue;
      }

      const raw =
        PAC_key_(
          roleValues[ri][rh["role"]]
        );

      if(raw === "developer"){
        legacyDeveloperRole = true;
      }

      if(
        [
          "screen operator",
          "screenoperator",
          "operator"
        ].indexOf(raw) !== -1
      ){
        legacyScreenRole = true;
      }
    }

    const developerCapability =
      Boolean(
        legacyDevId ||
        legacyDeveloperRole
      );

    const screenCapability =
      Boolean(
        legacyOpId ||
        legacyScreenRole
      );

    const hasLegacy =
      Boolean(
        developerCapability ||
        screenCapability
      );

    const assignments =
      PAC_roleAssignmentsForUser_(
        userId,
        email,
        user
      );

    const hasTechnicalRole =
      assignments.some(function(item){
        return (
          item.active === true &&
          PAC_role_(item.role) === "TECH_SUPPORT"
        );
      });

    if(!hasLegacy && !technicalId && !hasTechnicalRole){
      return;
    }

    let tech =
      technicalId
        ? techById[technicalId] || null
        : null;

    if(!tech && email){
      tech = techByEmail[email] || null;
    }
    if(!tech && name){
      tech = techByName[PAC_key_(name)] || null;
    }

    const teamId =
      PAC_text_(
        (dev && dev["Home Team ID"]) ||
        (op && op["Home Team ID"]) ||
        user["Primary Team ID"]
      );

    if(!tech){
      technicalId =
        PAC_nextTechnicalSupportId_(techSheet);

      const row = [
        technicalId,
        name,
        teamId,
        developerCapability,
        screenCapability,
        true,
        "Migrated to combined Technical Support sector",
        email,
        legacyDevId,
        legacyOpId
      ];

      techSheet
        .getRange(
          techSheet.getLastRow()+1,
          1,
          1,
          row.length
        )
        .setValues([row]);

      tech = {
        "Technical Support ID": technicalId,
        "Technical Support Name": name,
        "Home Team ID": teamId,
        "Developer Capability": developerCapability,
        "Screen Operator Capability": screenCapability,
        "Active": true,
        "Notes": "Migrated to combined Technical Support sector",
        "Email": email,
        "Legacy Developer ID": legacyDevId,
        "Legacy Operator ID": legacyOpId
      };

      techById[technicalId] = tech;
      if(email) techByEmail[email] = tech;
      if(name) techByName[PAC_key_(name)] = tech;
      created++;
    }else{
      technicalId =
        PAC_text_(tech["Technical Support ID"]);

      const rows =
        techSheet.getDataRange().getValues();
      const th = PAC_headerMap_(rows[0] || []);

      for(let i=1;i<rows.length;i++){
        if(
          PAC_text_(rows[i][th["technical support id"]]) !==
          technicalId
        ){
          continue;
        }

        if(
          developerCapability &&
          th["developer capability"] !== undefined
        ){
          techSheet
            .getRange(i+1,th["developer capability"]+1)
            .setValue(true);
        }

        if(
          screenCapability &&
          th["screen operator capability"] !== undefined
        ){
          techSheet
            .getRange(i+1,th["screen operator capability"]+1)
            .setValue(true);
        }

        if(
          legacyDevId &&
          th["legacy developer id"] !== undefined
        ){
          techSheet
            .getRange(i+1,th["legacy developer id"]+1)
            .setValue(legacyDevId);
        }

        if(
          legacyOpId &&
          th["legacy operator id"] !== undefined
        ){
          techSheet
            .getRange(i+1,th["legacy operator id"]+1)
            .setValue(legacyOpId);
        }

        break;
      }
    }

    if(
      technicalId &&
      uh["technical support id"] !== undefined
    ){
      for(let i=1;i<userValues.length;i++){
        if(
          PAC_text_(userValues[i][uh["user id"]]) === userId
        ){
          const current =
            PAC_text_(
              userValues[i][uh["technical support id"]]
            );
          if(current !== technicalId){
            userSheet
              .getRange(
                i+1,
                uh["technical support id"]+1
              )
              .setValue(technicalId);
            linkedUsers++;
          }
          break;
        }
      }
    }

    // Collapse any legacy Developer + Screen Operator assignments
    // into one active TECH_SUPPORT assignment.
    const matchingRows = [];

    for(let i=1;i<roleValues.length;i++){
      const rowUserId =
        PAC_text_(roleValues[i][rh["user id"]]);
      const rowEmail =
        PAC_email_(roleValues[i][rh["email"]]);

      if(
        !(
          (userId && rowUserId === userId) ||
          (!userId && email && rowEmail === email)
        )
      ){
        continue;
      }

      const rawRole =
        PAC_text_(roleValues[i][rh["role"]]);

      if(PAC_role_(rawRole) === "TECH_SUPPORT"){
        matchingRows.push(i);
      }
    }

    if(matchingRows.length){
      const first = matchingRows[0];

      roleSheet
        .getRange(first+1,rh["role"]+1)
        .setValue("TECH_SUPPORT");
      roleSheet
        .getRange(first+1,rh["team id"]+1)
        .setValue(teamId || "");
      roleSheet
        .getRange(first+1,rh["resource id"]+1)
        .setValue(technicalId || "");
      roleSheet
        .getRange(first+1,rh["active"]+1)
        .setValue(true);
      roleSheet
        .getRange(first+1,rh["updated at"]+1)
        .setValue(new Date());

      roleAssignmentsUpdated++;

      matchingRows.slice(1).forEach(function(index){
        roleSheet
          .getRange(index+1,rh["active"]+1)
          .setValue(false);
        roleSheet
          .getRange(index+1,rh["notes"]+1)
          .setValue(
            "Merged into TECH_SUPPORT assignment"
          );
        roleSheet
          .getRange(index+1,rh["updated at"]+1)
          .setValue(new Date());
        duplicatesDeactivated++;
      });
    }else if(technicalId){
      const now = new Date();
      const row = [
        "UR-" + PAC_shortHash_(userId + "|TECH_SUPPORT"),
        userId,
        email,
        "TECH_SUPPORT",
        teamId || "",
        technicalId,
        true,
        "Created during Technical Support migration",
        now,
        now
      ];
      roleSheet
        .getRange(
          roleSheet.getLastRow()+1,
          1,
          1,
          row.length
        )
        .setValues([row]);
      roleAssignmentsUpdated++;
    }
  });

  SpreadsheetApp.flush();

  return {
    created: created,
    linkedUsers: linkedUsers,
    roleAssignmentsUpdated: roleAssignmentsUpdated,
    duplicateLegacyAssignmentsDeactivated:
      duplicatesDeactivated
  };
}


/******************************************************
 * PRIVATE — HEALTH
 ******************************************************/
function PAC_accessHealth_(){

  const ss = PAC_backend_();

  const names = [
    PORTAL_ACCESS_V2.SHEETS.USER_ACCESS,
    PORTAL_ACCESS_V2.SHEETS.USER_ROLES,
    PORTAL_ACCESS_V2.SHEETS.TEAM_MASTER,
    PORTAL_ACCESS_V2.SHEETS.HANDLER_MASTER,
    PORTAL_ACCESS_V2.SHEETS.SUPPORT_MASTER,
    PORTAL_ACCESS_V2.SHEETS.DEVELOPER_MASTER,
    PORTAL_ACCESS_V2.SHEETS.OPERATOR_MASTER,
    PORTAL_ACCESS_V2.SHEETS.TECH_SUPPORT_MASTER
  ];

  const sheets = {};
  names.forEach(function(name){
    const sheet = ss.getSheetByName(name);
    sheets[name] = {
      found: Boolean(sheet),
      rows: sheet
        ? Math.max(0,sheet.getLastRow()-1)
        : 0
    };
  });

  const roleCounts = {};
  const duplicateEmails = [];
  const duplicateUserIds = [];
  const duplicateRoleAssignments = [];
  const emailSeen = {};
  const idSeen = {};
  const roleSeen = {};

  const userSheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.USER_ACCESS
    );

  const roleSheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.USER_ROLES
    );

  let developerIdColumnReady = false;
  let operatorIdColumnReady = false;
  let technicalSupportIdColumnReady = false;
  let baseHeadersOk = false;
  let userRolesSchemaOk = false;

  if(userSheet && userSheet.getLastRow() >= 1){

    const headers =
      userSheet
        .getRange(1,1,1,userSheet.getLastColumn())
        .getDisplayValues()[0]
        .map(PAC_text_);

    baseHeadersOk =
      PORTAL_ACCESS_V2.USER_ACCESS_BASE_HEADERS
        .every(function(header,index){
          return headers[index] === header;
        });

    developerIdColumnReady =
      headers.indexOf("Developer ID") !== -1;
    operatorIdColumnReady =
      headers.indexOf("Operator ID") !== -1;
    technicalSupportIdColumnReady =
      headers.indexOf("Technical Support ID") !== -1;

    PAC_readSheetObjects_(userSheet)
      .forEach(function(row){

        const email = PAC_email_(row["Email"]);
        if(email){
          if(emailSeen[email]) duplicateEmails.push(email);
          emailSeen[email] = true;
        }

        const userId = PAC_text_(row["User ID"]);
        if(userId){
          if(idSeen[userId]) duplicateUserIds.push(userId);
          idSeen[userId] = true;
        }
      });
  }

  if(roleSheet && roleSheet.getLastRow() >= 1){
    const headers =
      roleSheet
        .getRange(1,1,1,roleSheet.getLastColumn())
        .getDisplayValues()[0]
        .map(PAC_text_);

    userRolesSchemaOk =
      PORTAL_ACCESS_V2.USER_ROLES_HEADERS
        .every(function(header,index){
          return headers[index] === header;
        });

    PAC_readSheetObjects_(roleSheet)
      .forEach(function(row){
        const role = PAC_role_(row["Role"]);
        if(
          role &&
          PAC_active_(row["Active"])
        ){
          roleCounts[role] =
            (roleCounts[role] || 0) + 1;
        }

        const userId = PAC_text_(row["User ID"]);
        if(userId && role){
          const key = userId + "|" + role;
          if(roleSeen[key]){
            duplicateRoleAssignments.push(key);
          }
          roleSeen[key] = true;
        }
      });
  }else{
    // Before first multi-role initialization, report the legacy/default
    // role column so health remains informative.
    if(userSheet){
      PAC_readSheetObjects_(userSheet)
        .forEach(function(row){
          const role =
            PAC_role_(row["Role"]) ||
            "INVALID";
          roleCounts[role] =
            (roleCounts[role] || 0) + 1;
        });
    }
  }

  return {
    ok:
      Boolean(userSheet) &&
      baseHeadersOk &&
      developerIdColumnReady &&
      operatorIdColumnReady &&
      technicalSupportIdColumnReady &&
      Boolean(
        ss.getSheetByName(
          PORTAL_ACCESS_V2.SHEETS.TECH_SUPPORT_MASTER
        )
      ) &&
      duplicateEmails.length === 0 &&
      duplicateUserIds.length === 0 &&
      (
        !roleSheet ||
        userRolesSchemaOk
      ) &&
      duplicateRoleAssignments.length === 0,
    mode: "READ_ONLY_HEALTH",
    version: PORTAL_ACCESS_V2.VERSION,
    backend: ss.getName(),
    sheets: sheets,
    baseHeadersOk: baseHeadersOk,
    developerIdColumnReady: developerIdColumnReady,
    operatorIdColumnReady: operatorIdColumnReady,
    technicalSupportIdColumnReady:
      technicalSupportIdColumnReady,
    userRolesSchemaOk: userRolesSchemaOk,
    roleCounts: roleCounts,
    duplicateEmailCount: duplicateEmails.length,
    duplicateUserIdCount: duplicateUserIds.length,
    duplicateRoleAssignmentCount:
      duplicateRoleAssignments.length
  };
}


/******************************************************
 * PRIVATE — USER ACCESS / MASTER READERS
 ******************************************************/
function PAC_userAccessRecordByEmail_(email){

  const ss = PAC_backend_();
  const sheet =
    ss.getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.USER_ACCESS
    );

  if(!sheet || sheet.getLastRow() < 2){
    return null;
  }

  const target = PAC_email_(email);

  const rows = PAC_readSheetObjects_(sheet);
  for(let i=0;i<rows.length;i++){
    if(PAC_email_(rows[i]["Email"]) === target){
      return rows[i];
    }
  }

  return null;
}


function PAC_teamOptions_(){
  return PAC_masterOptions_(
    PORTAL_ACCESS_V2.SHEETS.TEAM_MASTER,
    "Team ID",
    "Team Name",
    function(row){
      return {
        id: PAC_text_(row["Team ID"]),
        name: PAC_text_(row["Team Name"]),
        supportMode: PAC_text_(row["Support Mode"])
      };
    }
  );
}


function PAC_handlerOptions_(){
  return PAC_masterOptions_(
    PORTAL_ACCESS_V2.SHEETS.HANDLER_MASTER,
    "Handler ID",
    "Handler Name",
    function(row){
      return {
        id: PAC_text_(row["Handler ID"]),
        name: PAC_text_(row["Handler Name"]),
        teamId: PAC_text_(row["Team ID"]),
        teamName: PAC_teamName_(row["Team ID"])
      };
    }
  );
}


function PAC_supportOptions_(){
  return PAC_masterOptions_(
    PORTAL_ACCESS_V2.SHEETS.SUPPORT_MASTER,
    "Support ID",
    "Support Name",
    function(row){
      const teamId =
        PAC_text_(row["Team Scope"]);
      return {
        id: PAC_text_(row["Support ID"]),
        name: PAC_text_(row["Support Name"]),
        teamId: teamId,
        teamName: PAC_teamName_(teamId),
        teamScope: teamId
      };
    }
  );
}


function PAC_developerOptions_(){
  return PAC_masterOptions_(
    PORTAL_ACCESS_V2.SHEETS.DEVELOPER_MASTER,
    "Developer ID",
    "Developer Name",
    function(row){
      const teamId =
        PAC_text_(row["Home Team ID"]);
      return {
        id: PAC_text_(row["Developer ID"]),
        name: PAC_text_(row["Developer Name"]),
        teamId: teamId,
        teamName: PAC_teamName_(teamId)
      };
    }
  );
}


function PAC_operatorOptions_(){
  return PAC_masterOptions_(
    PORTAL_ACCESS_V2.SHEETS.OPERATOR_MASTER,
    "Operator ID",
    "Operator Name",
    function(row){
      const teamId =
        PAC_text_(row["Home Team ID"]);
      return {
        id: PAC_text_(row["Operator ID"]),
        name: PAC_text_(row["Operator Name"]),
        teamId: teamId,
        teamName: PAC_teamName_(teamId)
      };
    }
  );
}


function PAC_technicalSupportOptions_(){

  const sheet =
    PAC_backend_().getSheetByName(
      PORTAL_ACCESS_V2.SHEETS.TECH_SUPPORT_MASTER
    );

  if(!sheet || sheet.getLastRow() < 2){
    return [];
  }

  return PAC_readSheetObjects_(sheet)
    .filter(function(row){
      return (
        PAC_active_(row["Active"]) &&
        PAC_text_(row["Technical Support ID"]) &&
        PAC_text_(row["Technical Support Name"])
      );
    })
    .map(function(row){
      const teamId =
        PAC_text_(row["Home Team ID"]);
      return {
        id: PAC_text_(row["Technical Support ID"]),
        name: PAC_text_(row["Technical Support Name"]),
        teamId: teamId,
        teamName: PAC_teamName_(teamId),
        email: PAC_email_(row["Email"]),
        developerCapable:
          PAC_active_(row["Developer Capability"]),
        screenOperatorCapable:
          PAC_active_(row["Screen Operator Capability"]),
        capabilities: [
          PAC_active_(row["Developer Capability"])
            ? "DEVELOPER"
            : "",
          PAC_active_(row["Screen Operator Capability"])
            ? "SCREEN_OPERATOR"
            : ""
        ].filter(Boolean),
        legacyDeveloperId:
          PAC_text_(row["Legacy Developer ID"]),
        legacyOperatorId:
          PAC_text_(row["Legacy Operator ID"])
      };
    })
    .sort(function(a,b){
      return String(a.name || "")
        .localeCompare(String(b.name || ""));
    });
}


function PAC_findTechnicalSupportById_(id){
  const target = PAC_text_(id);
  if(!target) return null;
  return PAC_technicalSupportOptions_()
    .find(function(item){
      return item.id === target;
    }) || null;
}


function PAC_masterOptions_(
  sheetName,
  idHeader,
  nameHeader,
  mapper
){

  const cacheKey =
    "MASTER|" +
    PAC_text_(
      sheetName
    );


  if(
    Object.prototype.hasOwnProperty.call(
      PAC_FAST_MASTER_OPTIONS_MEMO_,
      cacheKey
    )
  ){

    return PAC_FAST_MASTER_OPTIONS_MEMO_[
      cacheKey
    ];

  }


  const sheet =
    PAC_backend_()
      .getSheetByName(
        sheetName
      );


  if(
    !sheet ||
    sheet.getLastRow() < 2
  ){

    PAC_FAST_MASTER_OPTIONS_MEMO_[
      cacheKey
    ] = [];

    return [];

  }


  const result =
    PAC_readSheetObjects_(
      sheet
    )
    .filter(
      function(row){

        return (
          PAC_active_(
            row["Active"]
          ) &&
          PAC_text_(
            row[idHeader]
          ) &&
          PAC_text_(
            row[nameHeader]
          )
        );

      }
    )
    .map(
      mapper
    )
    .sort(
      function(a,b){

        return String(
          a.name || ""
        )
        .localeCompare(
          String(
            b.name || ""
          )
        );

      }
    );


  PAC_FAST_MASTER_OPTIONS_MEMO_[
    cacheKey
  ] = result;


  return result;

}


function PAC_findTeamById_(id){
  const target = PAC_text_(id);
  if(!target) return null;
  const rows = PAC_teamOptions_();
  return rows.find(function(item){
    return item.id === target;
  }) || null;
}


function PAC_findHandlerById_(id){
  const target = PAC_text_(id);
  if(!target) return null;
  const rows = PAC_handlerOptions_();
  return rows.find(function(item){
    return item.id === target;
  }) || null;
}


function PAC_findHandlerByName_(name){
  const target = PAC_key_(name);
  if(!target) return null;
  const rows = PAC_handlerOptions_();
  return rows.find(function(item){
    return PAC_key_(item.name) === target;
  }) || null;
}


function PAC_findSupportById_(id){
  const target = PAC_text_(id);
  if(!target) return null;
  return PAC_supportOptions_().find(function(item){
    return item.id === target;
  }) || null;
}


function PAC_findDeveloperById_(id){
  const target = PAC_text_(id);
  if(!target) return null;
  return PAC_developerOptions_().find(function(item){
    return item.id === target;
  }) || null;
}


function PAC_findOperatorById_(id){
  const target = PAC_text_(id);
  if(!target) return null;
  return PAC_operatorOptions_().find(function(item){
    return item.id === target;
  }) || null;
}


function PAC_teamName_(teamId){
  const target = PAC_text_(teamId);
  if(!target) return "";
  const item = PAC_findTeamById_(target);
  return item ? item.name : "";
}


/******************************************************
 * PRIVATE — LEGACY PORTAL USERS
 ******************************************************/
function PAC_readLegacyPortalUser_(email){

  let sheet;
  try{
    sheet = portalUsers_();
  }catch(error){
    return null;
  }

  const values = sheet.getDataRange().getValues();
  if(values.length < 2) return null;

  const headers = PAC_headerMap_(values[0]);
  const eCol = headers["email"];
  const hCol = headers["handler"];
  const rCol = headers["role"];
  const aCol = headers["active"];

  if(
    eCol === undefined ||
    rCol === undefined ||
    aCol === undefined
  ){
    return null;
  }

  const target = PAC_email_(email);

  for(let i=1;i<values.length;i++){
    if(PAC_email_(values[i][eCol]) !== target){
      continue;
    }

    if(!PAC_active_(values[i][aCol])){
      return null;
    }

    const role = PAC_legacyRole_(values[i][rCol]);
    if(!role) return null;

    return {
      email: target,
      handler:
        hCol === undefined
          ? ""
          : PAC_text_(values[i][hCol]),
      role: role,
      active: true
    };
  }

  return null;
}


/******************************************************
 * PRIVATE — PUBLIC IDENTITY SANITIZER
 ******************************************************/
function PAC_publicIdentity_(identity){

  if(!identity){
    return {};
  }

  return {
    userId: identity.userId || "",
    email: identity.email || "",
    officialName: identity.officialName || "",
    accessRole: identity.accessRole || "",
    roleLabel:
      PAC_roleLabel_(identity.accessRole),
    primaryTeamId: identity.primaryTeamId || "",
    teamName: identity.teamName || "",
    handlerId: identity.handlerId || "",
    handlerName: identity.handlerName || "",
    supportId: identity.supportId || "",
    supportName: identity.supportName || "",
    teamScope: identity.teamScope || "",
    technicalSupportId: identity.technicalSupportId || "",
    technicalSupportName: identity.technicalSupportName || "",
    developerCapable: identity.developerCapable === true,
    screenOperatorCapable:
      identity.screenOperatorCapable === true,

    // Retained only so historical modules can continue reading old IDs.
    developerId: identity.developerId || "",
    developerName: identity.developerName || "",
    operatorId: identity.operatorId || "",
    operatorName: identity.operatorName || "",

    active: identity.active === true,
    source: identity.source || ""
  };
}


/******************************************************
 * PRIVATE — GENERIC HELPERS
 ******************************************************/
function PAC_backend_(){

  if(PAC_FAST_BACKEND_MEMO_){
    return PAC_FAST_BACKEND_MEMO_;
  }

  if(typeof portalBackend_ === "function"){
    PAC_FAST_BACKEND_MEMO_ =
      portalBackend_();

    return PAC_FAST_BACKEND_MEMO_;
  }

  throw new Error("PAC_PRIVATE_BACKEND_ROUTER_NOT_FOUND");
}


function PAC_readSheetObjects_(sheet){

  const values = sheet.getDataRange().getValues();
  if(!values.length) return [];

  const headers = values[0].map(PAC_text_);

  return values.slice(1).map(function(row){
    const obj = {};
    headers.forEach(function(header,index){
      if(header){
        obj[header] = row[index];
      }
    });
    return obj;
  });
}


function PAC_headerMap_(headerRow){
  const map = {};
  (headerRow || []).forEach(function(value,index){
    const key = PAC_key_(value);
    if(key) map[key] = index;
  });
  return map;
}


function PAC_role_(value){

  const key =
    PAC_key_(value)
      .replace(/[^a-z0-9]/g,"");

  const map = {
    superadmin: "SUPER_ADMIN",
    admin: "ADMIN",
    handler: "HANDLER",
    setupsupport: "SETUP_SUPPORT",
    support: "SETUP_SUPPORT",
    technicalsupport: "TECH_SUPPORT",
    techsupport: "TECH_SUPPORT",

    // Legacy role names migrate into one common Technical Support sector.
    developer: "TECH_SUPPORT",
    screenoperator: "TECH_SUPPORT",
    operator: "TECH_SUPPORT"
  };

  return map[key] || "";
}


function PAC_legacyRole_(value){
  const key = PAC_key_(value);
  if(key === "admin") return "Admin";
  if(key === "handler") return "Handler";
  return "";
}


function PAC_roleLabel_(role){
  switch(PAC_role_(role)){
    case "SUPER_ADMIN": return "Super Admin";
    case "ADMIN": return "Admin";
    case "HANDLER": return "Handler";
    case "SETUP_SUPPORT": return "Setup Support";
    case "TECH_SUPPORT": return "Technical Support";
    default: return "Secure Access";
  }
}


function PAC_active_(value){
  if(value === true) return true;
  return [
    "true","yes","y","1","active"
  ].indexOf(PAC_key_(value)) !== -1;
}


function PAC_email_(value){
  return PAC_text_(value).toLowerCase();
}


function PAC_emailLocal_(value){
  const email = PAC_email_(value);
  return email.indexOf("@") > -1
    ? email.split("@")[0]
    : email;
}


function PAC_text_(value){
  return String(value === null || value === undefined ? "" : value)
    .replace(/\s+/g," ")
    .trim();
}


function PAC_key_(value){
  return PAC_text_(value).toLowerCase();
}


function PAC_copy_(value){
  return JSON.parse(JSON.stringify(value));
}


function PAC_shortHash_(value){

  const bytes =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value || ""),
      Utilities.Charset.UTF_8
    );

  return bytes.map(function(byte){
    const n = byte < 0 ? byte + 256 : byte;
    return ("0" + n.toString(16)).slice(-2);
  }).join("")
    .substring(0,16)
    .toUpperCase();
}
