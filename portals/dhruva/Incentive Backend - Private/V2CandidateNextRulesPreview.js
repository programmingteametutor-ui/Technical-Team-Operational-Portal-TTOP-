/******************************************************
 * V2CandidateNextRulesPreview.gs
 * Interview Operations Portal V2
 *
 * READ-ONLY preview for the NEXT candidate matching rules
 * after permanent Matcher v1.2.0.
 *
 * IMPORTANT
 * ---------
 * - NO Gateway writes.
 * - NO Candidate Master writes.
 * - NO rebuild.
 * - NO permanent Matcher change.
 *
 * New rule families being previewed:
 *
 * 1. ACTIVE STATUS DISAMBIGUATION
 *    If a genuine name-compatible pool contains multiple
 *    Candidate IDs, but EXACTLY ONE is Active and all other
 *    compatible candidates are Inactive, propose the Active.
 *
 *    Uses Candidate Master column "Active Status".
 *    It deliberately DOES NOT use the separate boolean
 *    "Active" column because imported Inactive students may
 *    still have system Active=TRUE.
 *
 * 2. REVERSE INITIAL EXPANSION
 *    Raw full token may expand a Master initial:
 *      Ramakrishna Yarajarlai -> Ramakrishna Y
 *
 * 3. MULTI-TOKEN SMALL EDITS
 *    One or more exact anchors plus 2+ residual name tokens,
 *    where each residual pair differs by at most ONE
 *    Levenshtein edit.
 *      Reshma Chowdary Potluru
 *      -> Reshma Chowdhary Potluri
 *
 * 4. ANCHORED NEAR / TRANSPOSITION
 *    Exact anchor(s) plus ONE residual token with:
 *      - Damerau distance 1 (adjacent transposition), OR
 *      - Levenshtein distance <= 2
 *    and full-name similarity >= 85.
 *
 *      Yeddula Sandeep -> Yedulla Sandeep
 *      Khrushid Shaik -> Khurshid Shaik
 *      Roopla Mishra -> Roopal Mishra
 *
 * SCORE POLICY
 * ------------
 * 85/90 similarity is SUPPORTING EVIDENCE only.
 * A high similarity score by itself NEVER auto-maps.
 ******************************************************/


const V2_NEXT_RULES_PREVIEW =
  Object.freeze({

    VERSION:
      "V2-CANDIDATE-NEXT-RULES-PREVIEW-1.3.0",

    MIN_FULL_NAME_SIMILARITY:
      85,

    AUTO_PROPOSAL_STATUSES:
      Object.freeze({
        PROPOSE_AUTO_ACTIVE_DISAMBIGUATED:
          true,
        PROPOSE_AUTO_REVERSE_INITIAL:
          true,
        PROPOSE_AUTO_MULTI_TOKEN_EDIT:
          true,
        PROPOSE_AUTO_ANCHORED_NEAR_TOKEN:
          true
      })

  });


/******************************************************
 * PUBLIC — SYNTHETIC SAFETY TEST
 *
 * Run FIRST.
 ******************************************************/
function V2_testCandidateNextRulesV13SyntheticReadOnly(){

  const rows = [
    {
      "Candidate ID":
        "CAN-T001",
      "Official Candidate Name":
        "Keerthi venkata Prasanna Kotra",
      "Email":
        "kkeerthy069@gmail.com",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T002",
      "Official Candidate Name":
        "Keerthi venkata Prasanna Kotra",
      "Email":
        "kkeerthy@gmail.com",
      "Active Status":
        "Inactive"
    },
    {
      "Candidate ID":
        "CAN-T003",
      "Official Candidate Name":
        "Sailaja Meenigala",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T004",
      "Official Candidate Name":
        "Reddy Sailaja Marpuri",
      "Active Status":
        "Inactive"
    },
    {
      "Candidate ID":
        "CAN-T005",
      "Official Candidate Name":
        "VAMSHI ALAGANDULA",
      "Active Status":
        "Inactive"
    },
    {
      "Candidate ID":
        "CAN-T006",
      "Official Candidate Name":
        "Vamshi Arutla",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T007",
      "Official Candidate Name":
        "Abhishek Mogili",
      "Active Status":
        "Inactive"
    },
    {
      "Candidate ID":
        "CAN-T008",
      "Official Candidate Name":
        "Abhishek Muralidharan",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T009",
      "Official Candidate Name":
        "Ramakrishna Y",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T010",
      "Official Candidate Name":
        "Sairamakrishna Yaswanth Komaravolu",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T011",
      "Official Candidate Name":
        "Reshma Chowdhary Potluri",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T012",
      "Official Candidate Name":
        "Yedulla Sandeep",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T013",
      "Official Candidate Name":
        "Khurshid Shaik",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T014",
      "Official Candidate Name":
        "Roopal Mishra",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T015",
      "Official Candidate Name":
        "Hima Bindu Reddy",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T016",
      "Official Candidate Name":
        "Hima Bindu Rao",
      "Active Status":
        "Active"
    },
    {
      "Candidate ID":
        "CAN-T017",
      "Official Candidate Name":
        "Sandeep Kiran Reddy",
      "Active Status":
        "Active"
    }
  ];

  const master =
    V2NR_buildMaster_(
      rows
    );

  const cases = [
    {
      name:
        "duplicate exact name resolved by Active",
      raw:
        "Keerthi Venkata Prasanna Kotra",
      candidateId:
        "CAN-T001",
      status:
        "PROPOSE_AUTO_ACTIVE_DISAMBIGUATED"
    },
    {
      name:
        "initial ambiguity resolved by Active",
      raw:
        "Sailaja M",
      candidateId:
        "CAN-T003",
      status:
        "PROPOSE_AUTO_ACTIVE_DISAMBIGUATED"
    },
    {
      name:
        "Vamshi initial ambiguity resolved by Active",
      raw:
        "Vamshi A",
      candidateId:
        "CAN-T006",
      status:
        "PROPOSE_AUTO_ACTIVE_DISAMBIGUATED"
    },
    {
      name:
        "Abhishek initial ambiguity resolved by Active",
      raw:
        "Abhishek M",
      candidateId:
        "CAN-T008",
      status:
        "PROPOSE_AUTO_ACTIVE_DISAMBIGUATED"
    },
    {
      name:
        "both Active but stronger reverse initial wins",
      raw:
        "Ramakrishna Yarajarlai",
      candidateId:
        "CAN-T009",
      status:
        "PROPOSE_AUTO_REVERSE_INITIAL"
    },
    {
      name:
        "multiple one-edit residual tokens",
      raw:
        "Reshma Chowdary Potluru",
      candidateId:
        "CAN-T011",
      status:
        "PROPOSE_AUTO_MULTI_TOKEN_EDIT"
    },
    {
      name:
        "anchored near spelling",
      raw:
        "Yeddula Sandeep",
      candidateId:
        "CAN-T012",
      status:
        "PROPOSE_AUTO_ANCHORED_NEAR_TOKEN"
    },
    {
      name:
        "anchored transposition one",
      raw:
        "Khrushid Shaik",
      candidateId:
        "CAN-T013",
      status:
        "PROPOSE_AUTO_ANCHORED_NEAR_TOKEN"
    },
    {
      name:
        "anchored transposition two",
      raw:
        "Roopla Mishra",
      candidateId:
        "CAN-T014",
      status:
        "PROPOSE_AUTO_ANCHORED_NEAR_TOKEN"
    },
    {
      name:
        "multiple Active candidates remain unresolved",
      raw:
        "Hima Bindu",
      auto:
        false
    },
    {
      name:
        "high score alone is not enough",
      raw:
        "Sandeep Kumar Reddy",
      auto:
        false
    }
  ];

  let passed = 0;

  const checks =
    cases.map(
      function(test){

        const proposal =
          V2NR_resolve_(
            test.raw,
            master
          );

        const isAuto =
          !!V2_NEXT_RULES_PREVIEW
            .AUTO_PROPOSAL_STATUSES[
              proposal.status
            ];

        const ok =
          test.auto === false
            ? !isAuto
            : (
                proposal.status ===
                  test.status &&
                proposal.candidateId ===
                  test.candidateId
              );

        if(ok){
          passed++;
        }

        return {
          name:
            test.name,
          raw:
            test.raw,
          expectedStatus:
            test.status ||
            "NOT_AUTO",
          proposal:
            proposal,
          ok:
            ok
        };

      }
    );

  const result = {
    ok:
      passed ===
      checks.length,
    mode:
      "READ_ONLY_SYNTHETIC",
    version:
      V2_NEXT_RULES_PREVIEW.VERSION,
    passed:
      passed,
    total:
      checks.length,
    checks:
      checks
  };

  Logger.log(
    "========== V2 NEXT RULES v1.3 SYNTHETIC =========="
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


/******************************************************
 * PUBLIC — REAL REMAINING-203 PREVIEW
 *
 * Run only AFTER synthetic test passes.
 ******************************************************/
function V2_previewCandidateNextRulesV13ReadOnly(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const master =
    V2NR_buildMaster_(
      candidates
    );

  const variants = {};

  let unresolvedGatewayRecords = 0;

  gateway.forEach(
    function(row){

      const status =
        String(
          row[
            "Candidate Match Status"
          ] || ""
        ).trim();

      const candidateId =
        String(
          row[
            "Candidate ID"
          ] || ""
        ).trim();

      const alreadyAuto =
        status.indexOf(
          "AUTO_"
        ) === 0 &&
        !!candidateId;

      if(alreadyAuto){
        return;
      }

      unresolvedGatewayRecords++;

      const raw =
        String(
          row[
            "Candidate Raw"
          ] || ""
        ).trim();

      const key =
        V2NR_normalize_(
          raw
        ) ||
        "__BLANK__";

      if(!variants[key]){

        variants[key] = {
          raw:
            raw,
          records:
            0,
          currentStatuses:
            {}
        };

      }

      variants[key].records++;

      variants[key]
        .currentStatuses[
          status || "BLANK"
        ] =
          (
            variants[key]
              .currentStatuses[
                status || "BLANK"
              ] || 0
          ) + 1;

    }
  );

  const evaluated = [];

  Object.keys(
    variants
  ).forEach(
    function(key){

      const item =
        variants[key];

      const proposal =
        V2NR_resolve_(
          item.raw,
          master
        );

      evaluated.push({
        raw:
          item.raw,
        records:
          item.records,
        currentStatuses:
          item.currentStatuses,
        proposal:
          proposal
      });

    }
  );

  const statusByVariant = {};
  const statusByGatewayRecord = {};

  let proposedAutoVariants = 0;
  let proposedAutoGatewayRecords = 0;
  let remainingVariants = 0;
  let remainingGatewayRecords = 0;

  evaluated.forEach(
    function(item){

      const status =
        item.proposal.status;

      statusByVariant[
        status
      ] =
        (
          statusByVariant[
            status
          ] || 0
        ) + 1;

      statusByGatewayRecord[
        status
      ] =
        (
          statusByGatewayRecord[
            status
          ] || 0
        ) +
        item.records;

      const isAuto =
        !!V2_NEXT_RULES_PREVIEW
          .AUTO_PROPOSAL_STATUSES[
            status
          ];

      if(isAuto){

        proposedAutoVariants++;

        proposedAutoGatewayRecords +=
          item.records;

      }else{

        remainingVariants++;

        remainingGatewayRecords +=
          item.records;

      }

    }
  );

  const proposalExamples =
    evaluated
      .filter(
        function(item){
          return !!V2_NEXT_RULES_PREVIEW
            .AUTO_PROPOSAL_STATUSES[
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
            return b.records - a.records;
          }

          return String(
            a.raw
          ).localeCompare(
            String(
              b.raw
            )
          );
        }
      )
      .slice(
        0,
        50
      )
      .map(
        function(item){
          return {
            raw:
              item.raw,
            records:
              item.records,
            currentStatuses:
              item.currentStatuses,
            proposalStatus:
              item.proposal.status,
            candidateId:
              item.proposal.candidateId,
            officialName:
              item.proposal.officialName,
            activeStatus:
              item.proposal.activeStatus,
            score:
              item.proposal.score,
            reason:
              item.proposal.reason
          };
        }
      );

  const result = {

    ok:
      (
        unresolvedGatewayRecords ===
        proposedAutoGatewayRecords +
        remainingGatewayRecords
      ),

    mode:
      "READ_ONLY",

    version:
      V2_NEXT_RULES_PREVIEW.VERSION,

    matcherVersion:
      (
        typeof V2_CANDIDATE_MATCHER !==
        "undefined"
      )
        ? V2_CANDIDATE_MATCHER.VERSION
        : "",

    baseline: {
      unresolvedGatewayRecords:
        unresolvedGatewayRecords,
      unresolvedVariants:
        evaluated.length
    },

    proposedResolution: {
      autoVariants:
        proposedAutoVariants,
      autoGatewayRecords:
        proposedAutoGatewayRecords,
      remainingVariants:
        remainingVariants,
      remainingGatewayRecords:
        remainingGatewayRecords,
      accountedGatewayRecords:
        proposedAutoGatewayRecords +
        remainingGatewayRecords
    },

    statusByVariant:
      statusByVariant,

    statusByGatewayRecord:
      statusByGatewayRecord,

    proposalExamples:
      proposalExamples

  };

  Logger.log(
    "========== V2 NEXT RULES v1.3 REAL PREVIEW =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "====================================================="
  );

  return result;

}


/******************************************************
 * PUBLIC — LOG ALL REAL AUTO PROPOSALS
 *
 * Do not run until the summary preview is reviewed.
 ******************************************************/
function V2_logCandidateNextRulesV13AutoProposalsReadOnly(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const master =
    V2NR_buildMaster_(
      candidates
    );

  const variants = {};

  gateway.forEach(
    function(row){

      const status =
        String(
          row[
            "Candidate Match Status"
          ] || ""
        ).trim();

      const candidateId =
        String(
          row[
            "Candidate ID"
          ] || ""
        ).trim();

      if(
        status.indexOf(
          "AUTO_"
        ) === 0 &&
        candidateId
      ){
        return;
      }

      const raw =
        String(
          row[
            "Candidate Raw"
          ] || ""
        ).trim();

      const key =
        V2NR_normalize_(
          raw
        ) ||
        "__BLANK__";

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

  const proposals = [];

  Object.keys(
    variants
  ).forEach(
    function(key){

      const item =
        variants[key];

      const proposal =
        V2NR_resolve_(
          item.raw,
          master
        );

      if(
        !V2_NEXT_RULES_PREVIEW
          .AUTO_PROPOSAL_STATUSES[
            proposal.status
          ]
      ){
        return;
      }

      proposals.push({
        raw:
          item.raw,
        records:
          item.records,
        status:
          proposal.status,
        candidateId:
          proposal.candidateId,
        officialName:
          proposal.officialName,
        activeStatus:
          proposal.activeStatus,
        score:
          proposal.score,
        reason:
          proposal.reason
      });

    }
  );

  proposals.sort(
    function(a,b){

      if(
        b.records !==
        a.records
      ){
        return b.records - a.records;
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
    "========== V2 NEXT RULES v1.3 AUTO PROPOSALS =========="
  );

  proposals.forEach(
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
          "ActiveStatus=" +
            item.activeStatus,
          "Score=" +
            item.score,
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
    proposals.length
  );

  Logger.log(
    "======================================================"
  );

  return {
    ok:
      true,
    mode:
      "READ_ONLY",
    proposedAutoVariants:
      proposals.length
  };

}


/******************************************************
 * PRIVATE — BUILD MASTER
 ******************************************************/
function V2NR_buildMaster_(
  candidateRows
){

  const records = [];
  const byNormalized = {};

  (candidateRows || [])
    .forEach(
      function(row){

        const candidateId =
          String(
            row[
              "Candidate ID"
            ] || ""
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
          V2NR_normalize_(
            officialName
          );

        if(!normalized){
          return;
        }

        const activeStatus =
          V2NR_activeStatus_(
            row[
              "Active Status"
            ]
          );

        const record = {
          candidateId:
            candidateId,
          officialName:
            officialName,
          email:
            String(
              row[
                "Email"
              ] || ""
            ).trim(),
          activeStatus:
            activeStatus,
          normalized:
            normalized,
          tokens:
            V2NR_tokens_(
              normalized
            )
        };

        records.push(
          record
        );

        if(
          !byNormalized[
            normalized
          ]
        ){
          byNormalized[
            normalized
          ] = [];
        }

        byNormalized[
          normalized
        ].push(
          record
        );

      }
    );

  return {
    records:
      records,
    byNormalized:
      byNormalized
  };

}


/******************************************************
 * PRIVATE — RESOLVE ONE RAW NAME
 ******************************************************/
function V2NR_resolve_(
  rawName,
  master
){

  const normalized =
    V2NR_normalize_(
      rawName
    );

  const rawTokens =
    V2NR_tokens_(
      normalized
    );

  if(!rawTokens.length){
    return V2NR_noMatch_(
      "EMPTY_RAW_NAME"
    );
  }

  //--------------------------------------------------
  // 1. DUPLICATE EXACT NORMALIZED NAME
  //    -> Active Status tie-break.
  //--------------------------------------------------

  const exactPool =
    master.byNormalized[
      normalized
    ] || [];

  if(
    exactPool.length > 1
  ){

    return V2NR_resolvePool_(
      exactPool,
      "EXACT_DUPLICATE_NAME_POOL",
      "PROPOSE_AUTO_ACTIVE_DISAMBIGUATED",
      normalized
    );

  }

  //--------------------------------------------------
  // 2. STRUCTURAL RAW INITIAL / PARTIAL POOL
  //    -> Active Status tie-break.
  //
  // Examples:
  // Sailaja M
  // Vamshi A
  // Abhishek M
  //--------------------------------------------------

  const structuralPool =
    master.records
      .filter(
        function(item){
          return V2NR_rawStructuralCompatible_(
            rawTokens,
            item.tokens
          );
        }
      );

  if(
    structuralPool.length > 1
  ){

    const structuralActive =
      V2NR_resolvePool_(
        structuralPool,
        "MULTIPLE_STRUCTURAL_NAME_CANDIDATES",
        "PROPOSE_AUTO_ACTIVE_DISAMBIGUATED",
        normalized
      );

    if(
      structuralActive.status ===
      "PROPOSE_AUTO_ACTIVE_DISAMBIGUATED"
    ){
      return structuralActive;
    }

  }

  //--------------------------------------------------
  // 3. REVERSE INITIAL EXPANSION
  //
  // Master: Ramakrishna Y
  // Raw:    Ramakrishna Yarajarlai
  //--------------------------------------------------

  const reverseInitialPool =
    master.records
      .filter(
        function(item){
          return V2NR_reverseInitialCompatible_(
            rawTokens,
            item.tokens
          );
        }
      );

  if(
    reverseInitialPool.length
  ){

    return V2NR_resolvePool_(
      reverseInitialPool,
      "MASTER_INITIAL_EXPANDS_TO_RAW_FULL_TOKEN",
      "PROPOSE_AUTO_REVERSE_INITIAL",
      normalized
    );

  }

  //--------------------------------------------------
  // 4. MULTI-TOKEN SMALL EDITS
  //
  // Same token count, at least one exact anchor,
  // 2+ residual token pairs, each Levenshtein <= 1.
  //--------------------------------------------------

  const multiEditPool =
    [];

  master.records
    .forEach(
      function(item){

        const relation =
          V2NR_multiTokenEditRelation_(
            rawTokens,
            item.tokens
          );

        if(!relation.ok){
          return;
        }

        const score =
          V2NR_similarity_(
            normalized,
            item.normalized
          );

        if(
          score <
          V2_NEXT_RULES_PREVIEW
            .MIN_FULL_NAME_SIMILARITY
        ){
          return;
        }

        multiEditPool.push({
          item:
            item,
          score:
            score,
          evidence:
            relation
        });

      }
    );

  if(
    multiEditPool.length
  ){

    return V2NR_resolveScoredPool_(
      multiEditPool,
      "MULTIPLE_SMALL_TOKEN_EDITS_WITH_EXACT_ANCHOR",
      "PROPOSE_AUTO_MULTI_TOKEN_EDIT",
      normalized
    );

  }

  //--------------------------------------------------
  // 5. ANCHORED NEAR / TRANSPOSITION
  //
  // Same token count, at least one exact anchor,
  // exactly one residual token pair.
  //
  // Residual must be:
  // - Damerau distance 1, OR
  // - Levenshtein <= 2
  //
  // Non-transposition edit-distance-2 cases require
  // full name similarity >= 85. Explicit adjacent
  // transposition is allowed with the exact anchor even
  // when a short full name falls just below 85.
  //--------------------------------------------------

  const nearPool =
    [];

  master.records
    .forEach(
      function(item){

        const relation =
          V2NR_anchoredNearRelation_(
            rawTokens,
            item.tokens
          );

        if(!relation.ok){
          return;
        }

        const score =
          V2NR_similarity_(
            normalized,
            item.normalized
          );

        // Adjacent transposition is an explicit structural
        // relation, so short names such as
        // Roopla Mishra -> Roopal Mishra are not rejected
        // merely because whole-name Levenshtein similarity
        // falls just below 85.
        //
        // Non-transposition edit-distance-2 cases still
        // require the 85 full-name similarity floor.
        if(
          relation.damerau > 1 &&
          score <
          V2_NEXT_RULES_PREVIEW
            .MIN_FULL_NAME_SIMILARITY
        ){
          return;
        }

        nearPool.push({
          item:
            item,
          score:
            score,
          evidence:
            relation
        });

      }
    );

  if(
    nearPool.length
  ){

    return V2NR_resolveScoredPool_(
      nearPool,
      "EXACT_ANCHOR_PLUS_CLOSE_OR_TRANSPOSED_RESIDUAL_TOKEN",
      "PROPOSE_AUTO_ANCHORED_NEAR_TOKEN",
      normalized
    );

  }

  return V2NR_noMatch_(
    "NO_NEW_SAFE_RULE_MATCH"
  );

}


/******************************************************
 * PRIVATE — RESOLVE CANDIDATE POOL
 *
 * Rules:
 * - one compatible Candidate ID -> normal proposal
 * - multiple compatible IDs:
 *     exactly one Active + all others Inactive -> Active
 *     otherwise BLOCK
 ******************************************************/
function V2NR_resolvePool_(
  pool,
  reason,
  uniqueStatus,
  rawNormalized
){

  const byId = {};

  (pool || [])
    .forEach(
      function(item){
        byId[
          item.candidateId
        ] = item;
      }
    );

  const unique =
    Object.keys(
      byId
    )
      .map(
        function(id){
          return byId[id];
        }
      );

  if(
    unique.length === 1
  ){

    const item =
      unique[0];

    return V2NR_result_(
      uniqueStatus,
      item,
      V2NR_similarity_(
        rawNormalized,
        item.normalized
      ),
      reason
    );

  }

  const active =
    unique.filter(
      function(item){
        return (
          item.activeStatus ===
          "ACTIVE"
        );
      }
    );

  const inactive =
    unique.filter(
      function(item){
        return (
          item.activeStatus ===
          "INACTIVE"
        );
      }
    );

  //--------------------------------------------------
  // Strict Active-status tie-break:
  // exactly one Active and EVERY other candidate must
  // explicitly be Inactive.
  //--------------------------------------------------

  if(
    active.length === 1 &&
    inactive.length ===
      unique.length - 1
  ){

    return V2NR_result_(
      "PROPOSE_AUTO_ACTIVE_DISAMBIGUATED",
      active[0],
      V2NR_similarity_(
        rawNormalized,
        active[0].normalized
      ),
      (
        reason +
        "_EXACTLY_ONE_ACTIVE_ALL_OTHERS_INACTIVE"
      )
    );

  }

  return {
    status:
      "BLOCK_MULTIPLE_COMPATIBLE",
    candidateId:
      "",
    officialName:
      "",
    activeStatus:
      "",
    score:
      0,
    reason:
      reason +
      "_MULTIPLE_CANDIDATES_REMAIN",
    compatibleCandidates:
      unique.map(
        function(item){
          return {
            candidateId:
              item.candidateId,
            officialName:
              item.officialName,
            activeStatus:
              item.activeStatus
          };
        }
      )
  };

}


/******************************************************
 * PRIVATE — RESOLVE SCORED POOL
 ******************************************************/
function V2NR_resolveScoredPool_(
  scoredPool,
  reason,
  uniqueStatus,
  rawNormalized
){

  const sorted =
    scoredPool
      .slice()
      .sort(
        function(a,b){

          if(
            b.score !==
            a.score
          ){
            return b.score - a.score;
          }

          return String(
            a.item.candidateId
          ).localeCompare(
            String(
              b.item.candidateId
            )
          );

        }
      );

  if(
    sorted.length === 1
  ){

    return V2NR_result_(
      uniqueStatus,
      sorted[0].item,
      sorted[0].score,
      reason
    );

  }

  //--------------------------------------------------
  // Do NOT use score margin alone to choose.
  // If multiple candidates satisfy the actual rule,
  // Active Status may break the tie ONLY if exactly one
  // is Active and every other candidate is Inactive.
  //--------------------------------------------------

  return V2NR_resolvePool_(
    sorted.map(
      function(entry){
        return entry.item;
      }
    ),
    reason,
    uniqueStatus,
    rawNormalized
  );

}


/******************************************************
 * PRIVATE — RAW STRUCTURAL COMPATIBILITY
 *
 * Raw tokens must appear in Master order.
 * Raw single-letter token may expand to a Master token
 * beginning with that letter.
 ******************************************************/
function V2NR_rawStructuralCompatible_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length < 1 ||
    rawTokens.length >
      masterTokens.length
  ){
    return false;
  }

  let masterIndex = 0;

  for(
    let r = 0;
    r < rawTokens.length;
    r++
  ){

    const rawToken =
      rawTokens[r];

    let found = false;

    while(
      masterIndex <
      masterTokens.length
    ){

      const masterToken =
        masterTokens[
          masterIndex
        ];

      masterIndex++;

      const exact =
        rawToken ===
        masterToken;

      const initial =
        rawToken.length === 1 &&
        masterToken
          .charAt(0) ===
        rawToken;

      if(
        exact ||
        initial
      ){

        found = true;
        break;

      }

    }

    if(!found){
      return false;
    }

  }

  return true;

}


/******************************************************
 * PRIVATE — REVERSE INITIAL COMPATIBILITY
 *
 * Requires:
 * - same number of tokens
 * - at least one exact full token
 * - at least one Master initial that matches the first
 *   letter of the corresponding Raw full token
 * - every token can be paired
 *
 * Uses order-independent backtracking so first/last name
 * order does not create a false negative.
 ******************************************************/
function V2NR_reverseInitialCompatible_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 2
  ){
    return false;
  }

  const usedRaw = [];

  for(
    let i = 0;
    i < rawTokens.length;
    i++
  ){
    usedRaw[i] = false;
  }

  const result =
    V2NR_reverseInitialBacktrack_(
      rawTokens,
      masterTokens,
      0,
      usedRaw,
      0,
      0
    );

  return (
    result &&
    result.exactCount >= 1 &&
    result.initialCount >= 1
  );

}


function V2NR_reverseInitialBacktrack_(
  rawTokens,
  masterTokens,
  masterIndex,
  usedRaw,
  exactCount,
  initialCount
){

  if(
    masterIndex >=
    masterTokens.length
  ){

    return {
      exactCount:
        exactCount,
      initialCount:
        initialCount
    };

  }

  const masterToken =
    masterTokens[
      masterIndex
    ];

  for(
    let r = 0;
    r < rawTokens.length;
    r++
  ){

    if(
      usedRaw[r]
    ){
      continue;
    }

    const rawToken =
      rawTokens[r];

    const exact =
      masterToken ===
      rawToken;

    const masterInitial =
      masterToken.length === 1 &&
      rawToken.length > 1 &&
      rawToken
        .charAt(0) ===
      masterToken;

    if(
      !exact &&
      !masterInitial
    ){
      continue;
    }

    usedRaw[r] = true;

    const result =
      V2NR_reverseInitialBacktrack_(
        rawTokens,
        masterTokens,
        masterIndex + 1,
        usedRaw,
        exactCount +
          (
            exact
              ? 1
              : 0
          ),
        initialCount +
          (
            masterInitial
              ? 1
              : 0
          )
      );

    usedRaw[r] = false;

    if(result){
      return result;
    }

  }

  return null;

}


/******************************************************
 * PRIVATE — MULTI-TOKEN SMALL EDIT RELATION
 ******************************************************/
function V2NR_multiTokenEditRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 3
  ){
    return {
      ok:
        false
    };
  }

  const residual =
    V2NR_cancelExact_(
      rawTokens,
      masterTokens
    );

  if(
    residual.exactCount < 1 ||
    residual.raw.length < 2 ||
    residual.raw.length !==
      residual.master.length
  ){
    return {
      ok:
        false
    };
  }

  const pairing =
    V2NR_pairResidualTokens_(
      residual.raw,
      residual.master,
      function(rawToken,masterToken){

        return (
          V2NR_levenshtein_(
            rawToken,
            masterToken
          ) <= 1
        );

      }
    );

  if(!pairing.ok){
    return {
      ok:
        false
    };
  }

  return {
    ok:
      true,
    exactCount:
      residual.exactCount,
    residualCount:
      residual.raw.length
  };

}


/******************************************************
 * PRIVATE — ANCHORED NEAR RELATION
 ******************************************************/
function V2NR_anchoredNearRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 2
  ){
    return {
      ok:
        false
    };
  }

  const residual =
    V2NR_cancelExact_(
      rawTokens,
      masterTokens
    );

  if(
    residual.exactCount < 1 ||
    residual.raw.length !== 1 ||
    residual.master.length !== 1
  ){
    return {
      ok:
        false
    };
  }

  const rawToken =
    residual.raw[0];

  const masterToken =
    residual.master[0];

  if(
    Math.min(
      rawToken.length,
      masterToken.length
    ) < 5
  ){
    return {
      ok:
        false
    };
  }

  const lev =
    V2NR_levenshtein_(
      rawToken,
      masterToken
    );

  const damerau =
    V2NR_damerauLevenshtein_(
      rawToken,
      masterToken
    );

  if(
    !(
      damerau <= 1 ||
      lev <= 2
    )
  ){
    return {
      ok:
        false
    };
  }

  //--------------------------------------------------
  // v1.2 already safely handles a single Levenshtein-1
  // token. This preview is intended for the next cases.
  //--------------------------------------------------

  if(
    lev <= 1
  ){
    return {
      ok:
        false
    };
  }

  return {
    ok:
      true,
    exactCount:
      residual.exactCount,
    levenshtein:
      lev,
    damerau:
      damerau
  };

}


/******************************************************
 * PRIVATE — CANCEL EXACT TOKENS
 ******************************************************/
function V2NR_cancelExact_(
  rawTokens,
  masterTokens
){

  const raw =
    rawTokens.slice();

  const master =
    masterTokens.slice();

  let exactCount = 0;

  for(
    let r =
      raw.length - 1;
    r >= 0;
    r--
  ){

    const index =
      master.indexOf(
        raw[r]
      );

    if(
      index < 0
    ){
      continue;
    }

    raw.splice(
      r,
      1
    );

    master.splice(
      index,
      1
    );

    exactCount++;

  }

  return {
    raw:
      raw,
    master:
      master,
    exactCount:
      exactCount
  };

}


/******************************************************
 * PRIVATE — PAIR RESIDUAL TOKENS
 ******************************************************/
function V2NR_pairResidualTokens_(
  rawTokens,
  masterTokens,
  relationFn
){

  const used = [];

  for(
    let i = 0;
    i < masterTokens.length;
    i++
  ){
    used[i] = false;
  }

  const ok =
    V2NR_pairBacktrack_(
      rawTokens,
      masterTokens,
      relationFn,
      0,
      used
    );

  return {
    ok:
      !!ok
  };

}


function V2NR_pairBacktrack_(
  rawTokens,
  masterTokens,
  relationFn,
  rawIndex,
  usedMaster
){

  if(
    rawIndex >=
    rawTokens.length
  ){
    return true;
  }

  for(
    let m = 0;
    m < masterTokens.length;
    m++
  ){

    if(
      usedMaster[m]
    ){
      continue;
    }

    if(
      !relationFn(
        rawTokens[
          rawIndex
        ],
        masterTokens[m]
      )
    ){
      continue;
    }

    usedMaster[m] = true;

    if(
      V2NR_pairBacktrack_(
        rawTokens,
        masterTokens,
        relationFn,
        rawIndex + 1,
        usedMaster
      )
    ){
      usedMaster[m] = false;
      return true;
    }

    usedMaster[m] = false;

  }

  return false;

}


/******************************************************
 * PRIVATE — RESULT
 ******************************************************/
function V2NR_result_(
  status,
  item,
  score,
  reason
){

  return {
    status:
      status,
    candidateId:
      item.candidateId,
    officialName:
      item.officialName,
    activeStatus:
      item.activeStatus,
    score:
      score,
    reason:
      reason,
    compatibleCandidates:
      [
        item.candidateId
      ]
  };

}


function V2NR_noMatch_(
  reason
){

  return {
    status:
      "NO_NEW_SAFE_RULE_MATCH",
    candidateId:
      "",
    officialName:
      "",
    activeStatus:
      "",
    score:
      0,
    reason:
      reason,
    compatibleCandidates:
      []
  };

}


/******************************************************
 * PRIVATE — ACTIVE STATUS
 ******************************************************/
function V2NR_activeStatus_(
  value
){

  const normalized =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if(
    normalized ===
    "active"
  ){
    return "ACTIVE";
  }

  if(
    normalized ===
    "inactive"
  ){
    return "INACTIVE";
  }

  return "UNKNOWN";

}


/******************************************************
 * PRIVATE — NORMALIZE / TOKENS
 ******************************************************/
function V2NR_normalize_(
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

  return text;

}


function V2NR_tokens_(
  value
){

  const normalized =
    V2NR_normalize_(
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
 * PRIVATE — SIMILARITY
 ******************************************************/
function V2NR_similarity_(
  left,
  right
){

  const a =
    String(
      left || ""
    );

  const b =
    String(
      right || ""
    );

  const maxLength =
    Math.max(
      a.length,
      b.length
    );

  if(
    maxLength === 0
  ){
    return 100;
  }

  const distance =
    V2NR_levenshtein_(
      a,
      b
    );

  return Math.round(
    (
      1 -
      distance /
      maxLength
    ) *
    10000
  ) /
  100;

}


/******************************************************
 * PRIVATE — LEVENSHTEIN
 ******************************************************/
function V2NR_levenshtein_(
  leftValue,
  rightValue
){

  const left =
    String(
      leftValue || ""
    );

  const right =
    String(
      rightValue || ""
    );

  const rows =
    left.length + 1;

  const cols =
    right.length + 1;

  const matrix = [];

  for(
    let i = 0;
    i < rows;
    i++
  ){

    matrix[i] = [];

    for(
      let j = 0;
      j < cols;
      j++
    ){

      if(i === 0){
        matrix[i][j] = j;
      }else if(j === 0){
        matrix[i][j] = i;
      }else{
        matrix[i][j] = 0;
      }

    }

  }

  for(
    let i = 1;
    i < rows;
    i++
  ){

    for(
      let j = 1;
      j < cols;
      j++
    ){

      const cost =
        left.charAt(
          i - 1
        ) ===
        right.charAt(
          j - 1
        )
          ? 0
          : 1;

      matrix[i][j] =
        Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] +
            cost
        );

    }

  }

  return matrix[
    rows - 1
  ][
    cols - 1
  ];

}


/******************************************************
 * PRIVATE — DAMERAU-LEVENSHTEIN
 *
 * Adjacent transposition counts as one edit.
 ******************************************************/
function V2NR_damerauLevenshtein_(
  leftValue,
  rightValue
){

  const left =
    String(
      leftValue || ""
    );

  const right =
    String(
      rightValue || ""
    );

  const rows =
    left.length + 1;

  const cols =
    right.length + 1;

  const matrix = [];

  for(
    let i = 0;
    i < rows;
    i++
  ){

    matrix[i] = [];

    for(
      let j = 0;
      j < cols;
      j++
    ){

      if(i === 0){
        matrix[i][j] = j;
      }else if(j === 0){
        matrix[i][j] = i;
      }else{
        matrix[i][j] = 0;
      }

    }

  }

  for(
    let i = 1;
    i < rows;
    i++
  ){

    for(
      let j = 1;
      j < cols;
      j++
    ){

      const cost =
        left.charAt(
          i - 1
        ) ===
        right.charAt(
          j - 1
        )
          ? 0
          : 1;

      matrix[i][j] =
        Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] +
            cost
        );

      if(
        i > 1 &&
        j > 1 &&
        left.charAt(
          i - 1
        ) ===
        right.charAt(
          j - 2
        ) &&
        left.charAt(
          i - 2
        ) ===
        right.charAt(
          j - 1
        )
      ){

        matrix[i][j] =
          Math.min(
            matrix[i][j],
            matrix[i - 2][j - 2] +
              1
          );

      }

    }

  }

  return matrix[
    rows - 1
  ][
    cols - 1
  ];

}
