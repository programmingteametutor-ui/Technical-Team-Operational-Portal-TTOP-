/******************************************************
 * V2CANDIDATESTRUCTURALPREVIEW.GS
 * Interview Operations Portal V2
 *
 * READ-ONLY preview for proposed Candidate Matcher v1.1
 *
 * PURPOSE
 * -------
 * Evaluate only CURRENTLY UNRESOLVED Gateway candidates
 * against two conservative structural rules:
 *
 * 1. UNIQUE_PARTIAL_NAME
 *    Raw full tokens are an ordered subset of exactly one
 *    Candidate Master name.
 *
 *    Example:
 *    Thrayamba Keswar
 *    -> Thrayamba Keswar Bettala
 *
 * 2. UNIQUE_INITIAL_EXPANSION
 *    Raw single-letter token may expand to a full Candidate
 *    Master token beginning with that letter, while all other
 *    supplied tokens must structurally align.
 *
 *    Examples:
 *    Meghana B
 *    -> Meghana Botta
 *
 *    Maneesha Gayathri S
 *    -> Maneesha Gayathri Sunkara
 *
 *    Sai Shwetha K
 *    -> Sai Shwetha Kancharlapalli
 *
 * SAFETY
 * ------
 * - No writes.
 * - No Gateway rebuild.
 * - No Candidate Master changes.
 * - Duplicate / multiple compatible master candidates BLOCK.
 * - Country/location is NOT used in this preview.
 ******************************************************/


const V2_STRUCTURAL_MATCH_PREVIEW = Object.freeze({

  VERSION:
    "V2-CANDIDATE-STRUCTURAL-PREVIEW-1.1.0",

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
 * PUBLIC: MAIN READ-ONLY PREVIEW
 ******************************************************/
function V2_previewCandidateStructuralExpansionV11(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const masterRecords =
    V2_structuralBuildMasterRecords_(
      candidates
    );

  const variants = {};

  gateway.forEach(
    function(row){

      const currentStatus =
        String(
          row["Candidate Match Status"] || ""
        ).trim();

      if(
        !V2_STRUCTURAL_MATCH_PREVIEW
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

      const key =
        V2_structuralNormalize_(
          raw
        ) || "__BLANK__";

      if(!variants[key]){
        variants[key] = {
          raw:
            raw,
          records:
            0,
          currentStatusCounts:
            {}
        };
      }

      variants[key].records++;

      variants[key]
        .currentStatusCounts[
          currentStatus
        ] =
          (
            variants[key]
              .currentStatusCounts[
                currentStatus
              ] || 0
          ) + 1;

    }
  );

  const results = [];

  Object.keys(
    variants
  ).forEach(
    function(key){

      const item =
        variants[key];

      const proposal =
        V2_structuralResolvePreview_(
          item.raw,
          masterRecords
        );

      results.push({
        raw:
          item.raw,
        records:
          item.records,
        currentStatusCounts:
          item.currentStatusCounts,
        proposal:
          proposal
      });

    }
  );

  const proposalByVariant = {};
  const proposalByGatewayRecord = {};

  results.forEach(
    function(item){

      const status =
        item.proposal.status;

      proposalByVariant[status] =
        (
          proposalByVariant[status] || 0
        ) + 1;

      proposalByGatewayRecord[status] =
        (
          proposalByGatewayRecord[status] || 0
        ) +
        item.records;

    }
  );

  const proposedAutoStatuses = {
    PROPOSE_AUTO_UNIQUE_PARTIAL:
      true,
    PROPOSE_AUTO_UNIQUE_INITIAL:
      true
  };

  let proposedAutoVariants = 0;
  let proposedAutoGatewayRecords = 0;
  let stillUnresolvedVariants = 0;
  let stillUnresolvedGatewayRecords = 0;

  results.forEach(
    function(item){

      if(
        proposedAutoStatuses[
          item.proposal.status
        ]
      ){
        proposedAutoVariants++;
        proposedAutoGatewayRecords +=
          item.records;
      }else{
        stillUnresolvedVariants++;
        stillUnresolvedGatewayRecords +=
          item.records;
      }

    }
  );

  const proposalExamples =
    results
      .filter(
        function(item){
          return proposedAutoStatuses[
            item.proposal.status
          ];
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
            a.raw || ""
          ).localeCompare(
            String(
              b.raw || ""
            )
          );

        }
      )
      .slice(
        0,
        30
      )
      .map(
        function(item){

          return {
            raw:
              item.raw,
            records:
              item.records,
            proposalStatus:
              item.proposal.status,
            candidateId:
              item.proposal.candidateId,
            officialName:
              item.proposal.officialName,
            reason:
              item.proposal.reason
          };

        }
      );

  const blockedExamples =
    results
      .filter(
        function(item){
          return (
            item.proposal.status ===
            "BLOCK_MULTIPLE_COMPATIBLE"
          );
        }
      )
      .sort(
        function(a,b){
          return (
            b.records -
            a.records
          );
        }
      )
      .slice(
        0,
        20
      )
      .map(
        function(item){

          return {
            raw:
              item.raw,
            records:
              item.records,
            compatibleCount:
              item.proposal.compatibleCount,
            candidates:
              item.proposal.compatibleCandidates
          };

        }
      );

  const accountedUnresolvedGatewayRecords =
    proposedAutoGatewayRecords +
    stillUnresolvedGatewayRecords;

  const result = {

    ok:
      (
        accountedUnresolvedGatewayRecords ===
        906
      ),

    mode:
      "READ_ONLY",

    version:
      V2_STRUCTURAL_MATCH_PREVIEW.VERSION,

    currentUnresolved: {
      gatewayRecords:
        906,
      variants:
        results.length
    },

    proposedResolution: {
      autoVariants:
        proposedAutoVariants,
      autoGatewayRecords:
        proposedAutoGatewayRecords,
      remainingVariants:
        stillUnresolvedVariants,
      remainingGatewayRecords:
        stillUnresolvedGatewayRecords,
      accountedGatewayRecords:
        accountedUnresolvedGatewayRecords
    },

    proposalByVariant:
      proposalByVariant,

    proposalByGatewayRecord:
      proposalByGatewayRecord,

    proposalExamples:
      proposalExamples,

    blockedExamples:
      blockedExamples

  };

  Logger.log(
    "========== V2 CANDIDATE STRUCTURAL PREVIEW v1.1 =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "=========================================================="
  );

  return result;

}


/******************************************************
 * PUBLIC: COMPACT LOG OF ALL PROPOSED AUTO VARIANTS
 *
 * Run ONLY after reviewing the main preview summary.
 ******************************************************/
function V2_logCandidateStructuralAutoProposalsV11(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const masterRecords =
    V2_structuralBuildMasterRecords_(
      candidates
    );

  const variants = {};

  gateway.forEach(
    function(row){

      const currentStatus =
        String(
          row["Candidate Match Status"] || ""
        ).trim();

      if(
        !V2_STRUCTURAL_MATCH_PREVIEW
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

      const key =
        V2_structuralNormalize_(
          raw
        ) || "__BLANK__";

      if(!variants[key]){
        variants[key] = {
          raw:
            raw,
          records:
            0
        };
      }

      variants[key].records++;

    }
  );

  const rows = [];

  Object.keys(
    variants
  ).forEach(
    function(key){

      const variant =
        variants[key];

      const proposal =
        V2_structuralResolvePreview_(
          variant.raw,
          masterRecords
        );

      if(
        proposal.status !==
          "PROPOSE_AUTO_UNIQUE_PARTIAL" &&
        proposal.status !==
          "PROPOSE_AUTO_UNIQUE_INITIAL"
      ){
        return;
      }

      rows.push({
        raw:
          variant.raw,
        records:
          variant.records,
        status:
          proposal.status,
        candidateId:
          proposal.candidateId,
        officialName:
          proposal.officialName,
        reason:
          proposal.reason
      });

    }
  );

  rows.sort(
    function(a,b){

      if(a.status !== b.status){
        return String(
          a.status
        ).localeCompare(
          String(
            b.status
          )
        );
      }

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
    "========== V2 STRUCTURAL AUTO PROPOSALS =========="
  );

  rows.forEach(
    function(item,index){

      Logger.log(
        [
          index + 1,
          "Raw=" +
            item.raw,
          "Records=" +
            item.records,
          "Rule=" +
            item.status,
          "CandidateID=" +
            item.candidateId,
          "Official=" +
            item.officialName,
          "Reason=" +
            item.reason
        ].join(
          " | "
        )
      );

    }
  );

  Logger.log(
    "TOTAL PROPOSED AUTO VARIANTS = " +
    rows.length
  );

  Logger.log(
    "================================================="
  );

  return {
    ok:
      true,
    mode:
      "READ_ONLY",
    proposedAutoVariants:
      rows.length
  };

}


/******************************************************
 * PRIVATE: BUILD ACTIVE MASTER RECORDS
 ******************************************************/
function V2_structuralBuildMasterRecords_(
  candidateRows
){

  const output = [];

  (candidateRows || [])
    .forEach(
      function(row){

        if(
          !V2_structuralIsSystemActive_(
            row["Active"]
          )
        ){
          return;
        }

        const candidateId =
          String(
            row["Candidate ID"] || ""
          ).trim();

        const officialName =
          String(
            row[
              "Official Candidate Name"
            ] || ""
          ).trim();

        if(
          !candidateId ||
          !officialName
        ){
          return;
        }

        const normalized =
          V2_structuralNormalize_(
            officialName
          );

        const tokens =
          V2_structuralTokens_(
            officialName
          );

        if(
          !normalized ||
          !tokens.length
        ){
          return;
        }

        output.push({
          candidateId:
            candidateId,
          officialName:
            officialName,
          normalized:
            normalized,
          tokens:
            tokens
        });

      }
    );

  return output;

}


/******************************************************
 * PRIVATE: RESOLVE ONE RAW NAME IN PREVIEW
 ******************************************************/
function V2_structuralResolvePreview_(
  rawName,
  masterRecords
){

  const raw =
    String(
      rawName || ""
    ).trim();

  const rawTokens =
    V2_structuralTokens_(
      raw
    );

  if(!rawTokens.length){

    return {
      status:
        "NO_STRUCTURAL_MATCH",
      candidateId:
        "",
      officialName:
        "",
      reason:
        "EMPTY_RAW_NAME"
    };

  }

  //--------------------------------------------------
  // Do not allow a one-word raw name to auto-link in
  // this phase. Those cases will later use country/
  // location as a secondary discriminator.
  //--------------------------------------------------

  if(rawTokens.length < 2){

    return {
      status:
        "NEEDS_LOCATION_RULE",
      candidateId:
        "",
      officialName:
        "",
      reason:
        "ONE_TOKEN_NAME_NOT_SAFE_WITH_NAME_ONLY"
    };

  }

  const exactCompatible = [];
  const initialCompatible = [];

  (masterRecords || [])
    .forEach(
      function(master){

        const relation =
          V2_structuralCompatibility_(
            rawTokens,
            master.tokens
          );

        if(!relation.compatible){
          return;
        }

        const item = {
          candidateId:
            master.candidateId,
          officialName:
            master.officialName,
          relation:
            relation
        };

        if(
          relation.initialExpansions > 0
        ){
          initialCompatible.push(
            item
          );
        }else if(
          relation.masterExtraTokens > 0
        ){
          exactCompatible.push(
            item
          );
        }

      }
    );

  //--------------------------------------------------
  // Initial expansion gets priority only when UNIQUE.
  //--------------------------------------------------

  if(initialCompatible.length === 1){

    return {
      status:
        "PROPOSE_AUTO_UNIQUE_INITIAL",
      candidateId:
        initialCompatible[0]
          .candidateId,
      officialName:
        initialCompatible[0]
          .officialName,
      compatibleCount:
        1,
      compatibleCandidates:
        [
          initialCompatible[0]
            .candidateId
        ],
      reason:
        "UNIQUE_STRUCTURAL_INITIAL_EXPANSION"
    };

  }

  if(initialCompatible.length > 1){

    return {
      status:
        "BLOCK_MULTIPLE_COMPATIBLE",
      candidateId:
        "",
      officialName:
        "",
      compatibleCount:
        initialCompatible.length,
      compatibleCandidates:
        initialCompatible.map(
          function(item){
            return (
              item.candidateId +
              " " +
              item.officialName
            );
          }
        ),
      reason:
        "MULTIPLE_INITIAL_COMPATIBLE_CANDIDATES"
    };

  }

  //--------------------------------------------------
  // Full-token partial expansion.
  //--------------------------------------------------

  if(exactCompatible.length === 1){

    return {
      status:
        "PROPOSE_AUTO_UNIQUE_PARTIAL",
      candidateId:
        exactCompatible[0]
          .candidateId,
      officialName:
        exactCompatible[0]
          .officialName,
      compatibleCount:
        1,
      compatibleCandidates:
        [
          exactCompatible[0]
            .candidateId
        ],
      reason:
        "UNIQUE_ORDERED_PARTIAL_NAME_EXPANSION"
    };

  }

  if(exactCompatible.length > 1){

    return {
      status:
        "BLOCK_MULTIPLE_COMPATIBLE",
      candidateId:
        "",
      officialName:
        "",
      compatibleCount:
        exactCompatible.length,
      compatibleCandidates:
        exactCompatible.map(
          function(item){
            return (
              item.candidateId +
              " " +
              item.officialName
            );
          }
        ),
      reason:
        "MULTIPLE_PARTIAL_COMPATIBLE_CANDIDATES"
    };

  }

  return {
    status:
      "NO_STRUCTURAL_MATCH",
    candidateId:
      "",
    officialName:
      "",
    compatibleCount:
      0,
    compatibleCandidates:
      [],
    reason:
      "NO_UNIQUE_STRUCTURAL_EXPANSION"
  };

}


/******************************************************
 * PRIVATE: STRUCTURAL COMPATIBILITY
 *
 * Ordered alignment:
 * - raw full token must equal master token
 * - raw one-letter token may match a master token
 *   starting with that letter
 * - master may contain extra tokens
 *
 * Returns the BEST valid alignment.
 ******************************************************/
function V2_structuralCompatibility_(
  rawTokens,
  masterTokens
){

  if(
    !rawTokens ||
    !masterTokens ||
    !rawTokens.length ||
    !masterTokens.length ||
    rawTokens.length >
      masterTokens.length
  ){
    return {
      compatible:
        false
    };
  }

  let best = null;

  function walk(
    rawIndex,
    masterIndex,
    initialExpansions,
    matchedPairs
  ){

    if(
      rawIndex ===
      rawTokens.length
    ){

      const masterExtraTokens =
        masterTokens.length -
        matchedPairs;

      const candidate = {
        compatible:
          true,
        initialExpansions:
          initialExpansions,
        masterExtraTokens:
          masterExtraTokens,
        matchedPairs:
          matchedPairs
      };

      if(
        !best ||
        candidate.initialExpansions <
          best.initialExpansions ||
        (
          candidate.initialExpansions ===
            best.initialExpansions &&
          candidate.masterExtraTokens <
            best.masterExtraTokens
        )
      ){
        best = candidate;
      }

      return;
    }

    if(
      masterIndex >=
      masterTokens.length
    ){
      return;
    }

    const rawToken =
      rawTokens[rawIndex];

    const masterToken =
      masterTokens[masterIndex];

    //------------------------------------------------
    // Option 1: consume both if compatible.
    //------------------------------------------------

    if(
      rawToken ===
      masterToken
    ){

      walk(
        rawIndex + 1,
        masterIndex + 1,
        initialExpansions,
        matchedPairs + 1
      );

    }else if(
      rawToken.length === 1 &&
      masterToken.length >= 2 &&
      masterToken.charAt(0) ===
        rawToken
    ){

      walk(
        rawIndex + 1,
        masterIndex + 1,
        initialExpansions + 1,
        matchedPairs + 1
      );

    }

    //------------------------------------------------
    // Option 2: master has an additional token that
    // is missing from raw. Skip master token.
    //------------------------------------------------

    walk(
      rawIndex,
      masterIndex + 1,
      initialExpansions,
      matchedPairs
    );

  }

  walk(
    0,
    0,
    0,
    0
  );

  if(!best){
    return {
      compatible:
        false
    };
  }

  //--------------------------------------------------
  // Exact normalized names are already handled by
  // the current matcher and must not be reclassified.
  //--------------------------------------------------

  if(
    best.initialExpansions === 0 &&
    best.masterExtraTokens === 0
  ){
    return {
      compatible:
        false
    };
  }

  return best;

}


/******************************************************
 * PRIVATE: NORMALIZE NAME
 ******************************************************/
function V2_structuralNormalize_(
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
    // Apps Script runtimes supporting normalize use it.
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

  return text;

}


/******************************************************
 * PRIVATE: TOKENS
 ******************************************************/
function V2_structuralTokens_(
  value
){

  const normalized =
    V2_structuralNormalize_(
      value
    );

  if(!normalized){
    return [];
  }

  return normalized
    .split(
      " "
    )
    .filter(
      function(token){
        return !!token;
      }
    );

}


/******************************************************
 * PRIVATE: SYSTEM ACTIVE
 ******************************************************/
function V2_structuralIsSystemActive_(
  value
){

  if(
    value === true ||
    value === 1
  ){
    return true;
  }

  const text =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  return (
    text === "true" ||
    text === "yes" ||
    text === "active" ||
    text === "1"
  );

}
