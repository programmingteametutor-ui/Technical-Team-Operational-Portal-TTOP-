/******************************************************
 * NORMALIZER.GS
 ******************************************************/

let CLIENT_ALIAS_CACHE = null;
let CANDIDATE_ALIAS_CACHE = null;


/******************************************************
 * NORMALIZE TEXT
 ******************************************************/
function normalizeText(text){

  return String(text || "")

    .toLowerCase()

    // remove brackets
    .replace(/[()]/g," ")

    // remove hyphens
    .replace(/-/g," ")

    // remove commas & periods
    .replace(/[.,]/g," ")

    // remove apostrophes
    .replace(/'/g,"")

    // remove multiple spaces
    .replace(/\s+/g," ")

    .trim();

}


/******************************************************
 * LOAD CLIENT ALIASES
 ******************************************************/
function loadClientAliases(){

  if(CLIENT_ALIAS_CACHE)
    return CLIENT_ALIAS_CACHE;

  CLIENT_ALIAS_CACHE = {};

  const sheet =
    SpreadsheetApp
      .getActive()
      .getSheetByName(
        CONFIG.CLIENT_ALIAS_SHEET
      );

  if(!sheet)
    return CLIENT_ALIAS_CACHE;

  const values =
    sheet.getDataRange().getValues();

  for(let i=1;i<values.length;i++){

    const alias =
      normalizeText(values[i][0]);

    const official =
      normalizeText(values[i][1]);

    if(alias && official){

      CLIENT_ALIAS_CACHE[alias] =
        official;

    }

  }

  return CLIENT_ALIAS_CACHE;

}


/******************************************************
 * LOAD CANDIDATE ALIASES
 ******************************************************/
function loadCandidateAliases(){

  if(CANDIDATE_ALIAS_CACHE)
    return CANDIDATE_ALIAS_CACHE;

  CANDIDATE_ALIAS_CACHE = {};

  const sheet =
    SpreadsheetApp
      .getActive()
      .getSheetByName(
        CONFIG.CANDIDATE_ALIAS_SHEET
      );

  if(!sheet)
    return CANDIDATE_ALIAS_CACHE;

  const values =
    sheet.getDataRange().getValues();

  for(let i=1;i<values.length;i++){

    const alias =
      normalizeText(values[i][0]);

    const official =
      normalizeText(values[i][1]);

    if(alias && official){

      CANDIDATE_ALIAS_CACHE[alias] =
        official;

    }

  }

  return CANDIDATE_ALIAS_CACHE;

}


/******************************************************
 * NORMALIZE CLIENT
 ******************************************************/
function normalizeClient(client){

  client = normalizeText(client);

  const aliases =
    loadClientAliases();

  if(aliases[client])
    return aliases[client];

  return client;

}


/******************************************************
 * NORMALIZE CANDIDATE
 ******************************************************/
function normalizeCandidate(candidate){

  candidate =
    normalizeText(candidate);

  const aliases =
    loadCandidateAliases();

  if(aliases[candidate])
    return aliases[candidate];

  return candidate;

}


/******************************************************
 * SMART KEY
 ******************************************************/
function makeSmartKey(candidate,client){

  return normalizeCandidate(candidate)

    + "|"

    + normalizeClient(client);

}
