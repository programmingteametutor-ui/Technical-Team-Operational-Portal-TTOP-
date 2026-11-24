/******************************************************
 * V2CANDIDATECOMBINEDEVIDENCEPREVIEW.GS
 * Interview Operations Portal V2
 *
 * READ-ONLY preview for the next Candidate Matcher rules.
 *
 * IMPORTANT
 * ---------
 * - Does NOT write Gateway.
 * - Does NOT write Candidate Master.
 * - Does NOT rebuild anything.
 * - Runs only against candidate rows that are still
 *   unresolved after permanent Matcher v1.1.
 *
 * CURRENT EXPECTED BASELINE
 * -------------------------
 * 419 unresolved Gateway records.
 *
 * BUSINESS PRINCIPLE
 * ------------------
 * Use all usable name evidence to narrow Candidate Master.
 * Auto-propose only when the evidence leaves one safe
 * Candidate ID. Multiple plausible candidates block.
 *
 * RULES PREVIEWED
 * ----------------
 * A. Unordered raw-token subset of Master
 *    Adiraju Anusha
 *    -> Lakshmi Sai Anusha Adiraju
 *
 * B. Master-name subset of Raw (Raw has extra words)
 *    Varahala Bharath Rajana
 *    -> Varahala Bharath
 *
 *    One-token Master names are allowed ONLY when that
 *    exact token occurs in exactly one Candidate Master ID.
 *    Abusufiyan Dudekula -> Abusufiyan
 *
 * C. One-word single-character edit with exact anchors
 *    Vamshi Arutala -> Vamshi Arutla
 *    Ajay Kumar Polam -> Ajay Kumar Pollam
 *
 *    Insertion / deletion / substitution all count as
 *    Levenshtein edit distance 1.
 *
 * D. Merged token + combined evidence
 *    Raghuvamshi Goud Karnati
 *    -> Raghu Vamshi Goud
 *
 *    Saitejdeepkumar Chowdary Bodapati
 *    -> Saiteja Deep Chowdary
 *
 *    The merged part must represent >=2 consecutive Master
 *    name tokens, with at most one character edit, AND
 *    another Master token must match exactly outside the
 *    merged raw token.
 *
 * E. Refined residual-compatible combination
 *    Shared words alone are NOT enough.
 *
 *    Remaining name differences must be explainable as:
 *    - matching initial expansion, OR
 *    - one close residual spelling token, OR
 *    - split Raw tokens merging to one Master token.
 *
 *    This intentionally blocks false v1.4 proposals such
 *    as Sri Ramya Kurlla -> RAMYA SRI MAKKAPATI.
 ******************************************************/


const V2_CE15_PREVIEW = Object.freeze({

  VERSION:
    "V2-CANDIDATE-COMBINED-EVIDENCE-PREVIEW-1.5.0",

  UNRESOLVED_STATUSES:
    Object.freeze({
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
    }),

  AUTO_PROPOSAL_STATUSES:
    Object.freeze({
      PROPOSE_AUTO_UNORDERED_PARTIAL:
        true,
      PROPOSE_AUTO_MASTER_SUBSET_RAW:
        true,
      PROPOSE_AUTO_ONE_TOKEN_EDIT:
        true,
      PROPOSE_AUTO_MERGED_COMBINATION:
        true,
      PROPOSE_AUTO_INITIAL_COMBINATION:
        true,
      PROPOSE_AUTO_ANCHORED_NEAR_COMBINATION:
        true,
      PROPOSE_AUTO_REVERSE_MERGED_COMBINATION:
        true
    })

});


/******************************************************
 * PUBLIC: MAIN READ-ONLY PREVIEW
 ******************************************************/
function V2_previewCandidateCombinedEvidenceV15(){

  const candidateRows =
    V2Repo_getCandidates();

  const gatewayRows =
    V2Repo_getGateway({});

  const master =
    V2CE15_buildMaster_(
      candidateRows
    );

  const unresolvedVariants =
    V2CE15_collectUnresolvedVariants_(
      gatewayRows
    );

  const evaluated = [];

  Object.keys(
    unresolvedVariants
  ).forEach(
    function(key){

      const item =
        unresolvedVariants[key];

      const proposal =
        V2CE15_resolve_(
          item.raw,
          master
        );

      evaluated.push({
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

  const statusByVariant = {};
  const statusByGatewayRecord = {};

  let autoVariants = 0;
  let autoGatewayRecords = 0;
  let remainingVariants = 0;
  let remainingGatewayRecords = 0;

  evaluated.forEach(
    function(item){

      const status =
        item.proposal.status;

      statusByVariant[status] =
        (
          statusByVariant[status] || 0
        ) + 1;

      statusByGatewayRecord[status] =
        (
          statusByGatewayRecord[status] || 0
        ) +
        item.records;

      if(
        V2_CE15_PREVIEW
          .AUTO_PROPOSAL_STATUSES[
            status
          ]
      ){

        autoVariants++;
        autoGatewayRecords +=
          item.records;

      }else{

        remainingVariants++;
        remainingGatewayRecords +=
          item.records;

      }

    }
  );

  const baselineRows =
    evaluated.reduce(
      function(total,item){
        return (
          total +
          item.records
        );
      },
      0
    );

  const proposalExamples =
    evaluated
      .filter(
        function(item){
          return (
            V2_CE15_PREVIEW
              .AUTO_PROPOSAL_STATUSES[
                item.proposal.status
              ]
          );
        }
      )
      .sort(
        V2CE15_sortEvaluated_
      )
      .slice(
        0,
        60
      )
      .map(
        V2CE15_compactProposal_
      );

  const blockedExamples =
    evaluated
      .filter(
        function(item){
          return (
            /^BLOCK_/.test(
              item.proposal.status
            )
          );
        }
      )
      .sort(
        V2CE15_sortEvaluated_
      )
      .slice(
        0,
        40
      )
      .map(
        V2CE15_compactProposal_
      );

  const result = {

    ok:
      (
        baselineRows ===
        autoGatewayRecords +
        remainingGatewayRecords
      ),

    mode:
      "READ_ONLY",

    version:
      V2_CE15_PREVIEW.VERSION,

    baseline: {
      unresolvedGatewayRecords:
        baselineRows,
      unresolvedVariants:
        evaluated.length
    },

    proposedResolution: {
      autoVariants:
        autoVariants,
      autoGatewayRecords:
        autoGatewayRecords,
      remainingVariants:
        remainingVariants,
      remainingGatewayRecords:
        remainingGatewayRecords,
      accountedGatewayRecords:
        autoGatewayRecords +
        remainingGatewayRecords
    },

    statusByVariant:
      statusByVariant,

    statusByGatewayRecord:
      statusByGatewayRecord,

    proposalExamples:
      proposalExamples,

    blockedExamples:
      blockedExamples

  };

  Logger.log(
    "========== V2 COMBINED EVIDENCE PREVIEW v1.5 =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "======================================================="
  );

  return result;

}


/******************************************************
 * PUBLIC: SYNTHETIC SAFETY TEST
 *
 * No Repository or Sheet access.
 ******************************************************/
function V2_testCandidateCombinedEvidenceV15Synthetic(){

  const candidateRows = [
    {"Candidate ID":"CAN-T001","Official Candidate Name":"Lakshmi Sai Anusha Adiraju"},
    {"Candidate ID":"CAN-T002","Official Candidate Name":"Vamshi Arutla"},
    {"Candidate ID":"CAN-T003","Official Candidate Name":"Ajay Kumar Polam"},
    {"Candidate ID":"CAN-T004","Official Candidate Name":"Rani Kumari"},
    {"Candidate ID":"CAN-T005","Official Candidate Name":"Rami Kumari"},
    {"Candidate ID":"CAN-T006","Official Candidate Name":"Raghu Vamshi Goud"},
    {"Candidate ID":"CAN-T007","Official Candidate Name":"Saiteja Deep Chowdary"},
    {"Candidate ID":"CAN-T008","Official Candidate Name":"Abusufiyan"},
    {"Candidate ID":"CAN-T009","Official Candidate Name":"VARAHALA BHARATH"},
    {"Candidate ID":"CAN-T010","Official Candidate Name":"Nalabolu Prasanna Kumar"},
    {"Candidate ID":"CAN-T011","Official Candidate Name":"Sadhu Sri Charan"},
    {"Candidate ID":"CAN-T012","Official Candidate Name":"Shaik Mohammad Sartaj Ali"},
    {"Candidate ID":"CAN-T013","Official Candidate Name":"Jagadeesh Naidu Mamidibathula"},
    {"Candidate ID":"CAN-T014","Official Candidate Name":"Bala Seeta Rami Reddy Avuluri"},
    {"Candidate ID":"CAN-T015","Official Candidate Name":"Naga Sai Kumar Potti"},
    {"Candidate ID":"CAN-T016","Official Candidate Name":"RAMYA SRI MAKKAPATI"},
    {"Candidate ID":"CAN-T017","Official Candidate Name":"Venkata Sai Swetha Gatamaneni"},
    {"Candidate ID":"CAN-T018","Official Candidate Name":"SRI TEJA REDDY VELDURTHI"},
    {"Candidate ID":"CAN-T019","Official Candidate Name":"Venkata Naga Surya Lalitamanogjna Parsa"}
  ];

  const master =
    V2CE15_buildMaster_(
      candidateRows
    );

  const cases = [
    {name:"unordered partial",raw:"Adiraju Anusha",candidateId:"CAN-T001",status:"PROPOSE_AUTO_UNORDERED_PARTIAL"},
    {name:"one edit deletion",raw:"Vamshi Arutala",candidateId:"CAN-T002",status:"PROPOSE_AUTO_ONE_TOKEN_EDIT"},
    {name:"one edit insertion",raw:"Ajay Kumar Pollam",candidateId:"CAN-T003",status:"PROPOSE_AUTO_ONE_TOKEN_EDIT"},
    {name:"ambiguous Ravi blocks",raw:"Ravi Kumari",auto:false},
    {name:"merged raw token",raw:"Raghuvamshi Goud Karnati",candidateId:"CAN-T006",status:"PROPOSE_AUTO_MERGED_COMBINATION"},
    {name:"merged plus typo",raw:"Saitejdeepkumar Chowdary Bodapati",candidateId:"CAN-T007",status:"PROPOSE_AUTO_MERGED_COMBINATION"},
    {name:"one-token Master subset",raw:"Abusufiyan Dudekula",candidateId:"CAN-T008",status:"PROPOSE_AUTO_MASTER_SUBSET_RAW"},
    {name:"two-token Master subset",raw:"Varahala Bharath Rajana",candidateId:"CAN-T009",status:"PROPOSE_AUTO_MASTER_SUBSET_RAW"},
    {name:"initial combination",raw:"Prasanna Kumar N",candidateId:"CAN-T010",status:"PROPOSE_AUTO_INITIAL_COMBINATION"},
    {name:"initial combination 2",raw:"Sri Charan S",candidateId:"CAN-T011",status:"PROPOSE_AUTO_INITIAL_COMBINATION"},
    {name:"anchored distance two",raw:"Shaik Mohmad Sartaj Ali",candidateId:"CAN-T012",status:"PROPOSE_AUTO_ANCHORED_NEAR_COMBINATION"},
    {name:"reverse merged",raw:"Jagadeesh Naidu Mamidi Bathulu",candidateId:"CAN-T013",status:"PROPOSE_AUTO_REVERSE_MERGED_COMBINATION"},
    {name:"near plus Master extra with 3 anchors",raw:"Bala Seetha Rami Reddy",candidateId:"CAN-T014",status:"PROPOSE_AUTO_ANCHORED_NEAR_COMBINATION"},
    {name:"short near with 3 anchors",raw:"Nag Sai Kumar Potti",candidateId:"CAN-T015",status:"PROPOSE_AUTO_ANCHORED_NEAR_COMBINATION"},
    {name:"false shared Sri Ramya blocks",raw:"Sri Ramya Kurlla",auto:false},
    {name:"false initial Sai Swetha K blocks",raw:"Sai Swetha K",auto:false},
    {name:"false shared Sri Lekha Reddy blocks",raw:"Sri Lekha Reddy",auto:false},
    {name:"three anchors but unexplained surname blocks",raw:"Venkata Naga Surya Lalitha Managona",auto:false}
  ];

  const checks =
    cases.map(
      function(test){

        const proposal =
          V2CE15_resolve_(
            test.raw,
            master
          );

        let ok;

        if(
          test.auto === false
        ){

          ok =
            !V2_CE15_PREVIEW
              .AUTO_PROPOSAL_STATUSES[
                proposal.status
              ];

        }else{

          ok =
            proposal.candidateId ===
              test.candidateId &&
            proposal.status ===
              test.status;

        }

        return {
          name:
            test.name,
          raw:
            test.raw,
          expectedStatus:
            test.status || "NOT_AUTO",
          proposal:
            proposal,
          ok:
            ok
        };

      }
    );

  const passed =
    checks.filter(
      function(item){
        return item.ok;
      }
    ).length;

  const result = {
    ok:
      passed ===
      checks.length,
    mode:
      "READ_ONLY_SYNTHETIC",
    version:
      V2_CE15_PREVIEW.VERSION,
    passed:
      passed,
    total:
      checks.length,
    checks:
      checks
  };

  Logger.log(
    "========== V2 COMBINED EVIDENCE v1.5 SYNTHETIC =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "========================================================="
  );

  return result;

}


/******************************************************
 * PUBLIC: LOG ALL AUTO PROPOSALS
 *
 * Run only after the main preview has been reviewed.
 ******************************************************/
function V2_logCandidateCombinedEvidenceAutoProposalsV15(){

  const candidateRows =
    V2Repo_getCandidates();

  const gatewayRows =
    V2Repo_getGateway({});

  const master =
    V2CE15_buildMaster_(
      candidateRows
    );

  const variants =
    V2CE15_collectUnresolvedVariants_(
      gatewayRows
    );

  const proposals = [];

  Object.keys(
    variants
  ).forEach(
    function(key){

      const item =
        variants[key];

      const proposal =
        V2CE15_resolve_(
          item.raw,
          master
        );

      if(
        !V2_CE15_PREVIEW
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
        evidence:
          proposal.evidence
      });

    }
  );

  proposals.sort(
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
    "========== V2 COMBINED EVIDENCE v1.5 AUTO PROPOSALS =========="
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
          "Evidence=" +
            JSON.stringify(
              item.evidence
            )
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
    "========================================================="
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
 * PRIVATE: COLLECT CURRENT UNRESOLVED VARIANTS
 ******************************************************/
function V2CE15_collectUnresolvedVariants_(
  gatewayRows
){

  const variants = {};

  (gatewayRows || [])
    .forEach(
      function(row){

        const status =
          String(
            row[
              "Candidate Match Status"
            ] || ""
          ).trim();

        if(
          !V2_CE15_PREVIEW
            .UNRESOLVED_STATUSES[
              status
            ]
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
          V2CE15_normalize_(
            raw
          ) ||
          "__BLANK__";

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
            status
          ] =
            (
              variants[key]
                .currentStatusCounts[
                  status
                ] || 0
            ) + 1;

      }
    );

  return variants;

}


/******************************************************
 * PRIVATE: BUILD MASTER
 ******************************************************/
function V2CE15_buildMaster_(
  candidateRows
){

  const records = [];
  const tokenCandidateIds = {};

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
          V2CE15_normalize_(
            officialName
          );

        const tokens =
          V2CE15_tokens_(
            normalized
          );

        if(!tokens.length){
          return;
        }

        const record = {
          candidateId:
            candidateId,
          officialName:
            officialName,
          normalized:
            normalized,
          tokens:
            tokens
        };

        records.push(
          record
        );

        const seen = {};

        tokens.forEach(
          function(token){

            if(seen[token])
              return;

            seen[token] = true;

            if(
              !tokenCandidateIds[
                token
              ]
            ){
              tokenCandidateIds[
                token
              ] = {};
            }

            tokenCandidateIds[
              token
            ][
              candidateId
            ] = true;

          }
        );

      }
    );

  return {
    records:
      records,
    tokenCandidateIds:
      tokenCandidateIds
  };

}


/******************************************************
 * PRIVATE: RESOLVE ONE RAW NAME
 ******************************************************/
function V2CE15_resolve_(
  rawName,
  master
){

  const rawTokens =
    V2CE15_tokens_(
      rawName
    );

  if(
    rawTokens.length < 1
  ){

    return V2CE15_noMatch_(
      "NO_RAW_NAME_TOKENS"
    );

  }

  const evidenceRows = [];

  (master.records || [])
    .forEach(
      function(candidate){

        const evidence =
          V2CE15_candidateEvidence_(
            rawTokens,
            candidate,
            master
          );

        if(
          evidence &&
          evidence.compatible
        ){

          evidenceRows.push({
            candidate:
              candidate,
            evidence:
              evidence
          });

        }

      }
    );

  if(
    evidenceRows.length === 0
  ){

    return V2CE15_noMatch_(
      "NO_COMBINED_EVIDENCE_MATCH"
    );

  }

  //--------------------------------------------------
  // Rank by evidence strength.
  //
  // The rank is NOT a fuzzy confidence score.
  // It only chooses the strongest combination of the
  // explicit safe relations implemented in this preview.
  //--------------------------------------------------

  evidenceRows.sort(
    function(a,b){
      return (
        V2CE15_compareEvidence_(
          b.evidence,
          a.evidence
        )
      );
    }
  );

  const best =
    evidenceRows[0];

  const bestPeers =
    evidenceRows.filter(
      function(item){
        return (
          V2CE15_compareEvidence_(
            item.evidence,
            best.evidence
          ) === 0
        );
      }
    );

  const bestCandidateIds = {};

  bestPeers.forEach(
    function(item){
      bestCandidateIds[
        item.candidate.candidateId
      ] = true;
    }
  );

  const uniqueBestIds =
    Object.keys(
      bestCandidateIds
    );

  if(
    uniqueBestIds.length !== 1
  ){

    return {
      status:
        "BLOCK_MULTIPLE_COMBINED_EVIDENCE",
      candidateId:
        "",
      officialName:
        "",
      reason:
        "TOP_COMBINED_EVIDENCE_TIED_ACROSS_MULTIPLE_CANDIDATES",
      evidence:
        best.evidence,
      compatibleCandidates:
        bestPeers.map(
          function(item){
            return (
              item.candidate
                .candidateId +
              " " +
              item.candidate
                .officialName
            );
          }
        )
    };

  }

  const winner =
    bestPeers[0];

  return {
    status:
      winner.evidence
        .proposalStatus,
    candidateId:
      winner.candidate
        .candidateId,
    officialName:
      winner.candidate
        .officialName,
    reason:
      winner.evidence
        .reason,
    evidence:
      winner.evidence,
    compatibleCandidates:
      [
        winner.candidate
          .candidateId
      ]
  };

}


/******************************************************
 * PRIVATE: CANDIDATE EVIDENCE
 ******************************************************/
function V2CE15_candidateEvidence_(
  rawTokens,
  candidate,
  master
){

  const masterTokens =
    candidate.tokens;

  const exactShared =
    V2CE15_exactSharedCount_(
      rawTokens,
      masterTokens
    );

  //--------------------------------------------------
  // RULE A:
  // Raw tokens are all contained in Master,
  // regardless of order, and Master has extras.
  //--------------------------------------------------

  if(
    rawTokens.length >= 2 &&
    rawTokens.length <
      masterTokens.length &&
    V2CE15_multisetContains_(
      masterTokens,
      rawTokens
    )
  ){

    return {
      compatible:
        true,
      proposalStatus:
        "PROPOSE_AUTO_UNORDERED_PARTIAL",
      rank:
        500,
      exactShared:
        rawTokens.length,
      coveredMasterTokens:
        rawTokens.length,
      editCount:
        0,
      reason:
        "ALL_RAW_TOKENS_EXIST_IN_MASTER_UNORDERED"
    };

  }

  //--------------------------------------------------
  // RULE B:
  // Entire Master name is contained in Raw.
  // Raw may have extra tokens.
  //--------------------------------------------------

  if(
    masterTokens.length <=
      rawTokens.length &&
    V2CE15_multisetContains_(
      rawTokens,
      masterTokens
    )
  ){

    // One-token official names require the token itself
    // to identify only one Candidate ID anywhere in Master.
    if(
      masterTokens.length === 1
    ){

      const token =
        masterTokens[0];

      const ids =
        master
          .tokenCandidateIds[
            token
          ] || {};

      if(
        Object.keys(
          ids
        ).length !== 1
      ){
        return null;
      }

    }

    // Exact equal-token-count names would already have
    // been resolved by Matcher v1.1, so only extra-Raw
    // cases should normally reach this preview.
    if(
      rawTokens.length >
        masterTokens.length
    ){

      return {
        compatible:
          true,
        proposalStatus:
          "PROPOSE_AUTO_MASTER_SUBSET_RAW",
        rank:
          490,
        exactShared:
          masterTokens.length,
        coveredMasterTokens:
          masterTokens.length,
        editCount:
          0,
        reason:
          masterTokens.length === 1
            ? "UNIQUE_MASTER_TOKEN_FULL_NAME_FOUND_IN_RAW"
            : "ALL_MASTER_TOKENS_EXIST_IN_RAW_WITH_EXTRA_RAW_TOKENS"
      };

    }

  }

  //--------------------------------------------------
  // RULE C:
  // Same number of tokens; exactly one differing pair
  // with edit distance 1 and at least one exact anchor.
  //--------------------------------------------------

  const oneEdit =
    V2CE15_oneTokenEditRelation_(
      rawTokens,
      masterTokens
    );

  if(
    oneEdit.compatible
  ){

    return {
      compatible:
        true,
      proposalStatus:
        "PROPOSE_AUTO_ONE_TOKEN_EDIT",
      rank:
        470,
      exactShared:
        oneEdit.exactShared,
      coveredMasterTokens:
        masterTokens.length,
      editCount:
        1,
      rawTypoToken:
        oneEdit.rawTypoToken,
      masterTypoToken:
        oneEdit.masterTypoToken,
      reason:
        "ONE_WORD_SINGLE_CHARACTER_EDIT_WITH_EXACT_NAME_ANCHOR"
    };

  }

  //--------------------------------------------------
  // RULE D:
  // Merged raw token represents >=2 consecutive Master
  // tokens. Another Master token must be exact outside
  // that merged raw token.
  //--------------------------------------------------

  const merged =
    V2CE15_mergedCombinationRelation_(
      rawTokens,
      masterTokens
    );

  if(
    merged.compatible
  ){

    return {
      compatible:
        true,
      proposalStatus:
        "PROPOSE_AUTO_MERGED_COMBINATION",
      rank:
        450 +
        merged.coveredMasterTokens,
      exactShared:
        merged.exactOutsideCount,
      coveredMasterTokens:
        merged.coveredMasterTokens,
      editCount:
        merged.mergeEditDistance,
      mergedRawToken:
        merged.mergedRawToken,
      mergedMasterTokens:
        merged.mergedMasterTokens,
      reason:
        "MERGED_MASTER_NAME_COMPONENTS_PLUS_INDEPENDENT_EXACT_ANCHOR"
    };

  }

  //--------------------------------------------------
  // RULE E — REFINED COMBINED EVIDENCE
  //
  // v1.4 showed that "2 shared words = auto" is too broad.
  // Examples that MUST remain blocked:
  //   Sri Ramya Kurlla -> RAMYA SRI MAKKAPATI
  //   Sri Lekha Reddy  -> SRI TEJA REDDY VELDURTHI
  //   Sai Swetha K     -> Venkata Sai Swetha Gatamaneni
  //
  // Therefore 2+ shared words are only supporting anchors.
  // Every remaining meaningful difference must also be
  // explainable by one of these explicit relations:
  //
  // 1. Raw initial -> Master full token
  // 2. One residual word is a close spelling variant
  //    (edit <= 2 with strong exact anchors)
  // 3. Multiple Raw residual words combine into one
  //    Master token with <= 1 edit
  //--------------------------------------------------

  if(
    exactShared >= 2
  ){

    const residual =
      V2CE15_refinedResidualRelation_(
        rawTokens,
        masterTokens,
        exactShared
      );

    if(
      residual.compatible
    ){

      return residual;

    }

  }

  return null;

}


/******************************************************
 * PRIVATE: REFINED RESIDUAL RELATION
 *
 * Exact shared tokens are cancelled first. The remaining
 * name differences must be structurally explainable.
 ******************************************************/
function V2CE15_refinedResidualRelation_(
  rawTokens,
  masterTokens,
  exactShared
){

  const residual =
    V2CE15_cancelExactTokens_(
      rawTokens,
      masterTokens
    );

  const rawRemaining =
    residual.rawRemaining;

  const masterRemaining =
    residual.masterRemaining;

  //--------------------------------------------------
  // E1. Initial expansion with exact anchors.
  //
  // Prasanna Kumar N -> Nalabolu Prasanna Kumar
  // Sri Charan S     -> Sadhu Sri Charan
  //
  // Sai Swetha K -> ... Gatamaneni is blocked because
  // K does not correspond to the remaining Master token.
  //--------------------------------------------------
  if(
    rawRemaining.length === 1 &&
    masterRemaining.length === 1 &&
    rawRemaining[0].length === 1 &&
    masterRemaining[0]
      .charAt(0) ===
      rawRemaining[0]
  ){

    return {
      compatible:
        true,
      proposalStatus:
        "PROPOSE_AUTO_INITIAL_COMBINATION",
      rank:
        445 +
        exactShared,
      exactShared:
        exactShared,
      coveredMasterTokens:
        exactShared + 1,
      editCount:
        0,
      rawInitial:
        rawRemaining[0],
      masterExpandedToken:
        masterRemaining[0],
      reason:
        "EXACT_NAME_ANCHORS_PLUS_MATCHING_INITIAL_EXPANSION"
    };

  }

  //--------------------------------------------------
  // E2. One residual near-token pair.
  //
  // Safe examples:
  //   Mohmad -> Mohammad       (2 edits)
  //   Satesh -> Sathish        (2 edits)
  //   Nandhi -> Nandini        (2 edits)
  //   Rishika -> Risihka       (2 Levenshtein edits)
  //   Nag -> Naga              (1 edit with 3 anchors)
  //
  // If unmatched extras remain on one side, require at
  // least THREE exact anchors. This supports:
  //   Bala Seetha Rami Reddy
  //   -> Bala Seeta Rami Reddy Avuluri
  //--------------------------------------------------
  const near =
    V2CE15_findSingleResidualNearPair_(
      rawRemaining,
      masterRemaining
    );

  if(
    near.compatible
  ){

    const rawLeft =
      rawRemaining.length - 1;

    const masterLeft =
      masterRemaining.length - 1;

    const leftoversOnBothSides =
      rawLeft > 0 &&
      masterLeft > 0;

    const extrasRemain =
      rawLeft > 0 ||
      masterLeft > 0;

    if(
      !leftoversOnBothSides &&
      (
        !extrasRemain ||
        exactShared >= 3
      )
    ){

      return {
        compatible:
          true,
        proposalStatus:
          "PROPOSE_AUTO_ANCHORED_NEAR_COMBINATION",
        rank:
          435 +
          exactShared +
          (
            near.distance === 1
              ? 2
              : 1
          ),
        exactShared:
          exactShared,
        coveredMasterTokens:
          exactShared + 1,
        editCount:
          near.distance,
        rawNearToken:
          near.rawToken,
        masterNearToken:
          near.masterToken,
        residualRawExtras:
          rawLeft,
        residualMasterExtras:
          masterLeft,
        reason:
          "STRONG_EXACT_ANCHORS_PLUS_ONE_EXPLAINABLE_NEAR_NAME_TOKEN"
      };

    }

  }

  //--------------------------------------------------
  // E3. Reverse merge:
  // multiple Raw residual tokens -> one Master token.
  //
  // Jagadeesh Naidu Mamidi Bathulu
  // -> Jagadeesh Naidu Mamidibathula
  //--------------------------------------------------
  const reverseMerged =
    V2CE15_reverseMergedResidual_(
      rawRemaining,
      masterRemaining
    );

  if(
    reverseMerged.compatible
  ){

    const rawLeft =
      rawRemaining.length -
      reverseMerged.rawGroupSize;

    const masterLeft =
      masterRemaining.length - 1;

    const leftoversOnBothSides =
      rawLeft > 0 &&
      masterLeft > 0;

    const extrasRemain =
      rawLeft > 0 ||
      masterLeft > 0;

    if(
      !leftoversOnBothSides &&
      (
        !extrasRemain ||
        exactShared >= 3
      )
    ){

      return {
        compatible:
          true,
        proposalStatus:
          "PROPOSE_AUTO_REVERSE_MERGED_COMBINATION",
        rank:
          440 +
          exactShared,
        exactShared:
          exactShared,
        coveredMasterTokens:
          exactShared + 1,
        editCount:
          reverseMerged.distance,
        mergedRawTokens:
          reverseMerged.rawTokens,
        masterMergedToken:
          reverseMerged.masterToken,
        reason:
          "MULTIPLE_RAW_NAME_TOKENS_COMBINE_TO_ONE_MASTER_TOKEN_WITH_EXACT_ANCHORS"
      };

    }

  }

  return {
    compatible:
      false
  };

}


/******************************************************
 * PRIVATE: CANCEL EXACT TOKENS
 ******************************************************/
function V2CE15_cancelExactTokens_(
  rawTokens,
  masterTokens
){

  const rawRemaining =
    rawTokens.slice();

  const masterRemaining =
    masterTokens.slice();

  let exactShared = 0;

  for(
    let r =
      rawRemaining.length - 1;
    r >= 0;
    r--
  ){

    const index =
      masterRemaining.indexOf(
        rawRemaining[r]
      );

    if(
      index < 0
    ){
      continue;
    }

    rawRemaining.splice(
      r,
      1
    );

    masterRemaining.splice(
      index,
      1
    );

    exactShared++;

  }

  return {
    exactShared:
      exactShared,
    rawRemaining:
      rawRemaining,
    masterRemaining:
      masterRemaining
  };

}


/******************************************************
 * PRIVATE: SINGLE RESIDUAL NEAR PAIR
 *
 * Exactly one best raw/master residual token pair must be
 * identifiable inside this candidate.
 ******************************************************/
function V2CE15_findSingleResidualNearPair_(
  rawRemaining,
  masterRemaining
){

  const pairs = [];

  for(
    let r = 0;
    r < rawRemaining.length;
    r++
  ){

    const rawToken =
      rawRemaining[r];

    for(
      let m = 0;
      m < masterRemaining.length;
      m++
    ){

      const masterToken =
        masterRemaining[m];

      const distance =
        V2CE15_levenshtein_(
          rawToken,
          masterToken
        );

      const minLength =
        Math.min(
          rawToken.length,
          masterToken.length
        );

      const allowed =
        (
          distance === 1 &&
          minLength >= 3
        ) ||
        (
          distance === 2 &&
          minLength >= 5
        );

      if(!allowed){
        continue;
      }

      pairs.push({
        rawIndex:
          r,
        masterIndex:
          m,
        rawToken:
          rawToken,
        masterToken:
          masterToken,
        distance:
          distance
      });

    }

  }

  if(
    pairs.length === 0
  ){

    return {
      compatible:
        false
    };

  }

  pairs.sort(
    function(a,b){

      if(
        a.distance !==
        b.distance
      ){
        return (
          a.distance -
          b.distance
        );
      }

      const aLenDelta =
        Math.abs(
          a.rawToken.length -
          a.masterToken.length
        );

      const bLenDelta =
        Math.abs(
          b.rawToken.length -
          b.masterToken.length
        );

      return (
        aLenDelta -
        bLenDelta
      );

    }
  );

  const best =
    pairs[0];

  const tiedBest =
    pairs.filter(
      function(item){

        return (
          item.distance ===
            best.distance &&
          Math.abs(
            item.rawToken.length -
            item.masterToken.length
          ) ===
          Math.abs(
            best.rawToken.length -
            best.masterToken.length
          )
        );

      }
    );

  if(
    tiedBest.length !== 1
  ){

    return {
      compatible:
        false
    };

  }

  return {
    compatible:
      true,
    rawIndex:
      best.rawIndex,
    masterIndex:
      best.masterIndex,
    rawToken:
      best.rawToken,
    masterToken:
      best.masterToken,
    distance:
      best.distance
  };

}


/******************************************************
 * PRIVATE: REVERSE MERGED RESIDUAL
 *
 * Tries groups of 2-3 Raw residual tokens joined together
 * against one Master residual token.
 ******************************************************/
function V2CE15_reverseMergedResidual_(
  rawRemaining,
  masterRemaining
){

  if(
    rawRemaining.length < 2 ||
    masterRemaining.length < 1
  ){

    return {
      compatible:
        false
    };

  }

  const matches = [];

  const maxGroup =
    Math.min(
      3,
      rawRemaining.length
    );

  for(
    let groupSize = 2;
    groupSize <= maxGroup;
    groupSize++
  ){

    for(
      let start = 0;
      start + groupSize <=
        rawRemaining.length;
      start++
    ){

      const group =
        rawRemaining.slice(
          start,
          start + groupSize
        );

      const joined =
        group.join(
          ""
        );

      for(
        let m = 0;
        m < masterRemaining.length;
        m++
      ){

        const masterToken =
          masterRemaining[m];

        const distance =
          V2CE15_levenshtein_(
            joined,
            masterToken
          );

        if(
          distance > 1
        ){
          continue;
        }

        matches.push({
          rawStart:
            start,
          rawGroupSize:
            groupSize,
          rawTokens:
            group,
          masterIndex:
            m,
          masterToken:
            masterToken,
          distance:
            distance
        });

      }

    }

  }

  if(
    matches.length === 0
  ){

    return {
      compatible:
        false
    };

  }

  matches.sort(
    function(a,b){

      if(
        a.distance !==
        b.distance
      ){
        return (
          a.distance -
          b.distance
        );
      }

      return (
        b.rawGroupSize -
        a.rawGroupSize
      );

    }
  );

  const best =
    matches[0];

  const tied =
    matches.filter(
      function(item){
        return (
          item.distance ===
            best.distance &&
          item.rawGroupSize ===
            best.rawGroupSize
        );
      }
    );

  if(
    tied.length !== 1
  ){

    return {
      compatible:
        false
    };

  }

  return Object.assign(
    {
      compatible:
        true
    },
    best
  );

}


/******************************************************
 * PRIVATE: COMPARE EVIDENCE
 *
 * 0 = tied.
 * Positive = left stronger than right.
 ******************************************************/
function V2CE15_compareEvidence_(
  left,
  right
){

  const leftTuple = [
    Number(
      left.rank || 0
    ),
    Number(
      left.coveredMasterTokens || 0
    ),
    Number(
      left.exactShared || 0
    ),
    -Number(
      left.editCount || 0
    )
  ];

  const rightTuple = [
    Number(
      right.rank || 0
    ),
    Number(
      right.coveredMasterTokens || 0
    ),
    Number(
      right.exactShared || 0
    ),
    -Number(
      right.editCount || 0
    )
  ];

  for(
    let i = 0;
    i < leftTuple.length;
    i++
  ){

    if(
      leftTuple[i] >
      rightTuple[i]
    ){
      return 1;
    }

    if(
      leftTuple[i] <
      rightTuple[i]
    ){
      return -1;
    }

  }

  return 0;

}


/******************************************************
 * PRIVATE: ONE-TOKEN EDIT RELATION
 ******************************************************/
function V2CE15_oneTokenEditRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 2
  ){

    return {
      compatible:
        false
    };

  }

  const rawRemaining =
    rawTokens.slice();

  const masterRemaining =
    masterTokens.slice();

  let exactShared = 0;

  for(
    let r =
      rawRemaining.length - 1;
    r >= 0;
    r--
  ){

    const token =
      rawRemaining[r];

    const index =
      masterRemaining
        .indexOf(
          token
        );

    if(
      index < 0
    ){
      continue;
    }

    rawRemaining.splice(
      r,
      1
    );

    masterRemaining.splice(
      index,
      1
    );

    exactShared++;

  }

  if(
    exactShared < 1 ||
    rawRemaining.length !== 1 ||
    masterRemaining.length !== 1
  ){

    return {
      compatible:
        false
    };

  }

  const rawTypoToken =
    rawRemaining[0];

  const masterTypoToken =
    masterRemaining[0];

  if(
    rawTypoToken.length < 4 ||
    masterTypoToken.length < 4
  ){

    return {
      compatible:
        false
    };

  }

  const distance =
    V2CE15_levenshtein_(
      rawTypoToken,
      masterTypoToken
    );

  if(
    distance !== 1
  ){

    return {
      compatible:
        false
    };

  }

  return {
    compatible:
      true,
    exactShared:
      exactShared,
    rawTypoToken:
      rawTypoToken,
    masterTypoToken:
      masterTypoToken,
    editDistance:
      distance
  };

}


/******************************************************
 * PRIVATE: MERGED COMBINATION RELATION
 ******************************************************/
function V2CE15_mergedCombinationRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length < 2 ||
    masterTokens.length < 3
  ){

    return {
      compatible:
        false
    };

  }

  let best = null;

  for(
    let rawIndex = 0;
    rawIndex < rawTokens.length;
    rawIndex++
  ){

    const rawToken =
      rawTokens[
        rawIndex
      ];

    if(
      rawToken.length < 6
    ){
      continue;
    }

    // Try longest Master groups first.
    const maxGroup =
      Math.min(
        3,
        masterTokens.length - 1
      );

    for(
      let groupSize =
        maxGroup;
      groupSize >= 2;
      groupSize--
    ){

      for(
        let start = 0;
        start + groupSize <=
          masterTokens.length;
        start++
      ){

        const group =
          masterTokens.slice(
            start,
            start + groupSize
          );

        const target =
          group.join(
            ""
          );

        if(
          target.length < 6
        ){
          continue;
        }

        const approx =
          V2CE15_findApproxSubstring_(
            rawToken,
            target,
            1
          );

        if(
          !approx.matched
        ){
          continue;
        }

        //------------------------------------------------
        // Independent exact anchor:
        // another Master token OUTSIDE the merged group
        // must exist as a complete different Raw token.
        //------------------------------------------------

        const groupIndexes = {};

        for(
          let g = start;
          g <
            start + groupSize;
          g++
        ){
          groupIndexes[g] =
            true;
        }

        let exactOutsideCount = 0;

        for(
          let mi = 0;
          mi < masterTokens.length;
          mi++
        ){

          if(
            groupIndexes[mi]
          ){
            continue;
          }

          const masterToken =
            masterTokens[mi];

          for(
            let ri = 0;
            ri < rawTokens.length;
            ri++
          ){

            if(
              ri === rawIndex
            ){
              continue;
            }

            if(
              rawTokens[ri] ===
              masterToken
            ){

              exactOutsideCount++;
              break;

            }

          }

        }

        if(
          exactOutsideCount < 1
        ){
          continue;
        }

        const coveredMasterTokens =
          groupSize +
          exactOutsideCount;

        const candidate = {
          compatible:
            true,
          mergedRawToken:
            rawToken,
          mergedMasterTokens:
            group,
          groupSize:
            groupSize,
          exactOutsideCount:
            exactOutsideCount,
          coveredMasterTokens:
            coveredMasterTokens,
          mergeEditDistance:
            approx.distance,
          matchedSubstring:
            approx.substring
        };

        if(
          !best ||
          candidate.coveredMasterTokens >
            best.coveredMasterTokens ||
          (
            candidate.coveredMasterTokens ===
              best.coveredMasterTokens &&
            candidate.groupSize >
              best.groupSize
          ) ||
          (
            candidate.coveredMasterTokens ===
              best.coveredMasterTokens &&
            candidate.groupSize ===
              best.groupSize &&
            candidate.mergeEditDistance <
              best.mergeEditDistance
          )
        ){
          best =
            candidate;
        }

      }

    }

  }

  return best || {
    compatible:
      false
  };

}


/******************************************************
 * PRIVATE: APPROXIMATE TARGET INSIDE RAW TOKEN
 *
 * Finds a substring whose length differs from target by
 * at most 1 and whose Levenshtein distance is <= maxEdit.
 *
 * This allows:
 *   raghuvamshi   ~= raghuvamshi
 *   saitejdeep... ~= saitejadeep (1 missing character)
 ******************************************************/
function V2CE15_findApproxSubstring_(
  rawToken,
  target,
  maxEdit
){

  const raw =
    String(
      rawToken || ""
    );

  const expected =
    String(
      target || ""
    );

  const lengths = [
    expected.length - 1,
    expected.length,
    expected.length + 1
  ]
    .filter(
      function(length){
        return (
          length >= 1 &&
          length <= raw.length
        );
      }
    );

  let best = null;

  lengths.forEach(
    function(length){

      for(
        let start = 0;
        start + length <=
          raw.length;
        start++
      ){

        const part =
          raw.substr(
            start,
            length
          );

        const distance =
          V2CE15_levenshtein_(
            part,
            expected
          );

        if(
          distance >
          maxEdit
        ){
          continue;
        }

        if(
          !best ||
          distance <
            best.distance
        ){

          best = {
            matched:
              true,
            substring:
              part,
            distance:
              distance,
            start:
              start
          };

        }

      }

    }
  );

  return best || {
    matched:
      false,
    substring:
      "",
    distance:
      null
  };

}


/******************************************************
 * PRIVATE: EXACT SHARED TOKEN COUNT
 ******************************************************/
function V2CE15_exactSharedCount_(
  rawTokens,
  masterTokens
){

  const remaining =
    masterTokens.slice();

  let count = 0;

  rawTokens.forEach(
    function(token){

      const index =
        remaining.indexOf(
          token
        );

      if(
        index < 0
      ){
        return;
      }

      count++;

      remaining.splice(
        index,
        1
      );

    }
  );

  return count;

}


/******************************************************
 * PRIVATE: MULTISET CONTAINS
 ******************************************************/
function V2CE15_multisetContains_(
  containerTokens,
  subsetTokens
){

  const remaining =
    containerTokens.slice();

  for(
    let i = 0;
    i < subsetTokens.length;
    i++
  ){

    const index =
      remaining.indexOf(
        subsetTokens[i]
      );

    if(
      index < 0
    ){
      return false;
    }

    remaining.splice(
      index,
      1
    );

  }

  return true;

}


/******************************************************
 * PRIVATE: NORMALIZE / TOKENS
 ******************************************************/
function V2CE15_normalize_(
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


function V2CE15_tokens_(
  value
){

  const normalized =
    V2CE15_normalize_(
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
 * PRIVATE: LEVENSHTEIN
 ******************************************************/
function V2CE15_levenshtein_(
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
        matrix[i][j] =
          j;
      }else if(j === 0){
        matrix[i][j] =
          i;
      }else{
        matrix[i][j] =
          0;
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
          matrix[i - 1][j] +
            1,
          matrix[i][j - 1] +
            1,
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
 * PRIVATE: OUTPUT HELPERS
 ******************************************************/
function V2CE15_noMatch_(
  reason
){

  return {
    status:
      "NO_COMBINED_EVIDENCE_MATCH",
    candidateId:
      "",
    officialName:
      "",
    reason:
      reason,
    evidence:
      {},
    compatibleCandidates:
      []
  };

}


function V2CE15_sortEvaluated_(
  a,
  b
){

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


function V2CE15_compactProposal_(
  item
){

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
      item.proposal.reason,
    evidence:
      item.proposal.evidence,
    compatibleCandidates:
      item.proposal
        .compatibleCandidates
  };

}
