/******************************************************
 * PORTALAUTH.GS
 * Phase 1 - Email OTP Authentication
 *
 * Architecture:
 * - Portal Users lives in PRIVATE backend.
 * - Personal Gmail accounts are supported.
 * - OTP is sent by MailApp.
 * - OTP state is short-lived in Script Cache.
 * - Successful login receives a random server-side
 *   session token.
 * - Sessions are stored in Script Properties so they
 *   can be revoked/logged out and can last 8 hours.
 *
 * IMPORTANT:
 * - This file does NOT expose incentive data.
 * - Handler/Admin authorization is always checked
 *   server-side.
 ******************************************************/


const PORTAL_AUTH_CONFIG = {

  USERS_SHEET:
    "Portal Users",

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

  SESSION_PREFIX:
    "PORTAL_SESSION_",

  EMAIL_NAME:
    "Interview Incentive Portal"

};


/******************************************************
 * ONE-TIME SETUP
 *
 * Run this manually once from Apps Script.
 *
 * Creates this sheet in PRIVATE BACKEND:
 *
 * Email | Handler | Role | Active
 ******************************************************/
function setupPortalUsersSheet(){

  if(
    typeof getPrivateIncentiveSpreadsheet !== "function"
  ){

    throw new Error(
      "PrivateBackend.gs is required before portal setup."
    );

  }


  const ss =
    getPrivateIncentiveSpreadsheet();


  let sheet =
    ss.getSheetByName(
      PORTAL_AUTH_CONFIG.USERS_SHEET
    );


  if(!sheet){

    sheet =
      ss.insertSheet(
        PORTAL_AUTH_CONFIG.USERS_SHEET
      );

  }


  //--------------------------------------------------
  // Never overwrite an existing populated user list
  //--------------------------------------------------

  if(sheet.getLastRow() === 0){

    sheet
      .getRange(
        1,
        1,
        1,
        4
      )
      .setValues([[
        "Email",
        "Handler",
        "Role",
        "Active"
      ]]);

  }else{

    const existingHeader =
      sheet
        .getRange(
          1,
          1,
          1,
          Math.max(
            sheet.getLastColumn(),
            4
          )
        )
        .getValues()[0];


    const expected =
      [
        "Email",
        "Handler",
        "Role",
        "Active"
      ];


    for(
      let i = 0;
      i < expected.length;
      i++
    ){

      if(
        String(
          existingHeader[i] || ""
        ).trim() !==
        expected[i]
      ){

        throw new Error(
          "Portal Users sheet exists but its headers do not match. " +
          "Expected: Email | Handler | Role | Active"
        );

      }

    }

  }


  //--------------------------------------------------
  // Formatting
  //--------------------------------------------------

  sheet
    .getRange(
      1,
      1,
      1,
      4
    )
    .setFontWeight(
      "bold"
    )
    .setBackground(
      "#D9EAD3"
    )
    .setHorizontalAlignment(
      "center"
    );


  sheet.setFrozenRows(1);

  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 100);


  Logger.log(
    "Portal Users sheet is ready in private backend."
  );

}


/******************************************************
 * SEND OTP
 *
 * Called from Portal.html.
 ******************************************************/
function sendPortalOtp(email){

  const normalizedEmail =
    PA_normalizeEmail(
      email
    );


  if(
    !PA_isValidEmail(
      normalizedEmail
    )
  ){

    return {
      ok: false,
      message:
        "Please enter a valid email address."
    };

  }


  //--------------------------------------------------
  // Only users in the private authorization table
  // are eligible for an OTP.
  //
  // Return a generic message for unknown users so
  // the public page does not reveal the user list.
  //--------------------------------------------------

  const user =
    PA_getAuthorizedUserByEmail(
      normalizedEmail
    );


  if(!user){

    Logger.log(
      "Portal OTP rejected for unauthorized email."
    );


    return {
      ok: true,
      message:
        "If this email is authorized, a verification code has been sent."
    };

  }


  const cache =
    CacheService
      .getScriptCache();


  const emailKey =
    PA_emailKey(
      normalizedEmail
    );


  //--------------------------------------------------
  // 60-second resend protection
  //--------------------------------------------------

  const resendKey =
    "PORTAL_OTP_COOLDOWN_" +
    emailKey;


  if(
    cache.get(
      resendKey
    )
  ){

    return {
      ok: false,
      message:
        "A code was sent recently. Please wait about 60 seconds before requesting another."
    };

  }


  //--------------------------------------------------
  // Per-email hourly rate limit
  //--------------------------------------------------

  const emailRateResult =
    PA_incrementHourlyRateLimit(
      cache,
      "PORTAL_OTP_RATE_EMAIL_" +
        emailKey,
      PORTAL_AUTH_CONFIG
        .OTP_MAX_SENDS_PER_HOUR
    );


  if(!emailRateResult.allowed){

    return {
      ok: false,
      message:
        "Too many verification codes were requested for this email. Please try again later."
    };

  }


  //--------------------------------------------------
  // Global hourly protection
  //--------------------------------------------------

  const globalRateResult =
    PA_incrementHourlyRateLimit(
      cache,
      "PORTAL_OTP_RATE_GLOBAL",
      PORTAL_AUTH_CONFIG
        .GLOBAL_OTP_MAX_SENDS_PER_HOUR
    );


  if(!globalRateResult.allowed){

    return {
      ok: false,
      message:
        "The login service is temporarily busy. Please try again later."
    };

  }


  //--------------------------------------------------
  // Check MailApp quota before generating/saving OTP
  //--------------------------------------------------

  const quota =
    MailApp
      .getRemainingDailyQuota();


  if(quota < 1){

    throw new Error(
      "OTP email quota has been reached for today."
    );

  }


  const otp =
    PA_generateOtp();


  const now =
    Date.now();


  const expiresAt =
    now +
    (
      PORTAL_AUTH_CONFIG
        .OTP_TTL_SECONDS *
      1000
    );


  const otpState = {

    hash:
      PA_hashOtp(
        normalizedEmail,
        otp
      ),

    attempts:
      0,

    expiresAt:
      expiresAt

  };


  const otpKey =
    "PORTAL_OTP_" +
    emailKey;


  cache.put(
    otpKey,
    JSON.stringify(
      otpState
    ),
    PORTAL_AUTH_CONFIG
      .OTP_TTL_SECONDS
  );


  cache.put(
    resendKey,
    "1",
    PORTAL_AUTH_CONFIG
      .OTP_RESEND_SECONDS
  );


  //--------------------------------------------------
  // Send OTP
  //--------------------------------------------------

  const subject =
    "Your Interview Incentive Portal verification code";


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
        'Interview Incentive Portal' +
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
      PORTAL_AUTH_CONFIG
        .EMAIL_NAME

  });


  Logger.log(
    "Portal OTP sent to an authorized user."
  );


  return {
    ok: true,
    message:
      "Verification code sent. Check your email."
  };

}


/******************************************************
 * VERIFY OTP
 ******************************************************/
function verifyPortalOtp(
  email,
  otp
){

  const normalizedEmail =
    PA_normalizeEmail(
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
    !PA_isValidEmail(
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
    PA_getAuthorizedUserByEmail(
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
    CacheService
      .getScriptCache();


  const otpKey =
    "PORTAL_OTP_" +
    PA_emailKey(
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
    now > Number(
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
    PORTAL_AUTH_CONFIG
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


  const expectedHash =
    String(
      state.hash || ""
    );


  const suppliedHash =
    PA_hashOtp(
      normalizedEmail,
      normalizedOtp
    );


  if(
    !PA_secureEqual(
      expectedHash,
      suppliedHash
    )
  ){

    state.attempts =
      attempts + 1;


    if(
      state.attempts >=
      PORTAL_AUTH_CONFIG
        .OTP_MAX_ATTEMPTS
    ){

      cache.remove(
        otpKey
      );

    }else{

      const remainingSeconds =
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
        remainingSeconds
      );

    }


    return {
      ok: false,
      message:
        "Incorrect verification code."
    };

  }


  //--------------------------------------------------
  // Correct OTP
  //--------------------------------------------------

  cache.remove(
    otpKey
  );


  const token =
    PA_createSession(
      user
    );


  return {

    ok:
      true,

    token:
      token,

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
 * CHECK EXISTING SESSION
 *
 * Called when page reloads.
 ******************************************************/
function getPortalSession(
  token
){

  const result =
    PA_validateSession(
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

    user: {
      email:
        result.user.email,
      handler:
        result.user.handler,
      role:
        result.user.role
    }

  };

}


/******************************************************
 * LOGOUT
 ******************************************************/
function logoutPortal(
  token
){

  const normalizedToken =
    String(
      token || ""
    ).trim();


  if(!normalizedToken){

    return {
      ok: true
    };

  }


  const key =
    PA_sessionPropertyKey(
      normalizedToken
    );


  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      key
    );


  return {
    ok: true
  };

}


/******************************************************
 * SERVER-SIDE SESSION VALIDATION
 *
 * Future PortalData.gs functions MUST call this
 * before returning private information.
 ******************************************************/
function PA_validateSession(
  token
){

  const normalizedToken =
    String(
      token || ""
    ).trim();


  if(!normalizedToken){

    return {
      ok: false
    };

  }


  const props =
    PropertiesService
      .getScriptProperties();


  const key =
    PA_sessionPropertyKey(
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
  // Re-check Portal Users on EVERY protected request.
  //
  // This means deactivating a user in the private
  // sheet blocks them even if they still have an
  // old browser token.
  //--------------------------------------------------

  const user =
    PA_getAuthorizedUserByEmail(
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


  return {

    ok:
      true,

    user:
      user,

    expiresAt:
      Number(
        session.expiresAt
      )

  };

}


/******************************************************
 * CREATE SERVER-SIDE SESSION
 ******************************************************/
function PA_createSession(
  user
){

  PA_cleanupExpiredSessions();


  const token =
    Utilities.getUuid() +
    "." +
    Utilities.getUuid();


  const now =
    Date.now();


  const expiresAt =
    now +
    (
      PORTAL_AUTH_CONFIG
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

    expiresAt:
      expiresAt

  };


  PropertiesService
    .getScriptProperties()
    .setProperty(
      PA_sessionPropertyKey(
        token
      ),
      JSON.stringify(
        session
      )
    );


  return token;

}


/******************************************************
 * CLEAN EXPIRED SESSIONS
 *
 * Runs only when a new session is created.
 ******************************************************/
function PA_cleanupExpiredSessions(){

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
          PORTAL_AUTH_CONFIG
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
 * GET AUTHORIZED USER BY EMAIL
 *
 * Private Backend:
 * Portal Users
 *
 * Columns:
 * A Email
 * B Handler
 * C Role
 * D Active
 ******************************************************/
function PA_getAuthorizedUserByEmail(
  email
){

  if(
    typeof getPrivateIncentiveSpreadsheet !== "function"
  ){

    throw new Error(
      "PrivateBackend.gs is required."
    );

  }


  const normalizedEmail =
    PA_normalizeEmail(
      email
    );


  if(!normalizedEmail){

    return null;

  }


  const ss =
    getPrivateIncentiveSpreadsheet();


  const sheet =
    ss.getSheetByName(
      PORTAL_AUTH_CONFIG
        .USERS_SHEET
    );


  if(!sheet){

    throw new Error(
      "Portal Users sheet was not found in the private backend. " +
      "Run setupPortalUsersSheet() first."
    );

  }


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
      PA_normalizeEmail(
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
      PA_normalizeRole(
        rows[i][2]
      );


    const active =
      PA_isActiveValue(
        rows[i][3]
      );


    if(
      !active ||
      !role
    ){

      return null;

    }


    //------------------------------------------------
    // Handler accounts require a handler mapping.
    //------------------------------------------------

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
 * NORMALIZE ROLE
 ******************************************************/
function PA_normalizeRole(
  value
){

  const role =
    String(
      value || ""
    )
    .trim()
    .toLowerCase();


  if(role === "admin"){

    return "Admin";

  }


  if(role === "handler"){

    return "Handler";

  }


  return "";

}


/******************************************************
 * ACTIVE VALUE
 ******************************************************/
function PA_isActiveValue(
  value
){

  if(value === true){

    return true;

  }


  const text =
    String(
      value || ""
    )
    .trim()
    .toLowerCase();


  return [
    "yes",
    "y",
    "true",
    "1",
    "active"
  ].indexOf(
    text
  ) > -1;

}


/******************************************************
 * NORMALIZE EMAIL
 ******************************************************/
function PA_normalizeEmail(
  email
){

  return String(
    email || ""
  )
  .trim()
  .toLowerCase();

}


/******************************************************
 * SIMPLE EMAIL VALIDATION
 ******************************************************/
function PA_isValidEmail(
  email
){

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(
      String(
        email || ""
      )
    );

}


/******************************************************
 * OTP GENERATOR
 *
 * Creates a 6-digit value from SHA-256 bytes based
 * on UUID + timestamp.
 ******************************************************/
function PA_generateOtp(){

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


/******************************************************
 * OTP HASH
 ******************************************************/
function PA_hashOtp(
  email,
  otp
){

  return PA_sha256Hex(
    PA_normalizeEmail(
      email
    ) +
    "|" +
    String(
      otp || ""
    )
  );

}


/******************************************************
 * EMAIL CACHE KEY
 ******************************************************/
function PA_emailKey(
  email
){

  return PA_sha256Hex(
    PA_normalizeEmail(
      email
    )
  )
  .substring(
    0,
    32
  );

}


/******************************************************
 * SESSION PROPERTY KEY
 *
 * Raw browser token is NEVER stored as the property
 * key. Only its SHA-256 digest is stored.
 ******************************************************/
function PA_sessionPropertyKey(
  token
){

  return (
    PORTAL_AUTH_CONFIG
      .SESSION_PREFIX +
    PA_sha256Hex(
      String(
        token || ""
      )
    )
  );

}


/******************************************************
 * SHA-256 HEX
 ******************************************************/
function PA_sha256Hex(
  value
){

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

        const normalized =
          byte < 0
            ? byte + 256
            : byte;


        return (
          "0" +
          normalized.toString(16)
        ).slice(-2);

      }
    )
    .join("");

}


/******************************************************
 * CONSTANT-TIME STYLE STRING COMPARISON
 ******************************************************/
function PA_secureEqual(
  a,
  b
){

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


/******************************************************
 * HOURLY RATE LIMIT
 ******************************************************/
function PA_incrementHourlyRateLimit(
  cache,
  key,
  maxCount
){

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

      // Fresh state is already prepared.

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

    return {
      allowed: false
    };

  }


  state.count =
    Number(
      state.count
    ) + 1;


  const remainingSeconds =
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
    remainingSeconds
  );


  return {
    allowed: true
  };

}

