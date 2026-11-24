/******************************************************
 * POSSIBLE MATCHES ENGINE
 * Version 5.0
 ******************************************************/

/******************************************************
 * BUILD POSSIBLE MATCHES
 ******************************************************/
function buildPossibleMatches(rawRecords){

  const suggestions = [];

  //--------------------------------------------------
  // Group by Candidate
  //--------------------------------------------------

  const candidateGroups = {};

  rawRecords.forEach(function(record){

    const candidate = normalizeCandidate(
      record.candidate
    );

    if(!candidateGroups[candidate]){

      candidateGroups[candidate] = [];

    }

    candidateGroups[candidate].push(record);

  });

  //--------------------------------------------------
  // Detect Client Aliases
  //--------------------------------------------------

  Object.keys(candidateGroups).forEach(function(candidate){

    const history =
      candidateGroups[candidate];

    suggestions.push(

      ...detectClientAliases(history)

    );

  });

  return suggestions;

}
/******************************************************
 * DETECT CLIENT ALIASES
 ******************************************************/
function detectClientAliases(history){

  const suggestions = [];

  if(history.length < 2)
    return suggestions;

  //--------------------------------------------------
  // Count client occurrences
  //--------------------------------------------------

  const counts = {};

  history.forEach(function(record){

    const client = record.client.trim();

    counts[client] = (counts[client] || 0) + 1;

  });

  //--------------------------------------------------
  // Find Official Client
  //--------------------------------------------------

  let official = "";
  let max = 0;

  Object.keys(counts).forEach(function(client){

    if(counts[client] > max){

      max = counts[client];
      official = client;

    }

  });

  //--------------------------------------------------
  // Suggest aliases
  //--------------------------------------------------

  Object.keys(counts).forEach(function(alias){

    if(alias == official)
      return;

    const confidence = clientSimilarity(

      official,

      alias

    );

   // Ignore identical names after normalization
if(confidence == 100)
    return;

// Ignore weak matches
if(confidence < 80)
    return;
    suggestions.push({

      type : "Client",

      official : official,

      alias : alias,

      candidate : history[0].candidate,

      confidence : confidence,

      action : "Pending"

    });

  });

  return suggestions;

}
/******************************************************
 * CLIENT SIMILARITY
 ******************************************************/
function clientSimilarity(client1, client2){

  client1 = normalizeCompany(client1);
  client2 = normalizeCompany(client2);

  //--------------------------------------------------
  // Exact
  //--------------------------------------------------

  if(client1 == client2)
    return 100;

  //--------------------------------------------------
  // Contains
  //--------------------------------------------------

  if(client1.indexOf(client2) > -1)
    return 98;

  if(client2.indexOf(client1) > -1)
    return 98;

  //--------------------------------------------------
  // Different
  //--------------------------------------------------

  return 0;

}

/******************************************************
 * NORMALIZE COMPANY
 ******************************************************/
function normalizeCompany(name){

  name = normalizeText(name);

  //--------------------------------------------------
  // Remove leading words
  //--------------------------------------------------

  name = name.replace(
    /\b(the)\b/g,
    ""
  );

  //--------------------------------------------------
  // Remove company suffixes
  //--------------------------------------------------

  name = name.replace(
    /\b(bank|corporation|corp|inc|llc|ltd|limited|company|co|technologies|technology|tech|systems|services|service|group|health|holdings|international|intl)\b/g,
    ""
  );

  //--------------------------------------------------
  // Remove all spaces
  //--------------------------------------------------

  name = name.replace(/\s+/g,"");

  return name.trim();

}
/******************************************************
 * REMOVE DUPLICATE SUGGESTIONS
 ******************************************************/
function uniqueSuggestions(suggestions){

  const seen = {};
  const output = [];

  suggestions.forEach(function(item){

    const key =

      item.type + "|" +

      normalizeText(item.official) + "|" +

      normalizeText(item.alias);

    if(seen[key])
      return;

    seen[key] = true;

    output.push(item);

  });

  return output;

}
/******************************************************
 * WRITE POSSIBLE MATCHES
 ******************************************************/
function writePossibleMatches(suggestions){

  const ss = SpreadsheetApp.getActive();

  let sheet = ss.getSheetByName(
    CONFIG.POSSIBLE_MATCHES_SHEET
  );

  if(!sheet){

    sheet = ss.insertSheet(
      CONFIG.POSSIBLE_MATCHES_SHEET
    );

  }

  sheet.clearContents();

  sheet.appendRow([

    "Type",

    "Official",

    "Alias",

    "Candidate",

    "Confidence",

    "Action"

  ]);

  if(suggestions.length == 0)
    return;

  suggestions = uniqueSuggestions(suggestions);

  const output = suggestions.map(function(item){

    return [

      item.type,

      item.official,

      item.alias,

      item.candidate,

      item.confidence,

      item.action

    ];

  });

  sheet.getRange(

    2,

    1,

    output.length,

    output[0].length

  ).setValues(output);

}


/******************************************************
 * GENERATE POSSIBLE MATCHES
 ******************************************************/
function generatePossibleMatches(){

  const rawRecords = loadRawData();

  const suggestions =
    buildPossibleMatches(rawRecords);

  writePossibleMatches(suggestions);

  Logger.log(

    "Possible Matches : " +

    suggestions.length

  );

}
/******************************************************
 * APPROVE ALIASES
 ******************************************************/
function approveAliases(){

  const ss = SpreadsheetApp.getActive();

  const possibleSheet =
    ss.getSheetByName(
      CONFIG.POSSIBLE_MATCHES_SHEET
    );

  if(!possibleSheet)
    return;

  const values =
    possibleSheet.getDataRange().getValues();

  if(values.length <= 1)
    return;

  const clientSheet =
    getClientAliasSheet();

  const clientAliases =
    loadClientAliases();

  //--------------------------------------------------
  // Process Suggestions
  //--------------------------------------------------

  for(let i=1;i<values.length;i++){

    const row = values[i];

    const type = row[0];

    const official = String(row[1]).trim();

    const alias = String(row[2]).trim();

    const action = String(row[5]).trim().toLowerCase();

    if(action != "approved")
      continue;

    //--------------------------------------------------
    // Client Alias
    //--------------------------------------------------

    if(type == "Client"){

      const key =
        normalizeText(alias);

      if(!clientAliases[key]){

        clientSheet.appendRow([

          alias,

          official

        ]);

        clientAliases[key] = official;

      }

    }

    //--------------------------------------------------
    // Mark Imported
    //--------------------------------------------------

    possibleSheet
      .getRange(i+1,6)
      .setValue("Imported");

  }

}