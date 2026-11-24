/******************************************************
 * V2GATEWAYDIAGNOSTICS.GS
 * Read-only diagnostics for V2 Gateway schema V1.2.
 *
 * Safe:
 * - Does NOT edit Raw Data
 * - Does NOT edit Team Data
 * - Does NOT edit V2 Interview Gateway
 ******************************************************/

function V2_summarizeGatewayReviews(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.GATEWAY
    );

  if(!sheet){
    throw new Error(
      "V2_GATEWAY_SHEET_NOT_FOUND"
    );
  }

  const values =
    sheet
      .getDataRange()
      .getDisplayValues();

  if(values.length < 2){

    const empty = {
      ok: true,
      totalRows: 0
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

  const headers =
    values[0].map(
      function(v){
        return String(
          v || ""
        ).trim();
      }
    );

  const idx = {};

  headers.forEach(
    function(header,i){
      idx[header] = i;
    }
  );

  [
    "Source Row",
    "Original Record",
    "Candidate Raw",
    "Client Raw",
    "Duration Minutes",
    "Round Label",
    "Interview Type",
    "Stage Descriptor",
    "Data Completeness",
    "Missing Fields",
    "Scheduling Readiness",
    "Parse Status",
    "Review Reason"
  ].forEach(
    function(required){

      if(
        idx[required] ===
        undefined
      ){
        throw new Error(
          "V2_GATEWAY_HEADER_MISSING|" +
          required
        );
      }

    }
  );

  const parseStatusCounts = {};
  const completenessCounts = {};
  const readinessCounts = {};
  const missingFieldCounts = {};
  const reviewReasonCounts = {};

  const parseReviewSamples = [];
  const incompleteSamples = [];

  function addCount_(obj,key){

    obj[key] =
      (
        obj[key] || 0
      ) + 1;

  }

  function splitPipe_(value){

    return String(
      value || ""
    )
      .split(
        /\s*\|\s*/
      )
      .map(
        function(v){
          return String(
            v || ""
          ).trim();
        }
      )
      .filter(Boolean);

  }

  for(
    let r = 1;
    r < values.length;
    r++
  ){

    const row =
      values[r];

    const parseStatus =
      String(
        row[
          idx[
            "Parse Status"
          ]
        ] || ""
      ).trim() || "BLANK";

    const completeness =
      String(
        row[
          idx[
            "Data Completeness"
          ]
        ] || ""
      ).trim() || "BLANK";

    const readiness =
      String(
        row[
          idx[
            "Scheduling Readiness"
          ]
        ] || ""
      ).trim() || "BLANK";

    addCount_(
      parseStatusCounts,
      parseStatus
    );

    addCount_(
      completenessCounts,
      completeness
    );

    addCount_(
      readinessCounts,
      readiness
    );

    const missingText =
      String(
        row[
          idx[
            "Missing Fields"
          ]
        ] || ""
      ).trim();

    splitPipe_(
      missingText
    ).forEach(
      function(field){
        addCount_(
          missingFieldCounts,
          field
        );
      }
    );

    const reasonText =
      String(
        row[
          idx[
            "Review Reason"
          ]
        ] || ""
      ).trim();

    splitPipe_(
      reasonText
    ).forEach(
      function(reason){
        addCount_(
          reviewReasonCounts,
          reason
        );
      }
    );

    function sampleObject_(){

      let original =
        String(
          row[
            idx[
              "Original Record"
            ]
          ] || ""
        ).trim();

      if(
        original.length >
        190
      ){
        original =
          original.substring(
            0,
            187
          ) + "...";
      }

      return {
        sheetRow:
          r + 1,
        sourceRow:
          row[
            idx[
              "Source Row"
            ]
          ],
        candidate:
          row[
            idx[
              "Candidate Raw"
            ]
          ],
        client:
          row[
            idx[
              "Client Raw"
            ]
          ],
        interviewType:
          row[
            idx[
              "Interview Type"
            ]
          ],
        stageDescriptor:
          row[
            idx[
              "Stage Descriptor"
            ]
          ],
        durationMinutes:
          row[
            idx[
              "Duration Minutes"
            ]
          ],
        round:
          row[
            idx[
              "Round Label"
            ]
          ],
        dataCompleteness:
          completeness,
        missingFields:
          missingText,
        schedulingReadiness:
          readiness,
        parseStatus:
          parseStatus,
        reviewReason:
          reasonText,
        originalRecord:
          original
      };
    }

    if(
      parseStatus ===
        "REVIEW" &&
      parseReviewSamples.length <
        15
    ){

      parseReviewSamples.push(
        sampleObject_()
      );

    }

    if(
      completeness !==
        "COMPLETE" &&
      incompleteSamples.length <
        15
    ){

      incompleteSamples.push(
        sampleObject_()
      );

    }

  }

  function sortedCounts_(
    object
  ){

    return Object.keys(
      object
    )
      .map(
        function(key){
          return {
            value:
              key,
            count:
              object[key]
          };
        }
      )
      .sort(
        function(a,b){
          return (
            b.count -
            a.count
          );
        }
      );

  }

  const result = {
    ok: true,
    totalRows:
      values.length - 1,
    parseStatus:
      sortedCounts_(
        parseStatusCounts
      ),
    dataCompleteness:
      sortedCounts_(
        completenessCounts
      ),
    schedulingReadiness:
      sortedCounts_(
        readinessCounts
      ),
    missingFields:
      sortedCounts_(
        missingFieldCounts
      ),
    parseReviewReasons:
      sortedCounts_(
        reviewReasonCounts
      ),
    first15ParseReviewSamples:
      parseReviewSamples,
    first15IncompleteSamples:
      incompleteSamples
  };

  Logger.log(
    "========== V2 GATEWAY STATUS SUMMARY =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==============================================="
  );

  return result;
}


/******************************************************
 * PUBLIC: TARGETED REMAINING PARSE-REVIEW ANALYSIS
 *
 * READ-ONLY.
 *
 * Purpose:
 * - Group the remaining CLIENT_HAS_MULTIPLE... rows by
 *   obvious source-pattern families.
 * - Print ALL CLIENT_NOT_EXTRACTED rows (expected small).
 * - Show a small sample of still-unclassified "OTHER"
 *   multiple-segment rows.
 ******************************************************/
function V2_analyzeRemainingParseReviewPatterns(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.GATEWAY
    );

  if(!sheet){
    throw new Error(
      "V2_GATEWAY_SHEET_NOT_FOUND"
    );
  }

  const values =
    sheet
      .getDataRange()
      .getDisplayValues();

  if(values.length < 2){
    Logger.log(
      "V2 Interview Gateway has no data rows."
    );
    return {
      ok: true,
      totalReviewRows: 0
    };
  }

  const headers =
    values[0].map(
      function(v){
        return String(
          v || ""
        ).trim();
      }
    );

  const idx = {};

  headers.forEach(
    function(header,i){
      idx[header] = i;
    }
  );

  [
    "Source Row",
    "Original Record",
    "Candidate Raw",
    "Client Raw",
    "Interview Type",
    "Stage Descriptor",
    "Parse Status",
    "Review Reason"
  ].forEach(
    function(required){
      if(
        idx[required] ===
        undefined
      ){
        throw new Error(
          "V2_GATEWAY_HEADER_MISSING|" +
          required
        );
      }
    }
  );

  const categoryCounts = {};
  const clientNotExtracted = [];
  const otherMultipleSamples = [];

  let totalReviewRows = 0;
  let multipleRows = 0;

  function addCount_(key){
    categoryCounts[key] =
      (
        categoryCounts[key] || 0
      ) + 1;
  }

  function compact_(value,maxLength){

    let text =
      String(
        value || ""
      ).trim();

    if(
      text.length >
      maxLength
    ){
      text =
        text.substring(
          0,
          maxLength - 3
        ) + "...";
    }

    return text;
  }

  function sample_(row,r){

    return {
      sheetRow:
        r + 1,
      sourceRow:
        row[
          idx[
            "Source Row"
          ]
        ],
      candidate:
        row[
          idx[
            "Candidate Raw"
          ]
        ],
      currentClient:
        row[
          idx[
            "Client Raw"
          ]
        ],
      interviewType:
        row[
          idx[
            "Interview Type"
          ]
        ],
      stageDescriptor:
        row[
          idx[
            "Stage Descriptor"
          ]
        ],
      reviewReason:
        row[
          idx[
            "Review Reason"
          ]
        ],
      originalRecord:
        compact_(
          row[
            idx[
              "Original Record"
            ]
          ],
          220
        )
    };
  }

  for(
    let r = 1;
    r < values.length;
    r++
  ){

    const row =
      values[r];

    const parseStatus =
      String(
        row[
          idx[
            "Parse Status"
          ]
        ] || ""
      ).trim();

    if(
      parseStatus !==
        "REVIEW"
    ){
      continue;
    }

    totalReviewRows++;

    const reason =
      String(
        row[
          idx[
            "Review Reason"
          ]
        ] || ""
      );

    const original =
      String(
        row[
          idx[
            "Original Record"
          ]
        ] || ""
      );

    if(
      reason.indexOf(
        "CLIENT_NOT_EXTRACTED"
      ) > -1
    ){

      clientNotExtracted.push(
        sample_(
          row,
          r
        )
      );

    }

    if(
      reason.indexOf(
        "CLIENT_HAS_MULTIPLE_UNCLASSIFIED_SEGMENTS"
      ) === -1
    ){
      continue;
    }

    multipleRows++;

    let category = "";

    if(
      /\bTechnical\s+Interview\b/i.test(
        original
      )
    ){
      category =
        "TECHNICAL_INTERVIEW";
    }else if(
      /\bPanel\s+Interview\b/i.test(
        original
      )
    ){
      category =
        "PANEL_INTERVIEW";
    }else if(
      /\bPrep\s+Call\b/i.test(
        original
      )
    ){
      category =
        "PREP_CALL";
    }else if(
      /\bInterview\s*\([^)]*\)/i.test(
        original
      )
    ){
      category =
        "INTERVIEW_WITH_PARENTHETICAL_DESCRIPTOR";
    }else if(
      /\bWaiting\s+for\s+Time\s+Confirmation\s+and\s+Invite\b/i.test(
        original
      )
    ){
      category =
        "WAITING_TIME_CONFIRMATION_AND_INVITE";
    }else if(
      /\bWaiting\s+for\b/i.test(
        original
      )
    ){
      category =
        "OTHER_WAITING_TEXT";
    }else{
      category =
        "OTHER";
    }

    addCount_(
      category
    );

    if(
      category ===
        "OTHER" &&
      otherMultipleSamples.length <
        25
    ){

      otherMultipleSamples.push(
        sample_(
          row,
          r
        )
      );

    }

  }

  const categoryList =
    Object.keys(
      categoryCounts
    )
      .map(
        function(key){
          return {
            category:
              key,
            count:
              categoryCounts[key]
          };
        }
      )
      .sort(
        function(a,b){
          return (
            b.count -
            a.count
          );
        }
      );

  const result = {
    ok: true,
    totalReviewRows:
      totalReviewRows,
    multipleSegmentRows:
      multipleRows,
    multipleSegmentPatternCounts:
      categoryList,
    clientNotExtractedCount:
      clientNotExtracted.length,
    allClientNotExtractedRows:
      clientNotExtracted,
    first25OtherMultipleSegmentRows:
      otherMultipleSamples
  };

  Logger.log(
    "========== V2 REMAINING REVIEW PATTERNS =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "=================================================="
  );

  return result;
}
function V2_logCompactGatewayReviews(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.GATEWAY
    );

  if(!sheet){
    throw new Error(
      "V2_GATEWAY_SHEET_NOT_FOUND"
    );
  }

  const values =
    sheet
      .getDataRange()
      .getValues();

  if(values.length <= 1){
    Logger.log(
      "No Gateway rows."
    );
    return [];
  }

  const headers =
    values[0].map(
      function(value){
        return String(
          value || ""
        ).trim();
      }
    );

  const col = {};

  headers.forEach(
    function(header,index){
      col[header] = index;
    }
  );

  const required = [
    "Source Row",
    "Original Record",
    "Candidate Raw",
    "Client Raw",
    "Interview Type",
    "Interview Detail",
    "Stage Descriptor",
    "Round Label",
    "Missing Fields",
    "Parse Status",
    "Review Reason"
  ];

  required.forEach(
    function(header){

      if(
        typeof col[header] ===
          "undefined"
      ){
        throw new Error(
          "MISSING_GATEWAY_COLUMN|" +
          header
        );
      }

    }
  );

  const reviews = [];

  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];

    const status =
      String(
        row[col["Parse Status"]] ||
        ""
      )
        .trim()
        .toUpperCase();

    if(status !== "REVIEW")
      continue;

    reviews.push({

      sheetRow:
        i + 1,

      sourceRow:
        row[col["Source Row"]],

      candidate:
        row[col["Candidate Raw"]],

      client:
        row[col["Client Raw"]],

      interviewType:
        row[col["Interview Type"]],

      interviewDetail:
        row[col["Interview Detail"]],

      stage:
        row[col["Stage Descriptor"]],

      round:
        row[col["Round Label"]],

      missing:
        row[col["Missing Fields"]],

      reason:
        row[col["Review Reason"]],

      original:
  row[col["Original Record"]]

    });

  }

  Logger.log(
    "========== V2 COMPACT REVIEW LIST =========="
  );

  reviews.forEach(
    function(item,index){

      Logger.log(
        String(index + 1) +
        " | SourceRow=" +
        item.sourceRow +
        " | Reason=" +
        item.reason +
        " | Candidate=" +
        item.candidate +
        " | Client=" +
        item.client +
        " | Type=" +
        item.interviewType +
        " | Detail=" +
        item.interviewDetail +
        " | Stage=" +
        item.stage +
        " | Round=" +
        item.round +
        " | Missing=" +
        item.missing +
        " | ORIGINAL=" +
        item.original
      );

    }
  );

  Logger.log(
    "TOTAL REVIEW ROWS : " +
    reviews.length
  );

  Logger.log(
    "==========================================="
  );

  return reviews;
}
