/******************************************************
 * V2CANDIDATELOCATIONPREVIEW.GS
 * Interview Operations Portal V2
 *
 * READ-ONLY preview for country/location fallback.
 *
 * PURPOSE
 * -------
 * Start from the 906 currently unresolved Gateway rows,
 * remove the 420 rows already proposed by structural
 * name rules, then test country/location only on the
 * remaining 486 rows.
 *
 * COUNTRY/LOCATION IS SECONDARY EVIDENCE ONLY.
 * It never overrides an incompatible name.
 *
 * Supported proposal paths:
 *
 * A. One-token raw name
 *    Surya (Ireland)
 *    -> find Candidate Master rows containing exact token
 *       "Surya"
 *    -> filter by Ireland
 *    -> exactly one remaining candidate = proposal
 *
 * B. Multiple structurally compatible names
 *    -> use only those structurally compatible candidates
 *    -> filter by source country/location
 *    -> exactly one remaining candidate = proposal
 *
 * NO_STRUCTURAL_MATCH rows are measured but NOT
 * auto-proposed by country alone in this version.
 *
 * SAFETY
 * ------
 * - NO WRITES.
 * - NO Gateway rebuild.
 * - NO Candidate Master changes.
 * - Country cannot create a match without name evidence.
 ******************************************************/


const V2_LOCATION_MATCH_PREVIEW = Object.freeze({

  VERSION:
    "V2-CANDIDATE-LOCATION-PREVIEW-1.2.0",

  CURRENT_UNRESOLVED_STATUSES: Object.freeze({
    REVIEW_PARTIAL:
      true,
    REVIEW_INITIAL:
      true,
    REVIEW_NEAR:
      true,
    UNMATCHED:
      true,
    AMBIGUOUS_MASTER_NAME:
      true
  })

});


/******************************************************
 * PUBLIC: MAIN READ-ONLY LOCATION PREVIEW
 ******************************************************/
function V2_previewCandidateLocationFallbackV12(){

  if(
    typeof V2_structuralResolvePreview_ !==
      "function" ||
    typeof V2_structuralBuildMasterRecords_ !==
      "function"
  ){
    throw new Error(
      "V2CandidateStructuralPreview.gs is required."
    );
  }

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const masterRecords =
    V2_structuralBuildMasterRecords_(
      candidates
    );

  const masterById =
    V2_locationBuildMasterById_(
      candidates,
      masterRecords
    );

  const resultRows = [];

  let currentUnresolved = 0;
  let removedByStructuralProposal = 0;

  gateway.forEach(
    function(row,index){

      const currentStatus =
        String(
          row["Candidate Match Status"] || ""
        ).trim();

      if(
        !V2_LOCATION_MATCH_PREVIEW
          .CURRENT_UNRESOLVED_STATUSES[
            currentStatus
          ]
      ){
        return;
      }

      currentUnresolved++;

      const raw =
        String(
          row["Candidate Raw"] || ""
        ).trim();

      const structural =
        V2_structuralResolvePreview_(
          raw,
          masterRecords
        );

      if(
        structural.status ===
          "PROPOSE_AUTO_UNIQUE_PARTIAL" ||
        structural.status ===
          "PROPOSE_AUTO_UNIQUE_INITIAL"
      ){
        removedByStructuralProposal++;
        return;
      }

      const originalRecord =
        String(
          row["Original Record"] || ""
        );

      const sourceLocation =
        V2_locationExtractSourceLocation_(
          originalRecord
        );

      const proposal =
        V2_locationResolveRemaining_(
          raw,
          sourceLocation,
          structural,
          masterRecords,
          masterById
        );

      resultRows.push({

        gatewayRow:
          index + 2,

        gatewayId:
          String(
            row["Gateway ID"] || ""
          ).trim(),

        raw:
          raw,

        currentStatus:
          currentStatus,

        structuralStatus:
          structural.status,

        sourceLocationRaw:
          sourceLocation.raw,

        sourceLocationCanonical:
          sourceLocation.canonical,

        proposal:
          proposal

      });

    }
  );

  const statusByRecord = {};

  resultRows.forEach(
    function(item){

      const status =
        item.proposal.status;

      statusByRecord[status] =
        (
          statusByRecord[status] || 0
        ) + 1;

    }
  );

  const proposedAutoStatuses = {
    PROPOSE_AUTO_LOCATION_SINGLE_TOKEN:
      true,
    PROPOSE_AUTO_LOCATION_DISAMBIGUATED:
      true
  };

  let proposedAutoRecords = 0;
  let stillRemainingRecords = 0;
  let rowsWithUsableSourceLocation = 0;
  let rowsWithoutUsableSourceLocation = 0;

  resultRows.forEach(
    function(item){

      if(
        item.sourceLocationCanonical
      ){
        rowsWithUsableSourceLocation++;
      }else{
        rowsWithoutUsableSourceLocation++;
      }

      if(
        proposedAutoStatuses[
          item.proposal.status
        ]
      ){
        proposedAutoRecords++;
      }else{
        stillRemainingRecords++;
      }

    }
  );

  //--------------------------------------------------
  // Roll proposed rows into unique evidence variants:
  // raw name + source location + proposed Candidate ID.
  //--------------------------------------------------

  const proposalVariantMap = {};

  resultRows.forEach(
    function(item){

      if(
        !proposedAutoStatuses[
          item.proposal.status
        ]
      ){
        return;
      }

      const key =
        [
          V2_structuralNormalize_(
            item.raw
          ),
          item.sourceLocationCanonical,
          item.proposal.candidateId
        ].join(
          "|"
        );

      if(!proposalVariantMap[key]){

        proposalVariantMap[key] = {
          raw:
            item.raw,
          sourceLocation:
            item.sourceLocationCanonical,
          status:
            item.proposal.status,
          candidateId:
            item.proposal.candidateId,
          officialName:
            item.proposal.officialName,
          masterLocation:
            item.proposal.masterLocation,
          records:
            0
        };

      }

      proposalVariantMap[key]
        .records++;

    }
  );

  const proposalVariants =
    Object.keys(
      proposalVariantMap
    )
      .map(
        function(key){
          return proposalVariantMap[key];
        }
      )
      .sort(
        function(a,b){

          if(
            b.records !==
            a.records
          ){
            return (
              b.records -
              a.records
            );
          }

          return String(
            a.raw
          ).localeCompare(
            String(
              b.raw
            )
          );

        }
      );

  //--------------------------------------------------
  // Detect a raw name resolving to DIFFERENT Candidate
  // IDs under different source locations.
  //
  // That is not necessarily wrong; it means the future
  // rule must be location-scoped, never a global alias.
  //--------------------------------------------------

  const idsByRaw = {};

  proposalVariants.forEach(
    function(item){

      const rawKey =
        V2_structuralNormalize_(
          item.raw
        );

      if(!idsByRaw[rawKey]){
        idsByRaw[rawKey] = {};
      }

      idsByRaw[rawKey][
        item.candidateId
      ] = true;

    }
  );

  const locationScopedRawNames =
    Object.keys(
      idsByRaw
    )
      .filter(
        function(rawKey){
          return (
            Object.keys(
              idsByRaw[rawKey]
            ).length > 1
          );
        }
      );

  const examples =
    proposalVariants
      .slice(
        0,
        40
      );

  const blockedExamples =
    resultRows
      .filter(
        function(item){

          return (
            item.proposal.status ===
              "BLOCK_LOCATION_STILL_MULTIPLE" ||
            item.proposal.status ===
              "BLOCK_MULTIPLE_NAME_CANDIDATES_NO_LOCATION"
          );

        }
      )
      .slice(
        0,
        25
      )
      .map(
        function(item){

          return {
            raw:
              item.raw,
            sourceLocation:
              item.sourceLocationCanonical,
            structuralStatus:
              item.structuralStatus,
            proposalStatus:
              item.proposal.status,
            compatibleCandidates:
              item.proposal.compatibleCandidates
          };

        }
      );

  const expectedRemainingAfterStructural =
    486;

  const ok =
    (
      currentUnresolved === 906 &&
      removedByStructuralProposal === 420 &&
      resultRows.length ===
        expectedRemainingAfterStructural &&
      proposedAutoRecords +
        stillRemainingRecords ===
        expectedRemainingAfterStructural
    );

  const result = {

    ok:
      ok,

    mode:
      "READ_ONLY",

    version:
      V2_LOCATION_MATCH_PREVIEW.VERSION,

    baseline: {
      currentUnresolvedGatewayRecords:
        currentUnresolved,
      removedByStructuralProposal:
        removedByStructuralProposal,
      locationPreviewInputRecords:
        resultRows.length
    },

    locationEvidence: {
      withUsableSourceLocation:
        rowsWithUsableSourceLocation,
      withoutUsableSourceLocation:
        rowsWithoutUsableSourceLocation
    },

    proposedResolution: {
      autoGatewayRecords:
        proposedAutoRecords,
      autoEvidenceVariants:
        proposalVariants.length,
      stillUnresolvedGatewayRecords:
        stillRemainingRecords,
      accountedGatewayRecords:
        proposedAutoRecords +
        stillRemainingRecords
    },

    statusByGatewayRecord:
      statusByRecord,

    locationScopedIdentityWarning: {
      rawNamesResolvingToMultipleCandidateIdsByLocation:
        locationScopedRawNames.length,
      rawNameKeys:
        locationScopedRawNames
          .slice(
            0,
            20
          )
    },

    proposalExamples:
      examples,

    blockedExamples:
      blockedExamples

  };

  Logger.log(
    "========== V2 CANDIDATE LOCATION PREVIEW v1.2 =========="
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
 * PUBLIC: COMPACT LOG OF ALL LOCATION PROPOSALS
 *
 * Run only AFTER reviewing main preview summary.
 ******************************************************/
function V2_logCandidateLocationAutoProposalsV12(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const masterRecords =
    V2_structuralBuildMasterRecords_(
      candidates
    );

  const masterById =
    V2_locationBuildMasterById_(
      candidates,
      masterRecords
    );

  const proposalMap = {};

  gateway.forEach(
    function(row){

      const currentStatus =
        String(
          row["Candidate Match Status"] || ""
        ).trim();

      if(
        !V2_LOCATION_MATCH_PREVIEW
          .CURRENT_UNRESOLVED_STATUSES[
            currentStatus
          ]
      ){
        return;
      }

      const raw =
        String(
          row["Candidate Raw"] || ""
        ).trim();

      const structural =
        V2_structuralResolvePreview_(
          raw,
          masterRecords
        );

      if(
        structural.status ===
          "PROPOSE_AUTO_UNIQUE_PARTIAL" ||
        structural.status ===
          "PROPOSE_AUTO_UNIQUE_INITIAL"
      ){
        return;
      }

      const sourceLocation =
        V2_locationExtractSourceLocation_(
          String(
            row["Original Record"] || ""
          )
        );

      const proposal =
        V2_locationResolveRemaining_(
          raw,
          sourceLocation,
          structural,
          masterRecords,
          masterById
        );

      if(
        proposal.status !==
          "PROPOSE_AUTO_LOCATION_SINGLE_TOKEN" &&
        proposal.status !==
          "PROPOSE_AUTO_LOCATION_DISAMBIGUATED"
      ){
        return;
      }

      const key =
        [
          V2_structuralNormalize_(
            raw
          ),
          sourceLocation.canonical,
          proposal.candidateId
        ].join(
          "|"
        );

      if(!proposalMap[key]){

        proposalMap[key] = {
          raw:
            raw,
          sourceLocation:
            sourceLocation.canonical,
          rule:
            proposal.status,
          candidateId:
            proposal.candidateId,
          officialName:
            proposal.officialName,
          masterLocation:
            proposal.masterLocation,
          records:
            0
        };

      }

      proposalMap[key]
        .records++;

    }
  );

  const rows =
    Object.keys(
      proposalMap
    )
      .map(
        function(key){
          return proposalMap[key];
        }
      )
      .sort(
        function(a,b){

          if(
            b.records !==
            a.records
          ){
            return (
              b.records -
              a.records
            );
          }

          return String(
            a.raw
          ).localeCompare(
            String(
              b.raw
            )
          );

        }
      );

  Logger.log(
    "========== V2 LOCATION AUTO PROPOSALS =========="
  );

  rows.forEach(
    function(item,index){

      Logger.log(
        [
          index + 1,
          "Raw=" +
            item.raw,
          "Country=" +
            item.sourceLocation,
          "Records=" +
            item.records,
          "Rule=" +
            item.rule,
          "CandidateID=" +
            item.candidateId,
          "Official=" +
            item.officialName,
          "MasterLocation=" +
            item.masterLocation
        ].join(
          " | "
        )
      );

    }
  );

  Logger.log(
    "TOTAL LOCATION AUTO VARIANTS = " +
    rows.length
  );

  Logger.log(
    "==============================================="
  );

  return {
    ok:
      true,
    mode:
      "READ_ONLY",
    autoEvidenceVariants:
      rows.length
  };

}


/******************************************************
 * PRIVATE: RESOLVE ONE REMAINING ROW
 ******************************************************/
function V2_locationResolveRemaining_(
  rawName,
  sourceLocation,
  structural,
  masterRecords,
  masterById
){

  const rawTokens =
    V2_structuralTokens_(
      rawName
    );

  if(
    !sourceLocation ||
    !sourceLocation.canonical
  ){

    if(
      structural.status ===
        "BLOCK_MULTIPLE_COMPATIBLE"
    ){
      return {
        status:
          "BLOCK_MULTIPLE_NAME_CANDIDATES_NO_LOCATION",
        candidateId:
          "",
        officialName:
          "",
        compatibleCandidates:
          structural.compatibleCandidates || [],
        reason:
          "SOURCE_COUNTRY_NOT_AVAILABLE"
      };
    }

    if(
      structural.status ===
        "NEEDS_LOCATION_RULE"
    ){
      return {
        status:
          "NEEDS_LOCATION_BUT_SOURCE_LOCATION_MISSING",
        candidateId:
          "",
        officialName:
          "",
        compatibleCandidates:
          [],
        reason:
          "ONE_TOKEN_NAME_REQUIRES_LOCATION"
      };
    }

    return {
      status:
        "NO_USABLE_SOURCE_LOCATION",
      candidateId:
        "",
      officialName:
        "",
      compatibleCandidates:
        [],
      reason:
        "COUNTRY_LOCATION_NOT_AVAILABLE"
    };

  }

  //--------------------------------------------------
  // PATH A: ONE-TOKEN NAME
  //
  // Name evidence = exact full token appearing somewhere
  // in Candidate Master official name.
  //--------------------------------------------------

  if(
    rawTokens.length === 1
  ){

    const rawToken =
      rawTokens[0];

    const namePool =
      (masterRecords || [])
        .filter(
          function(master){

            return (
              master.tokens.indexOf(
                rawToken
              ) > -1
            );

          }
        );

    const locationPool =
      V2_locationFilterByCountry_(
        namePool,
        sourceLocation.canonical,
        masterById
      );

    if(
      locationPool.length === 1
    ){

      return {
        status:
          "PROPOSE_AUTO_LOCATION_SINGLE_TOKEN",
        candidateId:
          locationPool[0]
            .candidateId,
        officialName:
          locationPool[0]
            .officialName,
        masterLocation:
          masterById[
            locationPool[0]
              .candidateId
          ].locationRaw,
        compatibleCandidates:
          V2_locationCandidateLabels_(
            namePool,
            masterById
          ),
        reason:
          "ONE_TOKEN_NAME_PLUS_UNIQUE_COUNTRY_MATCH"
      };

    }

    if(
      locationPool.length > 1
    ){

      return {
        status:
          "BLOCK_LOCATION_STILL_MULTIPLE",
        candidateId:
          "",
        officialName:
          "",
        compatibleCandidates:
          V2_locationCandidateLabels_(
            locationPool,
            masterById
          ),
        reason:
          "MULTIPLE_EXACT_TOKEN_CANDIDATES_SHARE_SOURCE_COUNTRY"
      };

    }

    return {
      status:
        "NO_LOCATION_MATCH_FOR_SINGLE_TOKEN",
      candidateId:
        "",
      officialName:
        "",
      compatibleCandidates:
        V2_locationCandidateLabels_(
          namePool,
          masterById
        ),
      reason:
        namePool.length
          ? "NAME_POOL_EXISTS_BUT_COUNTRY_DOES_NOT_MATCH"
          : "NO_EXACT_NAME_TOKEN_POOL"
    };

  }

  //--------------------------------------------------
  // PATH B: STRUCTURAL MATCH WAS AMBIGUOUS
  //
  // Rebuild only the structurally compatible candidate
  // pool, then use country to disambiguate.
  //--------------------------------------------------

  if(
    structural.status ===
      "BLOCK_MULTIPLE_COMPATIBLE"
  ){

    const compatiblePool = [];

    (masterRecords || [])
      .forEach(
        function(master){

          const relation =
            V2_structuralCompatibility_(
              rawTokens,
              master.tokens
            );

          if(
            relation &&
            relation.compatible
          ){
            compatiblePool.push(
              master
            );
          }

        }
      );

    const locationPool =
      V2_locationFilterByCountry_(
        compatiblePool,
        sourceLocation.canonical,
        masterById
      );

    if(
      locationPool.length === 1
    ){

      return {
        status:
          "PROPOSE_AUTO_LOCATION_DISAMBIGUATED",
        candidateId:
          locationPool[0]
            .candidateId,
        officialName:
          locationPool[0]
            .officialName,
        masterLocation:
          masterById[
            locationPool[0]
              .candidateId
          ].locationRaw,
        compatibleCandidates:
          V2_locationCandidateLabels_(
            compatiblePool,
            masterById
          ),
        reason:
          "MULTIPLE_NAME_MATCHES_REDUCED_TO_ONE_BY_COUNTRY"
      };

    }

    if(
      locationPool.length > 1
    ){

      return {
        status:
          "BLOCK_LOCATION_STILL_MULTIPLE",
        candidateId:
          "",
        officialName:
          "",
        compatibleCandidates:
          V2_locationCandidateLabels_(
            locationPool,
            masterById
          ),
        reason:
          "MULTIPLE_STRUCTURAL_CANDIDATES_SHARE_SOURCE_COUNTRY"
      };

    }

    return {
      status:
        "NO_LOCATION_MATCH_FOR_AMBIGUOUS_NAME",
      candidateId:
        "",
      officialName:
        "",
      compatibleCandidates:
        V2_locationCandidateLabels_(
          compatiblePool,
          masterById
        ),
      reason:
        "STRUCTURAL_POOL_EXISTS_BUT_COUNTRY_DOES_NOT_MATCH"
    };

  }

  //--------------------------------------------------
  // Deliberately conservative:
  // country alone cannot rescue a name that has no
  // acceptable structural name relation.
  //--------------------------------------------------

  return {
    status:
      "LOCATION_AVAILABLE_BUT_NAME_NOT_SAFE",
    candidateId:
      "",
    officialName:
      "",
    compatibleCandidates:
      [],
    reason:
      "COUNTRY_CANNOT_OVERRIDE_NO_STRUCTURAL_NAME_MATCH"
  };

}


/******************************************************
 * PRIVATE: BUILD MASTER PROFILE MAP
 ******************************************************/
function V2_locationBuildMasterById_(
  candidateRows,
  structuralMasterRecords
){

  const allowedIds = {};

  (structuralMasterRecords || [])
    .forEach(
      function(master){
        allowedIds[
          master.candidateId
        ] = true;
      }
    );

  const output = {};

  (candidateRows || [])
    .forEach(
      function(row){

        const candidateId =
          String(
            row["Candidate ID"] || ""
          ).trim();

        if(
          !candidateId ||
          !allowedIds[
            candidateId
          ]
        ){
          return;
        }

        const locationRaw =
          String(
            row["Location"] || ""
          ).trim();

        output[candidateId] = {
          candidateId:
            candidateId,
          officialName:
            String(
              row[
                "Official Candidate Name"
              ] || ""
            ).trim(),
          locationRaw:
            locationRaw,
          locationCanonical:
            V2_locationCanonicalize_(
              locationRaw
            )
        };

      }
    );

  return output;

}


/******************************************************
 * PRIVATE: FILTER MASTER POOL BY COUNTRY
 ******************************************************/
function V2_locationFilterByCountry_(
  masterPool,
  sourceCountry,
  masterById
){

  if(!sourceCountry){
    return [];
  }

  return (masterPool || [])
    .filter(
      function(master){

        const profile =
          masterById[
            master.candidateId
          ];

        if(
          !profile ||
          !profile.locationCanonical
        ){
          return false;
        }

        return (
          profile.locationCanonical ===
          sourceCountry
        );

      }
    );

}


/******************************************************
 * PRIVATE: EXTRACT SOURCE LOCATION
 *
 * Uses only parenthetical text attached to the candidate
 * at the BEGINNING of Original Record.
 *
 * Examples:
 * Surya (Ireland) – Interview ...
 * Thrayamba Keswar (UK) – Interview ...
 *
 * Later interview parentheses such as (1st Round) are
 * never considered candidate country evidence.
 ******************************************************/
function V2_locationExtractSourceLocation_(
  originalRecord
){

  const text =
    String(
      originalRecord || ""
    ).trim();

  if(!text){

    return {
      raw:
        "",
      canonical:
        ""
    };

  }

  //--------------------------------------------------
  // Candidate segment is everything before the first
  // obvious field separator dash.
  //--------------------------------------------------

  const normalizedDash =
    text.replace(
      /[–—]/g,
      " - "
    );

  let candidateSegment =
    normalizedDash;

  const separator =
    normalizedDash.match(
      /\s+-+\s+/
    );

  if(separator){

    candidateSegment =
      normalizedDash.substring(
        0,
        separator.index
      );

  }

  const parentheses =
    candidateSegment.match(
      /\(([^()]*)\)/
    );

  if(!parentheses){

    return {
      raw:
        "",
      canonical:
        ""
    };

  }

  const raw =
    String(
      parentheses[1] || ""
    ).trim();

  return {
    raw:
      raw,
    canonical:
      V2_locationCanonicalize_(
        raw
      )
  };

}


/******************************************************
 * PRIVATE: LOCATION CANONICALIZATION
 *
 * Conservative country-level normalization.
 * "Not Added" / unknown values become blank.
 ******************************************************/
function V2_locationCanonicalize_(
  value
){

  let text =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if(!text){
    return "";
  }

  try{
    text =
      text.normalize(
        "NFKD"
      );
  }catch(error){
    // Safe fallback.
  }

  text =
    text.replace(
      /[\u0300-\u036f]/g,
      ""
    );

  text =
    text.replace(
      /[^a-z0-9]+/g,
      " "
    );

  text =
    text.replace(
      /\s+/g,
      " "
    ).trim();

  if(
    !text ||
    text === "not added" ||
    text === "unknown" ||
    text === "na" ||
    text === "n a"
  ){
    return "";
  }

  //--------------------------------------------------
  // United Kingdom
  //--------------------------------------------------

  if(
    text === "uk" ||
    text === "u k" ||
    text === "united kingdom" ||
    text === "england" ||
    text === "great britain" ||
    text === "britain" ||
    text === "london" ||
    text === "london uk"
  ){
    return "UNITED_KINGDOM";
  }

  //--------------------------------------------------
  // United States
  //--------------------------------------------------

  if(
    text === "us" ||
    text === "u s" ||
    text === "usa" ||
    text === "u s a" ||
    text === "united states" ||
    text === "united states of america" ||
    text === "america" ||
    text === "tampa florida" ||
    text === "los angeles california"
  ){
    return "UNITED_STATES";
  }

  //--------------------------------------------------
  // Common source countries in current Candidate Master
  //--------------------------------------------------

  const direct = {
    "ireland":
      "IRELAND",
    "canada":
      "CANADA",
    "india":
      "INDIA",
    "germany":
      "GERMANY",
    "afghanistan":
      "AFGHANISTAN",
    "argentina":
      "ARGENTINA",
    "albania":
      "ALBANIA",
    "aland islands":
      "ALAND_ISLANDS",
    "bosnia and herzegovina":
      "BOSNIA_AND_HERZEGOVINA"
  };

  if(direct[text]){
    return direct[text];
  }

  //--------------------------------------------------
  // Unknown free-form locations are NOT automatically
  // treated as equivalent to a country.
  //--------------------------------------------------

  return "";

}


/******************************************************
 * PRIVATE: LABEL COMPATIBLE CANDIDATES
 ******************************************************/
function V2_locationCandidateLabels_(
  pool,
  masterById
){

  return (pool || [])
    .map(
      function(master){

        const profile =
          masterById[
            master.candidateId
          ] || {};

        return (
          master.candidateId +
          " " +
          master.officialName +
          " [" +
          String(
            profile.locationRaw || ""
          ) +
          "]"
        );

      }
    );

}
