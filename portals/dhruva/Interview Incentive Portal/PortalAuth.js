/******************************************************
 * PORTALAUTH.GS
 * Secure Email OTP Authentication + V2 Multi-Role Access
 * ACCESS FOUNDATION PATCH: V2-PORTAL-ACCESS-1.0.0
 *
 * PUBLIC CLIENT FUNCTIONS:
 *   sendPortalOtp()
 *   verifyPortalOtp()
 *   getPortalSession()
 *   logoutPortal()
 *
 * Every helper ends with "_" so it is not callable
 * through google.script.run.
 ******************************************************/

const PORTAL_AUTH = {

  OTP_TTL_SECONDS:
    10 * 60,

  OTP_RESEND_SECONDS:
    60,

  OTP_MAX_ATTEMPTS:
    5,

  OTP_MAX_SENDS_PER_HOUR:
    5,

  GLOBAL_OTP_MAX_SENDS_PER_HOUR:
    40,

  SESSION_HOURS:
    8,

  REMEMBER_DAYS:
    30,

  SESSION_PREFIX:
    "PORTAL_SESSION_",

  EMAIL_NAME:
    "Interview Operations Portal"

};


/******************************************************
 * PUBLIC: SEND OTP
 ******************************************************/
function sendPortalOtp(email){

  const normalizedEmail =
    PA_normalizeEmail_(
      email
    );


  if(
    !PA_isValidEmail_(
      normalizedEmail
    )
  ){

    return {
      ok: false,
      message:
        "Please enter a valid email address."
    };

  }


  const user =
    PA_getAuthorizedUserByEmail_(
      normalizedEmail
    );


  //--------------------------------------------------
  // Generic response prevents the public page from
  // revealing which email addresses are authorized.
  //--------------------------------------------------

  if(!user){

    Logger.log(
      "Portal OTP request rejected for unauthorized email."
    );

    return {
      ok: true,
      message:
        "If this email is authorized, a verification code has been sent."
    };

  }


  const cache =
    CacheService.getScriptCache();


  const emailKey =
    PA_emailKey_(
      normalizedEmail
    );


  const cooldownKey =
    "PORTAL_OTP_COOLDOWN_" +
    emailKey;


  if(
    cache.get(
      cooldownKey
    )
  ){

    return {
      ok: false,
      message:
        "A code was sent recently. Please wait about 60 seconds before requesting another."
    };

  }


  //--------------------------------------------------
  // Rate limiting
  //--------------------------------------------------

  if(
    !PA_incrementRate_(
      cache,
      "PORTAL_RATE_EMAIL_" +
        emailKey,
      PORTAL_AUTH
        .OTP_MAX_SENDS_PER_HOUR
    )
  ){

    return {
      ok: false,
      message:
        "Too many verification codes were requested for this email. Please try again later."
    };

  }


  if(
    !PA_incrementRate_(
      cache,
      "PORTAL_RATE_GLOBAL",
      PORTAL_AUTH
        .GLOBAL_OTP_MAX_SENDS_PER_HOUR
    )
  ){

    return {
      ok: false,
      message:
        "The login service is temporarily busy. Please try again later."
    };

  }


  if(
    MailApp.getRemainingDailyQuota() <
    1
  ){

    throw new Error(
      "OTP email quota has been reached for today."
    );

  }


  const otp =
    PA_generateOtp_();


  const now =
    Date.now();


  const state = {

    hash:
      PA_hashOtp_(
        normalizedEmail,
        otp
      ),

    attempts:
      0,

    expiresAt:
      now +
      (
        PORTAL_AUTH
          .OTP_TTL_SECONDS *
        1000
      )

  };


  cache.put(
    "PORTAL_OTP_" +
      emailKey,
    JSON.stringify(
      state
    ),
    PORTAL_AUTH
      .OTP_TTL_SECONDS
  );


  cache.put(
    cooldownKey,
    "1",
    PORTAL_AUTH
      .OTP_RESEND_SECONDS
  );


  const subject =
    "Your Interview Operations Portal verification code";


  const body =
    "Your verification code is: " +
    otp +
    "\n\n" +
    "This code expires in 10 minutes." +
    "\n\n" +
    "If you did not request this code, you can ignore this email.";


  const htmlBody =
    '<div style="' +
      'font-family:Arial,sans-serif;' +
      'max-width:520px;' +
      'margin:auto;' +
      'padding:24px;' +
      'border:1px solid #e5e7eb;' +
      'border-radius:16px;' +
    '">' +

      '<div style="' +
        'font-size:22px;' +
        'font-weight:700;' +
        'color:#0b1f52;' +
        'margin-bottom:12px;' +
      '">' +
        'Interview Operations Portal' +
      '</div>' +

      '<div style="' +
        'font-size:15px;' +
        'color:#475569;' +
        'margin-bottom:20px;' +
      '">' +
        'Use this verification code to sign in:' +
      '</div>' +

      '<div style="' +
        'font-size:34px;' +
        'font-weight:800;' +
        'letter-spacing:8px;' +
        'color:#1457ff;' +
        'background:#f1f5ff;' +
        'padding:18px;' +
        'text-align:center;' +
        'border-radius:12px;' +
        'margin-bottom:20px;' +
      '">' +
        otp +
      '</div>' +

      '<div style="' +
        'font-size:13px;' +
        'color:#64748b;' +
      '">' +
        'This code expires in 10 minutes. ' +
        'If you did not request it, you can safely ignore this email.' +
      '</div>' +

    '</div>';


  MailApp.sendEmail({

    to:
      normalizedEmail,

    subject:
      subject,

    body:
      body,

    htmlBody:
      htmlBody,

    name:
      PORTAL_AUTH
        .EMAIL_NAME

  });


  return {
    ok: true,
    message:
      "Verification code sent. Check your email."
  };

}


/******************************************************
 * PUBLIC: VERIFY OTP
 ******************************************************/
function verifyPortalOtp(
  email,
  otp,
  rememberDevice
){

  const normalizedEmail =
    PA_normalizeEmail_(
      email
    );


  const normalizedOtp =
    String(
      otp || ""
    )
    .replace(
      /\D/g,
      ""
    )
    .trim();


  if(
    !PA_isValidEmail_(
      normalizedEmail
    ) ||
    !/^\d{6}$/.test(
      normalizedOtp
    )
  ){

    return {
      ok: false,
      message:
        "Invalid email or verification code."
    };

  }


  const user =
    PA_getAuthorizedUserByEmail_(
      normalizedEmail
    );


  if(!user){

    return {
      ok: false,
      message:
        "Invalid or expired verification code."
    };

  }


  const cache =
    CacheService.getScriptCache();


  const otpKey =
    "PORTAL_OTP_" +
    PA_emailKey_(
      normalizedEmail
    );


  const rawState =
    cache.get(
      otpKey
    );


  if(!rawState){

    return {
      ok: false,
      message:
        "The verification code has expired. Please request a new one."
    };

  }


  let state;


  try{

    state =
      JSON.parse(
        rawState
      );

  }
  catch(error){

    cache.remove(
      otpKey
    );

    return {
      ok: false,
      message:
        "The verification code has expired. Please request a new one."
    };

  }


  const now =
    Date.now();


  if(
    !state.expiresAt ||
    now >
      Number(
        state.expiresAt
      )
  ){

    cache.remove(
      otpKey
    );

    return {
      ok: false,
      message:
        "The verification code has expired. Please request a new one."
    };

  }


  const attempts =
    Number(
      state.attempts
    ) || 0;


  if(
    attempts >=
    PORTAL_AUTH
      .OTP_MAX_ATTEMPTS
  ){

    cache.remove(
      otpKey
    );

    return {
      ok: false,
      message:
        "Too many incorrect attempts. Please request a new verification code."
    };

  }


  const expected =
    String(
      state.hash || ""
    );


  const supplied =
    PA_hashOtp_(
      normalizedEmail,
      normalizedOtp
    );


  if(
    !PA_secureEqual_(
      expected,
      supplied
    )
  ){

    state.attempts =
      attempts + 1;


    if(
      state.attempts >=
      PORTAL_AUTH
        .OTP_MAX_ATTEMPTS
    ){

      cache.remove(
        otpKey
      );

    }else{

      const remaining =
        Math.max(
          1,
          Math.floor(
            (
              Number(
                state.expiresAt
              ) -
              now
            ) /
            1000
          )
        );


      cache.put(
        otpKey,
        JSON.stringify(
          state
        ),
        remaining
      );

    }


    return {
      ok: false,
      message:
        "Incorrect verification code."
    };

  }


  cache.remove(
    otpKey
  );


  const remember =
    rememberDevice === true ||
    String(rememberDevice || "")
      .trim()
      .toLowerCase() === "true";

  const sessionResult =
    PA_createSession_(
      user,
      remember
    );

  const token =
    sessionResult.token;


  return {

    ok:
      true,

    token:
      token,

    rememberDevice:
      sessionResult.rememberDevice,

    expiresAt:
      sessionResult.expiresAt,

    user: {
      email:
        user.email,
      handler:
        user.handler,
      role:
        user.role
    }

  };

}


/******************************************************
 * PUBLIC: CHECK EXISTING SESSION
 ******************************************************/
function getPortalSession(
  token
){

  const result =
    PA_validateSession_(
      token
    );


  if(!result.ok){

    return {
      ok: false
    };

  }


  return {

    ok:
      true,

    expiresAt:
      result.expiresAt,

    rememberDevice:
      Boolean(
        result.rememberDevice
      ),

    user: {
      email:
        result.user.email,
      handler:
        result.user.handler,
      role:
        result.user.role,
      accessRole:
        result.user.accessRole || "",
      officialName:
        result.user.officialName || "",
      primaryTeamId:
        result.user.primaryTeamId || "",
      handlerId:
        result.user.handlerId || "",
      supportId:
        result.user.supportId || "",
      technicalSupportId:
        result.user.technicalSupportId || "",
      developerId:
        result.user.developerId || "",
      operatorId:
        result.user.operatorId || "",
      testViewActive:
        result.user.testViewActive === true,
      readOnlyTest:
        result.user.readOnlyTest === true
    }

  };

}


/******************************************************
 * PUBLIC: LOGOUT
 ******************************************************/
function logoutPortal(
  token
){

  const normalizedToken =
    String(
      token || ""
    )
    .trim();


  if(normalizedToken){

    if(
      typeof PAC_clearTestViewForToken_ ===
        "function"
    ){
      PAC_clearTestViewForToken_(
        normalizedToken
      );
    }

    if(
      typeof PAC_clearCurrentRoleForToken_ ===
        "function"
    ){
      PAC_clearCurrentRoleForToken_(
        normalizedToken
      );
    }

    PropertiesService
      .getScriptProperties()
      .deleteProperty(
        PA_sessionKey_(
          normalizedToken
        )
      );

  }


  return {
    ok: true
  };

}


/******************************************************
 * PRIVATE: VALIDATE SESSION
 *
 * PortalData.gs calls this before returning ANY
 * incentive information.
 ******************************************************/
function PA_validateSession_(
  token
){

  const normalizedToken =
    String(
      token || ""
    )
    .trim();


  if(!normalizedToken){

    return {
      ok: false
    };

  }


  const props =
    PropertiesService
      .getScriptProperties();


  const key =
    PA_sessionKey_(
      normalizedToken
    );


  const raw =
    props.getProperty(
      key
    );


  if(!raw){

    return {
      ok: false
    };

  }


  let session;


  try{

    session =
      JSON.parse(
        raw
      );

  }
  catch(error){

    props.deleteProperty(
      key
    );

    return {
      ok: false
    };

  }


  if(
    !session.expiresAt ||
    Date.now() >
      Number(
        session.expiresAt
      )
  ){

    props.deleteProperty(
      key
    );

    return {
      ok: false
    };

  }


  //--------------------------------------------------
  // Re-check the private Portal Users sheet on every
  // protected request. Deactivating a user therefore
  // immediately blocks future dashboard requests.
  //--------------------------------------------------

  const user =
    PA_getAuthorizedUserByEmail_(
      session.email
    );


  if(!user){

    props.deleteProperty(
      key
    );

    return {
      ok: false
    };

  }


  const baseResult = {

    ok:
      true,

    user:
      user,

    expiresAt:
      Number(
        session.expiresAt
      ),

    rememberDevice:
      session.rememberDevice === true

  };


  //--------------------------------------------------
  // V2 ACCESS FOUNDATION HOOK
  //
  // Applies real role/scope and (for real Super Admin only)
  // the server-side Test As effective identity. Existing
  // modules continue receiving auth.user, but it is now
  // safely compatibility-scoped.
  //--------------------------------------------------
  let accessResult = baseResult;

  if(
    typeof PAC_applySessionAccess_ ===
      "function"
  ){

    accessResult = PAC_applySessionAccess_(
      baseResult,
      normalizedToken
    );

  }

  // Central multi-team runtime hook. This runs AFTER role/scope
  // resolution so the effective ADMIN/HANDLER team is authoritative.
  if(
    typeof PTR_applySessionTeamContext_ ===
      "function"
  ){
    accessResult = PTR_applySessionTeamContext_(
      accessResult,
      normalizedToken
    );
  }

  return accessResult;

}


/******************************************************
 * PRIVATE: CREATE SESSION
 ******************************************************/
function PA_createSession_(
  user,
  rememberDevice
){

  PA_cleanupSessions_();


  const token =
    Utilities.getUuid() +
    "." +
    Utilities.getUuid();


  const now =
    Date.now();


  const remember =
    rememberDevice === true;


  const ttlMs =
    remember
      ? (
          PORTAL_AUTH
            .REMEMBER_DAYS *
          24 *
          60 *
          60 *
          1000
        )
      : (
          PORTAL_AUTH
            .SESSION_HOURS *
          60 *
          60 *
          1000
        );


  const session = {

    email:
      user.email,

    createdAt:
      now,

    rememberDevice:
      remember,

    expiresAt:
      now + ttlMs

  };


  PropertiesService
    .getScriptProperties()
    .setProperty(
      PA_sessionKey_(
        token
      ),
      JSON.stringify(
        session
      )
    );


  return {
    token:
      token,
    expiresAt:
      session.expiresAt,
    rememberDevice:
      remember
  };

}


/******************************************************
 * PRIVATE: CLEAN EXPIRED SESSIONS
 ******************************************************/
function PA_cleanupSessions_(){

  const props =
    PropertiesService
      .getScriptProperties();


  const all =
    props.getProperties();


  const now =
    Date.now();


  Object.keys(
    all
  )
  .forEach(
    function(key){

      if(
        key.indexOf(
          PORTAL_AUTH
            .SESSION_PREFIX
        ) !== 0
      ){

        return;

      }


      try{

        const session =
          JSON.parse(
            all[key]
          );


        if(
          !session.expiresAt ||
          now >
            Number(
              session.expiresAt
            )
        ){

          props.deleteProperty(
            key
          );

        }

      }
      catch(error){

        props.deleteProperty(
          key
        );

      }

    }
  );

}


/******************************************************
 * PRIVATE: AUTHORIZED USER LOOKUP
 *
 * Private Backend -> Portal Users
 *
 * A Email
 * B Handler
 * C Role
 * D Active
 ******************************************************/
function PA_getAuthorizedUserByEmail_(
  email
){

  const normalizedEmail =
    PA_normalizeEmail_(
      email
    );


  if(!normalizedEmail){

    return null;

  }


  //--------------------------------------------------
  // V2 ACCESS FOUNDATION LOOKUP
  //
  // If PortalAccessControl.gs is installed, it becomes
  // the primary role/identity source. The old Portal Users
  // lookup below remains as a safe backward-compatible
  // fallback.
  //--------------------------------------------------
  if(
    typeof PAC_getLoginUserByEmail_ ===
      "function"
  ){

    const v2User =
      PAC_getLoginUserByEmail_(
        normalizedEmail
      );

    if(v2User){
      return v2User;
    }

    // Once an email exists in V2 User Access, V2 is authoritative.
    // If the V2 row is inactive or has no permitted role, do NOT
    // fall back to the older Portal Users sheet.
    if(
      typeof PAC_userAccessRecordByEmail_ ===
        "function" &&
      PAC_userAccessRecordByEmail_(
        normalizedEmail
      )
    ){
      return null;
    }

  }


  const sheet =
    portalUsers_();


  const lastRow =
    sheet.getLastRow();


  if(lastRow <= 1){

    return null;

  }


  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        4
      )
      .getValues();


  for(
    let i = 0;
    i < rows.length;
    i++
  ){

    const rowEmail =
      PA_normalizeEmail_(
        rows[i][0]
      );


    if(
      rowEmail !==
      normalizedEmail
    ){

      continue;

    }


    const handler =
      String(
        rows[i][1] || ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


    const role =
      PA_role_(
        rows[i][2]
      );


    const active =
      PA_active_(
        rows[i][3]
      );


    if(
      !active ||
      !role
    ){

      return null;

    }


    if(
      role === "Handler" &&
      !handler
    ){

      return null;

    }


    return {

      email:
        rowEmail,

      handler:
        role === "Admin"
          ? (
              handler ||
              "Admin"
            )
          : handler,

      role:
        role

    };

  }


  return null;

}


/******************************************************
 * PRIVATE HELPERS
 ******************************************************/
function PA_normalizeEmail_(email){

  return String(
    email || ""
  )
  .trim()
  .toLowerCase();

}


function PA_isValidEmail_(email){

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(
      String(
        email || ""
      )
    );

}


function PA_role_(value){

  const role =
    String(
      value || ""
    )
    .trim()
    .toLowerCase();


  if(role === "admin")
    return "Admin";


  if(role === "handler")
    return "Handler";


  return "";

}


function PA_active_(value){

  if(value === true)
    return true;


  return [
    "yes",
    "y",
    "true",
    "1",
    "active"
  ].indexOf(
    String(
      value || ""
    )
    .trim()
    .toLowerCase()
  ) > -1;

}


function PA_generateOtp_(){

  const seed =
    Utilities.getUuid() +
    "|" +
    Date.now() +
    "|" +
    Utilities.getUuid();


  const bytes =
    Utilities.computeDigest(
      Utilities
        .DigestAlgorithm
        .SHA_256,
      seed,
      Utilities
        .Charset
        .UTF_8
    );


  let value = 0;


  for(
    let i = 0;
    i < 4;
    i++
  ){

    value =
      (
        value * 256 +
        (
          bytes[i] & 255
        )
      ) >>> 0;

  }


  return String(
    100000 +
    (
      value %
      900000
    )
  );

}


function PA_hashOtp_(
  email,
  otp
){

  return PA_sha256Hex_(
    PA_normalizeEmail_(
      email
    ) +
    "|" +
    String(
      otp || ""
    )
  );

}


function PA_emailKey_(email){

  return PA_sha256Hex_(
    PA_normalizeEmail_(
      email
    )
  )
  .substring(
    0,
    32
  );

}


function PA_sessionKey_(token){

  return (
    PORTAL_AUTH
      .SESSION_PREFIX +
    PA_sha256Hex_(
      String(
        token || ""
      )
    )
  );

}


function PA_sha256Hex_(value){

  const bytes =
    Utilities.computeDigest(
      Utilities
        .DigestAlgorithm
        .SHA_256,
      String(
        value || ""
      ),
      Utilities
        .Charset
        .UTF_8
    );


  return bytes
    .map(
      function(byte){

        const n =
          byte < 0
            ? byte + 256
            : byte;


        return (
          "0" +
          n.toString(16)
        ).slice(-2);

      }
    )
    .join("");

}


function PA_secureEqual_(a,b){

  a =
    String(
      a || ""
    );


  b =
    String(
      b || ""
    );


  if(
    a.length !==
    b.length
  ){

    return false;

  }


  let difference = 0;


  for(
    let i = 0;
    i < a.length;
    i++
  ){

    difference |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);

  }


  return difference === 0;

}


function PA_incrementRate_(
  cache,
  key,
  maxCount
){

  const lock =
    LockService
      .getScriptLock();


  lock.waitLock(
    5000
  );


  try{

    const now =
      Date.now();


    const raw =
      cache.get(
        key
      );


    let state = {

      count:
        0,

      expiresAt:
        now +
        (
          60 *
          60 *
          1000
        )

    };


    if(raw){

      try{

        const parsed =
          JSON.parse(
            raw
          );


        if(
          parsed.expiresAt &&
          now <
            Number(
              parsed.expiresAt
            )
        ){

          state =
            parsed;

        }

      }
      catch(error){

        // Use fresh state.

      }

    }


    if(
      Number(
        state.count
      ) >=
      Number(
        maxCount
      )
    ){

      return false;

    }


    state.count =
      Number(
        state.count
      ) + 1;


    const remaining =
      Math.max(
        1,
        Math.min(
          21600,
          Math.floor(
            (
              Number(
                state.expiresAt
              ) -
              now
            ) /
            1000
          )
        )
      );


    cache.put(
      key,
      JSON.stringify(
        state
      ),
      remaining
    );


    return true;

  }
  finally{

    lock.releaseLock();

  }

}
