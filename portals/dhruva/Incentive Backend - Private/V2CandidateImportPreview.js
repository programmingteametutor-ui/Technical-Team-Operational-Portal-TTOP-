/******************************************************
 * V2CANDIDATEIMPORTPREVIEW.GS
 * Interview Operations Portal V2
 *
 * READ-ONLY Candidate Master import preview
 *
 * SOURCE SHEET:
 *   V2 Candidate Source
 *
 * EXPECTED SOURCE HEADERS:
 *   Candidate Name
 *   Email ID
 *   Active Status
 *   Assigned Domains
 *   Location
 *   Assigned To
 *   Priority Student
 *   Date of Joining
 *   Visa Type
 *   Experience
 *
 * IMPORTANT
 * ---------
 * - Does NOT write Candidate Master.
 * - Does NOT alter the source sheet.
 * - Does NOT alter Gateway / Raw / Team / incentives.
 * - Official candidate name is preserved from source.
 * - Email is used only as the external import identity key.
 * - Duplicate names are allowed and are never auto-merged.
 ******************************************************/


const V2_CANDIDATE_IMPORT_CONFIG =
  Object.freeze({

    VERSION:
      "V2-CANDIDATE-IMPORT-PREVIEW-1.0.0",

    SOURCE_SHEET:
      "V2 Candidate Source",

    SOURCE_HEADERS: [
      "Candidate Name",
      "Email ID",
      "Active Status",
      "Assigned Domains",
      "Location",
      "Assigned To",
      "Priority Student",
      "Date of Joining",
      "Visa Type",
      "Experience"
    ],

    CANDIDATE_ID_PREFIX:
      "CAN-",

    CANDIDATE_ID_WIDTH:
      6

  });


/******************************************************
 * PUBLIC: READ-ONLY SOURCE + IMPORT PREVIEW
 ******************************************************/
function V2_previewCandidateMasterImport(){

  const source =
    V2CandidateImport_readSource_();

  const existing =
    V2Repo_getCandidates();

  const sourceAnalysis =
    V2CandidateImport_analyzeSource_(
      source.rows
    );

  const masterAnalysis =
    V2CandidateImport_analyzeExistingMaster_(
      existing
    );

  const proposal =
    V2CandidateImport_buildProposal_(
      source.rows,
      existing
    );

  const result = {

    ok:
      (
        sourceAnalysis.blockingIssues ===
          0 &&
        masterAnalysis.blockingIssues ===
          0 &&
        proposal.blockingIssues ===
          0
      ),

    mode:
      "READ_ONLY",

    version:
      V2_CANDIDATE_IMPORT_CONFIG
        .VERSION,

    sourceSheet:
      V2_CANDIDATE_IMPORT_CONFIG
        .SOURCE_SHEET,

    sourceFingerprint:
      V2CandidateImport_sourceFingerprint_(
        source.rows
      ),

    counts: {

      sourceRows:
        source.rows.length,

      existingCandidateMasterRows:
        existing.length,

      proposedInsert:
        proposal.insertCount,

      proposedUpdate:
        proposal.updateCount,

      proposedUnchanged:
        proposal.unchangedCount,

      blocked:
        proposal.blockedCount

    },

    sourceQuality:
      sourceAnalysis.summary,

    existingMasterQuality:
      masterAnalysis.summary,

    duplicateNameGroups:
      sourceAnalysis
        .duplicateNameGroups,

    first20BlockedRows:
      proposal.blockedRows
        .slice(
          0,
          20
        ),

    first20ProposedRows:
      proposal.proposedRows
        .slice(
          0,
          20
        )

  };

  Logger.log(
    "========== V2 CANDIDATE MASTER IMPORT PREVIEW =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "========================================================"
  );

  return result;

}


/******************************************************
 * PRIVATE: READ SOURCE
 ******************************************************/
function V2CandidateImport_readSource_(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CANDIDATE_IMPORT_CONFIG
        .SOURCE_SHEET
    );

  if(!sheet){
    throw new Error(
      "V2_CANDIDATE_SOURCE_SHEET_NOT_FOUND|sheet=" +
      V2_CANDIDATE_IMPORT_CONFIG
        .SOURCE_SHEET
    );
  }

  const lastRow =
    sheet.getLastRow();

  const lastColumn =
    sheet.getLastColumn();

  if(
    lastRow < 1 ||
    lastColumn < 1
  ){
    throw new Error(
      "V2_CANDIDATE_SOURCE_EMPTY"
    );
  }

  const expected =
    V2_CANDIDATE_IMPORT_CONFIG
      .SOURCE_HEADERS;

  if(
    lastColumn <
    expected.length
  ){
    throw new Error(
      "V2_CANDIDATE_SOURCE_TOO_FEW_COLUMNS|expected=" +
      expected.length +
      "|actual=" +
      lastColumn
    );
  }

  const headers =
    sheet
      .getRange(
        1,
        1,
        1,
        expected.length
      )
      .getValues()[0]
      .map(
        function(value){
          return String(
            value || ""
          ).trim();
        }
      );

  for(
    let i = 0;
    i < expected.length;
    i++
  ){

    if(
      headers[i] !==
      expected[i]
    ){
      throw new Error(
        "V2_CANDIDATE_SOURCE_HEADER_MISMATCH|column=" +
        (i + 1) +
        "|expected=" +
        expected[i] +
        "|actual=" +
        headers[i]
      );
    }

  }

  if(lastRow === 1){
    return {
      headers:
        headers,
      rows:
        []
    };
  }

  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        expected.length
      )
      .getValues();

  const rows = [];

  values.forEach(
    function(row,index){

      if(
        V2CandidateImport_isBlankRow_(
          row
        )
      ){
        return;
      }

      rows.push({
        sourceRow:
          index + 2,

        candidateName:
          String(
            row[0] || ""
          ).trim(),

        email:
          String(
            row[1] || ""
          ).trim(),

        activeStatus:
          String(
            row[2] || ""
          ).trim(),

        assignedDomains:
          String(
            row[3] || ""
          ).trim(),

        location:
          String(
            row[4] || ""
          ).trim(),

        assignedToName:
          String(
            row[5] || ""
          ).trim(),

        priorityStudent:
          String(
            row[6] || ""
          ).trim(),

        dateOfJoiningRaw:
          row[7],

        visaType:
          String(
            row[8] || ""
          ).trim(),

        experienceRaw:
          row[9]
      });

    }
  );

  return {
    headers:
      headers,
    rows:
      rows
  };

}


/******************************************************
 * PRIVATE: ANALYZE SOURCE QUALITY
 ******************************************************/
function V2CandidateImport_analyzeSource_(
  rows
){

  const emailGroups = {};
  const nameGroups = {};

  let missingName = 0;
  let missingEmail = 0;
  let invalidEmail = 0;
  let invalidDateOfJoining = 0;
  let invalidExperience = 0;
  let invalidPriority = 0;

  const activeStatusValues = {};
  const priorityValues = {};
  const locationValues = {};
  const visaValues = {};
  const assignedToValues = {};

  rows.forEach(
    function(row){

      const emailKey =
        V2CandidateImport_normalizeEmail_(
          row.email
        );

      const nameKey =
        V2CandidateImport_normalizeName_(
          row.candidateName
        );

      if(!row.candidateName){
        missingName++;
      }

      if(!row.email){
        missingEmail++;
      }else if(
        !V2CandidateImport_isValidEmail_(
          row.email
        )
      ){
        invalidEmail++;
      }

      if(emailKey){

        if(!emailGroups[emailKey]){
          emailGroups[emailKey] = [];
        }

        emailGroups[emailKey].push({
          sourceRow:
            row.sourceRow,
          candidateName:
            row.candidateName,
          email:
            row.email
        });

      }

      if(nameKey){

        if(!nameGroups[nameKey]){
          nameGroups[nameKey] = [];
        }

        nameGroups[nameKey].push({
          sourceRow:
            row.sourceRow,
          candidateName:
            row.candidateName,
          email:
            row.email
        });

      }

      if(
        !V2CandidateImport_parseDate_(
          row.dateOfJoiningRaw
        )
      ){
        invalidDateOfJoining++;
      }

      if(
        V2CandidateImport_parseExperience_(
          row.experienceRaw
        ) === null
      ){
        invalidExperience++;
      }

      const priority =
        V2CandidateImport_normalizeYesNo_(
          row.priorityStudent
        );

      if(!priority){
        invalidPriority++;
      }

      V2CandidateImport_countValue_(
        activeStatusValues,
        row.activeStatus
      );

      V2CandidateImport_countValue_(
        priorityValues,
        row.priorityStudent
      );

      V2CandidateImport_countValue_(
        locationValues,
        row.location
      );

      V2CandidateImport_countValue_(
        visaValues,
        row.visaType
      );

      V2CandidateImport_countValue_(
        assignedToValues,
        row.assignedToName
      );

    }
  );

  const duplicateEmailGroups =
    Object.keys(
      emailGroups
    )
      .filter(
        function(key){
          return (
            emailGroups[key]
              .length > 1
          );
        }
      )
      .map(
        function(key){
          return {
            normalizedEmail:
              key,
            records:
              emailGroups[key]
          };
        }
      );

  const duplicateNameGroups =
    Object.keys(
      nameGroups
    )
      .filter(
        function(key){
          return (
            nameGroups[key]
              .length > 1
          );
        }
      )
      .map(
        function(key){
          return {
            normalizedName:
              key,
            count:
              nameGroups[key]
                .length,
            records:
              nameGroups[key]
          };
        }
      );

  const blockingIssues =
    missingName +
    missingEmail +
    invalidEmail +
    invalidDateOfJoining +
    invalidExperience +
    invalidPriority +
    duplicateEmailGroups.length;

  return {

    blockingIssues:
      blockingIssues,

    duplicateNameGroups:
      duplicateNameGroups,

    summary: {

      missingName:
        missingName,

      missingEmail:
        missingEmail,

      invalidEmail:
        invalidEmail,

      duplicateEmailGroups:
        duplicateEmailGroups.length,

      duplicateNameGroups:
        duplicateNameGroups.length,

      invalidDateOfJoining:
        invalidDateOfJoining,

      invalidExperience:
        invalidExperience,

      invalidPriorityStudent:
        invalidPriority,

      distinctActiveStatusValues:
        Object.keys(
          activeStatusValues
        ).length,

      distinctPriorityValues:
        Object.keys(
          priorityValues
        ).length,

      distinctLocationValues:
        Object.keys(
          locationValues
        ).length,

      distinctVisaTypeValues:
        Object.keys(
          visaValues
        ).length,

      distinctAssignedToValues:
        Object.keys(
          assignedToValues
        ).length

    }

  };

}


/******************************************************
 * PRIVATE: ANALYZE EXISTING MASTER
 ******************************************************/
function V2CandidateImport_analyzeExistingMaster_(
  existing
){

  const emailGroups = {};
  const idGroups = {};

  existing.forEach(
    function(row){

      const emailKey =
        V2CandidateImport_normalizeEmail_(
          row["Email"]
        );

      const candidateId =
        String(
          row["Candidate ID"] || ""
        ).trim();

      if(emailKey){

        if(!emailGroups[emailKey]){
          emailGroups[emailKey] = [];
        }

        emailGroups[emailKey]
          .push(
            candidateId
          );

      }

      if(candidateId){

        if(!idGroups[candidateId]){
          idGroups[candidateId] = 0;
        }

        idGroups[candidateId]++;

      }

    }
  );

  const duplicateEmailGroups =
    Object.keys(
      emailGroups
    )
      .filter(
        function(key){
          return (
            emailGroups[key]
              .length > 1
          );
        }
      );

  const duplicateCandidateIds =
    Object.keys(
      idGroups
    )
      .filter(
        function(key){
          return (
            idGroups[key] > 1
          );
        }
      );

  return {

    blockingIssues:
      duplicateEmailGroups.length +
      duplicateCandidateIds.length,

    summary: {

      duplicateEmailGroups:
        duplicateEmailGroups.length,

      duplicateCandidateIds:
        duplicateCandidateIds.length

    }

  };

}


/******************************************************
 * PRIVATE: BUILD READ-ONLY PROPOSAL
 ******************************************************/
function V2CandidateImport_buildProposal_(
  sourceRows,
  existing
){

  const existingByEmail = {};

  existing.forEach(
    function(row){

      const emailKey =
        V2CandidateImport_normalizeEmail_(
          row["Email"]
        );

      if(!emailKey)
        return;

      if(!existingByEmail[emailKey]){
        existingByEmail[emailKey] = [];
      }

      existingByEmail[emailKey]
        .push(
          row
        );

    }
  );

  let nextSequence =
    V2CandidateImport_nextCandidateSequence_(
      existing
    );

  const newEmails =
    sourceRows
      .map(
        function(row){
          return V2CandidateImport_normalizeEmail_(
            row.email
          );
        }
      )
      .filter(
        function(emailKey){

          return (
            emailKey &&
            !existingByEmail[emailKey]
          );

        }
      );

  const uniqueNewEmails =
    V2CandidateImport_unique_(
      newEmails
    )
      .sort();

  const proposedIds = {};

  uniqueNewEmails.forEach(
    function(emailKey){

      proposedIds[emailKey] =
        V2CandidateImport_candidateId_(
          nextSequence
        );

      nextSequence++;

    }
  );

  const proposedRows = [];
  const blockedRows = [];

  let insertCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  let blockedCount = 0;

  sourceRows.forEach(
    function(source){

      const emailKey =
        V2CandidateImport_normalizeEmail_(
          source.email
        );

      const sourceIssues =
        V2CandidateImport_rowIssues_(
          source
        );

      if(
        sourceIssues.length
      ){

        blockedCount++;

        blockedRows.push({
          sourceRow:
            source.sourceRow,
          candidateName:
            source.candidateName,
          email:
            source.email,
          issues:
            sourceIssues
        });

        return;

      }

      const matches =
        existingByEmail[emailKey] ||
        [];

      if(
        matches.length > 1
      ){

        blockedCount++;

        blockedRows.push({
          sourceRow:
            source.sourceRow,
          candidateName:
            source.candidateName,
          email:
            source.email,
          issues: [
            "EMAIL_MATCHES_MULTIPLE_MASTER_RECORDS"
          ]
        });

        return;

      }

      const candidateId =
        matches.length === 1
          ? String(
              matches[0][
                "Candidate ID"
              ] || ""
            ).trim()
          : proposedIds[
              emailKey
            ];

      const proposed =
        V2CandidateImport_buildCandidateProfile_(
          source,
          candidateId
        );

      let operation =
        "INSERT";

      if(
        matches.length === 1
      ){

        if(
          V2CandidateImport_profileEquals_(
            matches[0],
            proposed
          )
        ){

          operation =
            "UNCHANGED";

          unchangedCount++;

        }else{

          operation =
            "UPDATE";

          updateCount++;

        }

      }else{

        insertCount++;

      }

      proposedRows.push({

        operation:
          operation,

        sourceRow:
          source.sourceRow,

        candidateId:
          candidateId,

        officialCandidateName:
          source.candidateName,

        email:
          source.email,

        activeStatus:
          source.activeStatus,

        assignedDomains:
          source.assignedDomains,

        location:
          source.location,

        assignedToName:
          source.assignedToName,

        priorityStudent:
          V2CandidateImport_normalizeYesNo_(
            source.priorityStudent
          ),

        dateOfJoining:
          V2CandidateImport_formatDate_(
            V2CandidateImport_parseDate_(
              source.dateOfJoiningRaw
            )
          ),

        visaType:
          source.visaType,

        experience:
          V2CandidateImport_parseExperience_(
            source.experienceRaw
          )

      });

    }
  );

  return {

    insertCount:
      insertCount,

    updateCount:
      updateCount,

    unchangedCount:
      unchangedCount,

    blockedCount:
      blockedCount,

    blockingIssues:
      blockedCount,

    proposedRows:
      proposedRows,

    blockedRows:
      blockedRows

  };

}


/******************************************************
 * PRIVATE: BUILD CANDIDATE PROFILE OBJECT
 ******************************************************/
function V2CandidateImport_buildCandidateProfile_(
  source,
  candidateId
){

  return {

    "Candidate ID":
      candidateId,

    "Official Candidate Name":
      source.candidateName,

    // System record remains enabled even when the
    // source candidate's operational status is Inactive.
    "Active":
      true,

    "Notes":
      "",

    "Email":
      source.email,

    "Active Status":
      source.activeStatus,

    "Assigned Domains":
      source.assignedDomains,

    "Location":
      source.location,

    // User ID is intentionally unresolved here.
    // The later User/Handler mapping phase owns it.
    "Assigned To User ID":
      "",

    "Assigned To Name":
      source.assignedToName,

    "Priority Student":
      V2CandidateImport_normalizeYesNo_(
        source.priorityStudent
      ),

    "Date of Joining":
      V2CandidateImport_parseDate_(
        source.dateOfJoiningRaw
      ),

    "Visa Type":
      source.visaType,

    "Experience":
      V2CandidateImport_parseExperience_(
        source.experienceRaw
      )

  };

}


/******************************************************
 * PRIVATE: PROFILE COMPARISON
 ******************************************************/
function V2CandidateImport_profileEquals_(
  existing,
  proposed
){

  const fields = [
    "Candidate ID",
    "Official Candidate Name",
    "Email",
    "Active Status",
    "Assigned Domains",
    "Location",
    "Assigned To User ID",
    "Assigned To Name",
    "Priority Student",
    "Visa Type",
    "Experience"
  ];

  for(
    let i = 0;
    i < fields.length;
    i++
  ){

    const field =
      fields[i];

    if(
      String(
        existing[field] || ""
      ).trim() !==
      String(
        proposed[field] || ""
      ).trim()
    ){
      return false;
    }

  }

  const existingDate =
    V2CandidateImport_parseDate_(
      existing[
        "Date of Joining"
      ]
    );

  const proposedDate =
    V2CandidateImport_parseDate_(
      proposed[
        "Date of Joining"
      ]
    );

  return (
    V2CandidateImport_dateKey_(
      existingDate
    ) ===
    V2CandidateImport_dateKey_(
      proposedDate
    )
  );

}


/******************************************************
 * PRIVATE: ROW VALIDATION
 ******************************************************/
function V2CandidateImport_rowIssues_(
  row
){

  const issues = [];

  if(!row.candidateName){
    issues.push(
      "MISSING_CANDIDATE_NAME"
    );
  }

  if(!row.email){
    issues.push(
      "MISSING_EMAIL"
    );
  }else if(
    !V2CandidateImport_isValidEmail_(
      row.email
    )
  ){
    issues.push(
      "INVALID_EMAIL"
    );
  }

  if(
    !V2CandidateImport_parseDate_(
      row.dateOfJoiningRaw
    )
  ){
    issues.push(
      "INVALID_DATE_OF_JOINING"
    );
  }

  if(
    V2CandidateImport_parseExperience_(
      row.experienceRaw
    ) === null
  ){
    issues.push(
      "INVALID_EXPERIENCE"
    );
  }

  if(
    !V2CandidateImport_normalizeYesNo_(
      row.priorityStudent
    )
  ){
    issues.push(
      "INVALID_PRIORITY_STUDENT"
    );
  }

  return issues;

}


/******************************************************
 * PRIVATE: NEXT CANDIDATE SEQUENCE
 ******************************************************/
function V2CandidateImport_nextCandidateSequence_(
  existing
){

  let maxSequence = 0;

  existing.forEach(
    function(row){

      const candidateId =
        String(
          row["Candidate ID"] || ""
        ).trim();

      const match =
        candidateId.match(
          /^CAN-(\d+)$/i
        );

      if(!match)
        return;

      const sequence =
        Number(
          match[1]
        );

      if(
        sequence >
        maxSequence
      ){
        maxSequence =
          sequence;
      }

    }
  );

  return (
    maxSequence + 1
  );

}


/******************************************************
 * PRIVATE: CANDIDATE ID
 ******************************************************/
function V2CandidateImport_candidateId_(
  sequence
){

  const width =
    V2_CANDIDATE_IMPORT_CONFIG
      .CANDIDATE_ID_WIDTH;

  const numberText =
    String(
      Number(
        sequence
      )
    );

  return (
    V2_CANDIDATE_IMPORT_CONFIG
      .CANDIDATE_ID_PREFIX +
    "0".repeat(
      Math.max(
        0,
        width -
        numberText.length
      )
    ) +
    numberText
  );

}


/******************************************************
 * PRIVATE: SOURCE FINGERPRINT
 ******************************************************/
function V2CandidateImport_sourceFingerprint_(
  rows
){

  const material =
    rows
      .map(
        function(row){

          return [
            row.candidateName,
            row.email,
            row.activeStatus,
            row.assignedDomains,
            row.location,
            row.assignedToName,
            row.priorityStudent,
            V2CandidateImport_dateKey_(
              V2CandidateImport_parseDate_(
                row.dateOfJoiningRaw
              )
            ),
            row.visaType,
            String(
              row.experienceRaw || ""
            ).trim()
          ].join(
            "\u001F"
          );

        }
      )
      .join(
        "\u001E"
      );

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm
        .SHA_256,
      material,
      Utilities.Charset
        .UTF_8
    );

  const hex =
    digest
      .map(
        function(byte){

          const value =
            byte < 0
              ? byte + 256
              : byte;

          return (
            "0" +
            value.toString(16)
          ).slice(-2);

        }
      )
      .join("")
      .toUpperCase();

  return (
    "CANDSRC-" +
    hex.substring(
      0,
      20
    )
  );

}


/******************************************************
 * PRIVATE: DATE PARSER
 *
 * Supports:
 * - native Date
 * - dd/MM/yyyy
 * - dd-MM-yyyy
 ******************************************************/
function V2CandidateImport_parseDate_(
  value
){

  if(
    value instanceof Date &&
    !isNaN(
      value.getTime()
    )
  ){

    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    );

  }

  const text =
    String(
      value || ""
    ).trim();

  const match =
    text.match(
      /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/
    );

  if(!match)
    return null;

  const day =
    Number(
      match[1]
    );

  const month =
    Number(
      match[2]
    );

  const year =
    Number(
      match[3]
    );

  const date =
    new Date(
      year,
      month - 1,
      day
    );

  if(
    date.getFullYear() !== year ||
    date.getMonth() !==
      month - 1 ||
    date.getDate() !== day
  ){
    return null;
  }

  return date;

}


/******************************************************
 * PRIVATE: EXPERIENCE PARSER
 ******************************************************/
function V2CandidateImport_parseExperience_(
  value
){

  if(
    typeof value ===
      "number" &&
    isFinite(value)
  ){
    return value;
  }

  const text =
    String(
      value || ""
    )
      .trim()
      .replace(
        /,/g,
        ""
      );

  if(!text)
    return null;

  const number =
    Number(
      text
    );

  return isFinite(number)
    ? number
    : null;

}


/******************************************************
 * PRIVATE: NORMALIZATION
 ******************************************************/
function V2CandidateImport_normalizeEmail_(
  value
){

  return String(
    value || ""
  )
    .trim()
    .toLowerCase();

}


function V2CandidateImport_normalizeName_(
  value
){

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


function V2CandidateImport_normalizeYesNo_(
  value
){

  const key =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if(key === "yes")
    return "Yes";

  if(key === "no")
    return "No";

  return "";

}


/******************************************************
 * PRIVATE: EMAIL VALIDATION
 ******************************************************/
function V2CandidateImport_isValidEmail_(
  value
){

  const text =
    String(
      value || ""
    ).trim();

  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(
        text
      )
  );

}


/******************************************************
 * PRIVATE: DATE FORMAT
 ******************************************************/
function V2CandidateImport_formatDate_(
  date
){

  if(
    !(date instanceof Date) ||
    isNaN(
      date.getTime()
    )
  ){
    return "";
  }

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );

}


function V2CandidateImport_dateKey_(
  date
){

  return V2CandidateImport_formatDate_(
    date
  );

}


/******************************************************
 * PRIVATE: HELPERS
 ******************************************************/
function V2CandidateImport_isBlankRow_(
  row
){

  for(
    let i = 0;
    i < row.length;
    i++
  ){

    if(
      String(
        row[i] || ""
      ).trim() !== ""
    ){
      return false;
    }

  }

  return true;

}


function V2CandidateImport_countValue_(
  map,
  value
){

  const key =
    String(
      value || ""
    ).trim();

  if(!key)
    return;

  map[key] =
    (
      map[key] || 0
    ) + 1;

}


function V2CandidateImport_unique_(
  values
){

  const seen = {};
  const result = [];

  values.forEach(
    function(value){

      if(
        seen[value]
      ){
        return;
      }

      seen[value] = true;

      result.push(
        value
      );

    }
  );

  return result;

}
