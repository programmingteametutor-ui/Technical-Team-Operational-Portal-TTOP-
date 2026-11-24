/******************************************************
 * V2CANDIDATEMATCHINGPREVIEW.GS
 * Interview Operations Portal V2
 *
 * READ-ONLY Candidate Master -> Gateway matching preview
 *
 * PURPOSE
 * -------
 * Evaluate how the 3,321 current Gateway records can be
 * linked to permanent Candidate IDs WITHOUT writing any
 * Candidate ID or match status into Gateway yet.
 *
 * SAFETY
 * ------
 * - Reads V2 Candidate Master through V2Repository.
 * - Reads V2 Interview Gateway through V2Repository.
 * - Does NOT write Candidate Master.
 * - Does NOT write Gateway.
 * - Does NOT alter Raw Data / Team Data / incentives /
 *   current portal.
 * - Duplicate/ambiguous master names are NEVER guessed.
 ******************************************************/


const V2_CANDIDATE_MATCH_PREVIEW_CONFIG =
  Object.freeze({

    VERSION:
      "V2-CANDIDATE-MATCH-PREVIEW-1.1.0",

    // A very strict fuzzy result may be considered a
    // SAFE_FUZZY_PREVIEW candidate, but this preview
    // still does not apply it.
    SAFE_FUZZY_MIN_SCORE:
      96,

    SAFE_FUZZY_MIN_MARGIN:
      5,

    // Lower-confidence fuzzy matches remain review-only.
    REVIEW_FUZZY_MIN_SCORE:
      88,

    // Limit log size.
    EXAMPLE_LIMIT_PER_STATUS:
      20

  });


/******************************************************
 * PUBLIC: READ-ONLY CANDIDATE MATCHING PREVIEW
 ******************************************************/
function V2_previewGatewayCandidateMatching(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  if(!candidates.length){
    throw new Error(
      "V2_CANDIDATE_MATCH_MASTER_EMPTY"
    );
  }

  if(!gateway.length){
    throw new Error(
      "V2_CANDIDATE_MATCH_GATEWAY_EMPTY"
    );
  }

  const masterIndex =
    V2CandidateMatch_buildMasterIndex_(
      candidates
    );

  const variantIndex =
    V2CandidateMatch_buildGatewayVariantIndex_(
      gateway
    );

  const variantKeys =
    Object.keys(
      variantIndex
    );

  const variants = [];

  variantKeys.forEach(
    function(key){

      const variant =
        variantIndex[key];

      const match =
        V2CandidateMatch_matchVariant_(
          variant,
          masterIndex
        );

      variants.push(
        Object.assign(
          {},
          variant,
          match
        )
      );

    }
  );

  variants.sort(
    function(a,b){

      if(
        b.gatewayRecordCount !==
        a.gatewayRecordCount
      ){
        return (
          b.gatewayRecordCount -
          a.gatewayRecordCount
        );
      }

      return String(
        a.candidateRaw || ""
      ).localeCompare(
        String(
          b.candidateRaw || ""
        )
      );

    }
  );

  const statusCountsByVariant = {};
  const statusCountsByGatewayRecord = {};
  const examplesByStatus = {};

  variants.forEach(
    function(item){

      const status =
        item.matchStatus;

      statusCountsByVariant[status] =
        (
          statusCountsByVariant[status] ||
          0
        ) + 1;

      statusCountsByGatewayRecord[status] =
        (
          statusCountsByGatewayRecord[status] ||
          0
        ) +
        item.gatewayRecordCount;

      if(!examplesByStatus[status]){
        examplesByStatus[status] = [];
      }

      if(
        examplesByStatus[status].length <
        V2_CANDIDATE_MATCH_PREVIEW_CONFIG
          .EXAMPLE_LIMIT_PER_STATUS
      ){

        examplesByStatus[status].push({
          candidateRaw:
            item.candidateRaw,

          normalizedCandidate:
            item.normalizedCandidate,

          gatewayRecordCount:
            item.gatewayRecordCount,

          proposedCandidateId:
            item.proposedCandidateId,

          proposedOfficialName:
            item.proposedOfficialName,

          score:
            item.score,

          secondBestScore:
            item.secondBestScore,

          margin:
            item.margin,

          reason:
            item.reason,

          conflictingCandidateIds:
            item.conflictingCandidateIds
        });

      }

    }
  );

  const masterDuplicateNormalizedGroups =
    masterIndex
      .duplicateNormalizedGroups
      .map(
        function(group){

          return {
            normalizedName:
              group.normalizedName,
            count:
              group.records.length,
            candidateIds:
              group.records.map(
                function(row){
                  return row.candidateId;
                }
              ),
            officialNames:
              group.records.map(
                function(row){
                  return row.officialName;
                }
              ),
            emails:
              group.records.map(
                function(row){
                  return row.email;
                }
              )
          };

        }
      );

  const exactAutoGatewayRecords =
    statusCountsByGatewayRecord[
      "AUTO_EXACT_NORMALIZED"
    ] || 0;

  const safeFuzzyGatewayRecords =
    statusCountsByGatewayRecord[
      "SAFE_FUZZY_PREVIEW"
    ] || 0;

  const ambiguousGatewayRecords =
    statusCountsByGatewayRecord[
      "AMBIGUOUS_MASTER_NAME"
    ] || 0;

  const reviewFuzzyGatewayRecords =
    statusCountsByGatewayRecord[
      "REVIEW_FUZZY"
    ] || 0;

  const unmatchedGatewayRecords =
    statusCountsByGatewayRecord[
      "UNMATCHED"
    ] || 0;

  const result = {

    ok:
      true,

    mode:
      "READ_ONLY",

    version:
      V2_CANDIDATE_MATCH_PREVIEW_CONFIG
        .VERSION,

    counts: {

      candidateMasterRows:
        candidates.length,

      candidateMasterNormalizedNames:
        masterIndex
          .distinctNormalizedNameCount,

      duplicateNormalizedMasterGroups:
        masterIndex
          .duplicateNormalizedGroups
          .length,

      gatewayRows:
        gateway.length,

      gatewayCandidateVariants:
        variants.length,

      exactAutoGatewayRecords:
        exactAutoGatewayRecords,

      safeFuzzyPreviewGatewayRecords:
        safeFuzzyGatewayRecords,

      ambiguousGatewayRecords:
        ambiguousGatewayRecords,

      reviewFuzzyGatewayRecords:
        reviewFuzzyGatewayRecords,

      unmatchedGatewayRecords:
        unmatchedGatewayRecords,

      accountedGatewayRecords:
        (
          exactAutoGatewayRecords +
          safeFuzzyGatewayRecords +
          ambiguousGatewayRecords +
          reviewFuzzyGatewayRecords +
          unmatchedGatewayRecords
        )

    },

    statusCountsByVariant:
      statusCountsByVariant,

    statusCountsByGatewayRecord:
      statusCountsByGatewayRecord,

    duplicateNormalizedMasterGroups:
      masterDuplicateNormalizedGroups,

    examplesByStatus:
      examplesByStatus

  };

  Logger.log(
    "========== V2 GATEWAY CANDIDATE MATCH PREVIEW =========="
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
 * PRIVATE: MASTER INDEX
 ******************************************************/
function V2CandidateMatch_buildMasterIndex_(
  candidates
){

  const byNormalizedName = {};
  const normalizedNames = [];

  candidates.forEach(
    function(row){

      const candidateId =
        String(
          row["Candidate ID"] || ""
        ).trim();

      const officialName =
        String(
          row["Official Candidate Name"] || ""
        ).trim();

      const email =
        String(
          row["Email"] || ""
        ).trim();

      const normalized =
        V2CandidateMatch_normalizeName_(
          officialName
        );

      if(
        !candidateId ||
        !officialName ||
        !normalized
      ){
        return;
      }

      if(!byNormalizedName[normalized]){
        byNormalizedName[normalized] = [];
        normalizedNames.push(
          normalized
        );
      }

      byNormalizedName[normalized].push({
        candidateId:
          candidateId,
        officialName:
          officialName,
        email:
          email,
        normalizedName:
          normalized
      });

    }
  );

  const duplicateNormalizedGroups =
    normalizedNames
      .filter(
        function(name){
          return (
            byNormalizedName[name]
              .length > 1
          );
        }
      )
      .map(
        function(name){
          return {
            normalizedName:
              name,
            records:
              byNormalizedName[name]
          };
        }
      );

  const uniqueNormalizedNames =
    normalizedNames
      .filter(
        function(name){
          return (
            byNormalizedName[name]
              .length === 1
          );
        }
      );

  const buckets = {};

  uniqueNormalizedNames.forEach(
    function(name){

      const bucketKeys =
        V2CandidateMatch_bucketKeys_(
          name
        );

      bucketKeys.forEach(
        function(bucketKey){

          if(!buckets[bucketKey]){
            buckets[bucketKey] = [];
          }

          buckets[bucketKey].push(
            name
          );

        }
      );

    }
  );

  return {

    byNormalizedName:
      byNormalizedName,

    normalizedNames:
      normalizedNames,

    uniqueNormalizedNames:
      uniqueNormalizedNames,

    duplicateNormalizedGroups:
      duplicateNormalizedGroups,

    distinctNormalizedNameCount:
      normalizedNames.length,

    buckets:
      buckets

  };

}


/******************************************************
 * PRIVATE: GATEWAY VARIANT INDEX
 *
 * Matching is calculated once per normalized Candidate Raw
 * variant, then record counts are rolled up.
 ******************************************************/
function V2CandidateMatch_buildGatewayVariantIndex_(
  gateway
){

  const index = {};

  gateway.forEach(
    function(row){

      const raw =
        String(
          row["Candidate Raw"] || ""
        ).trim();

      const normalized =
        V2CandidateMatch_normalizeName_(
          raw
        );

      const key =
        normalized ||
        "__BLANK__";

      if(!index[key]){

        index[key] = {
          candidateRaw:
            raw,
          normalizedCandidate:
            normalized,
          gatewayRecordCount:
            0
        };

      }

      index[key]
        .gatewayRecordCount++;

    }
  );

  return index;

}


/******************************************************
 * PRIVATE: MATCH ONE GATEWAY CANDIDATE VARIANT
 ******************************************************/
function V2CandidateMatch_matchVariant_(
  variant,
  masterIndex
){

  const normalized =
    variant.normalizedCandidate;

  if(!normalized){

    return {
      matchStatus:
        "UNMATCHED",
      proposedCandidateId:
        "",
      proposedOfficialName:
        "",
      bestCandidateId:
        "",
      bestOfficialName:
        "",
      score:
        0,
      secondBestScore:
        0,
      margin:
        0,
      reason:
        "CANDIDATE_RAW_EMPTY_AFTER_NORMALIZATION",
      conflictingCandidateIds:
        []
    };

  }

  //--------------------------------------------------
  // 1) Exact normalized match
  //--------------------------------------------------

  const exact =
    masterIndex
      .byNormalizedName[
        normalized
      ] || [];

  if(exact.length === 1){

    return {
      matchStatus:
        "AUTO_EXACT_NORMALIZED",
      proposedCandidateId:
        exact[0]
          .candidateId,
      proposedOfficialName:
        exact[0]
          .officialName,
      bestCandidateId:
        exact[0]
          .candidateId,
      bestOfficialName:
        exact[0]
          .officialName,
      score:
        100,
      secondBestScore:
        0,
      margin:
        100,
      reason:
        "UNIQUE_NORMALIZED_NAME_MATCH",
      conflictingCandidateIds:
        []
    };

  }

  if(exact.length > 1){

    return {
      matchStatus:
        "AMBIGUOUS_MASTER_NAME",
      proposedCandidateId:
        "",
      proposedOfficialName:
        "",
      bestCandidateId:
        "",
      bestOfficialName:
        "",
      score:
        100,
      secondBestScore:
        100,
      margin:
        0,
      reason:
        "NORMALIZED_NAME_MATCHES_MULTIPLE_CANDIDATE_IDS",
      conflictingCandidateIds:
        exact.map(
          function(row){
            return row.candidateId;
          }
        )
    };

  }

  //--------------------------------------------------
  // 2) Fuzzy preview over unique master names only.
  // Duplicate master names are deliberately excluded
  // from fuzzy auto-candidate selection.
  //--------------------------------------------------

  const pool =
    V2CandidateMatch_candidatePool_(
      normalized,
      masterIndex
    );

  let best = null;
  let second = null;

  pool.forEach(
    function(masterName){

      const score =
        V2CandidateMatch_similarityScore_(
          normalized,
          masterName
        );

      const candidate =
        masterIndex
          .byNormalizedName[
            masterName
          ][0];

      const item = {
        normalizedName:
          masterName,
        score:
          score,
        candidateId:
          candidate.candidateId,
        officialName:
          candidate.officialName
      };

      if(
        !best ||
        score > best.score
      ){

        second =
          best;

        best =
          item;

      }else if(
        !second ||
        score > second.score
      ){

        second =
          item;

      }

    }
  );

  if(!best){

    return {
      matchStatus:
        "UNMATCHED",
      proposedCandidateId:
        "",
      proposedOfficialName:
        "",
      bestCandidateId:
        "",
      bestOfficialName:
        "",
      score:
        0,
      secondBestScore:
        0,
      margin:
        0,
      reason:
        "NO_MASTER_CANDIDATE_POOL",
      conflictingCandidateIds:
        []
    };

  }

  const bestScore =
    best.score;

  const secondBestScore =
    second
      ? second.score
      : 0;

  const margin =
    bestScore -
    secondBestScore;

  if(
    bestScore >=
      V2_CANDIDATE_MATCH_PREVIEW_CONFIG
        .SAFE_FUZZY_MIN_SCORE &&
    margin >=
      V2_CANDIDATE_MATCH_PREVIEW_CONFIG
        .SAFE_FUZZY_MIN_MARGIN
  ){

    return {
      matchStatus:
        "SAFE_FUZZY_PREVIEW",
      proposedCandidateId:
        best.candidateId,
      proposedOfficialName:
        best.officialName,
      bestCandidateId:
        best.candidateId,
      bestOfficialName:
        best.officialName,
      score:
        bestScore,
      secondBestScore:
        secondBestScore,
      margin:
        margin,
      reason:
        "STRICT_UNIQUE_FUZZY_CANDIDATE_PREVIEW",
      conflictingCandidateIds:
        []
    };

  }

  if(
    bestScore >=
    V2_CANDIDATE_MATCH_PREVIEW_CONFIG
      .REVIEW_FUZZY_MIN_SCORE
  ){

    return {
      matchStatus:
        "REVIEW_FUZZY",
      proposedCandidateId:
        best.candidateId,
      proposedOfficialName:
        best.officialName,
      bestCandidateId:
        best.candidateId,
      bestOfficialName:
        best.officialName,
      score:
        bestScore,
      secondBestScore:
        secondBestScore,
      margin:
        margin,
      reason:
        (
          margin <
          V2_CANDIDATE_MATCH_PREVIEW_CONFIG
            .SAFE_FUZZY_MIN_MARGIN
        )
          ? "FUZZY_MARGIN_TOO_SMALL"
          : "FUZZY_SCORE_BELOW_SAFE_THRESHOLD",
      conflictingCandidateIds:
        []
    };

  }

  return {
    matchStatus:
      "UNMATCHED",
    proposedCandidateId:
      "",
    proposedOfficialName:
      "",
    bestCandidateId:
      best.candidateId,
    bestOfficialName:
      best.officialName,
    score:
      bestScore,
    secondBestScore:
      secondBestScore,
    margin:
      margin,
    reason:
      "NO_SAFE_MASTER_MATCH",
    conflictingCandidateIds:
      []
  };

}


/******************************************************
 * PRIVATE: FUZZY CANDIDATE POOL
 *
 * Uses several deterministic blocking keys to avoid
 * comparing every Gateway name with all 1,074 master
 * rows while still allowing minor typos/order changes.
 ******************************************************/
function V2CandidateMatch_candidatePool_(
  normalized,
  masterIndex
){

  const keys =
    V2CandidateMatch_bucketKeys_(
      normalized
    );

  const seen = {};
  const pool = [];

  keys.forEach(
    function(key){

      const items =
        masterIndex
          .buckets[key] || [];

      items.forEach(
        function(name){

          if(seen[name])
            return;

          seen[name] =
            true;

          pool.push(
            name
          );

        }
      );

    }
  );

  //--------------------------------------------------
  // Safe fallback if blocking yields nothing.
  //--------------------------------------------------

  if(pool.length === 0){

    return masterIndex
      .uniqueNormalizedNames
      .slice();

  }

  return pool;

}


/******************************************************
 * PRIVATE: BLOCKING KEYS
 ******************************************************/
function V2CandidateMatch_bucketKeys_(
  normalized
){

  const tokens =
    normalized
      .split(" ")
      .filter(Boolean);

  const compact =
    normalized
      .replace(
        /\s+/g,
        ""
      );

  const keys = {};

  if(tokens.length){

    keys[
      "FIRST:" +
      tokens[0]
    ] = true;

    keys[
      "LAST:" +
      tokens[
        tokens.length - 1
      ]
    ] = true;

    const initials =
      tokens
        .map(
          function(token){
            return token.charAt(0);
          }
        )
        .join("");

    if(initials){
      keys[
        "INIT:" +
        initials
      ] = true;
    }

  }

  if(compact){

    keys[
      "C1:" +
      compact.charAt(0)
    ] = true;

    if(compact.length >= 2){
      keys[
        "C2:" +
        compact.substring(
          0,
          2
        )
      ] = true;
    }

  }

  keys[
    "LEN:" +
    Math.round(
      compact.length / 3
    )
  ] = true;

  return Object.keys(
    keys
  );

}


/******************************************************
 * PRIVATE: SIMILARITY SCORE 0..100
 *
 * Uses:
 * - normalized character similarity
 * - token-sorted character similarity
 * - token overlap
 *
 * No profile fields are used to "correct" official names.
 ******************************************************/
function V2CandidateMatch_similarityScore_(
  left,
  right
){

  if(left === right)
    return 100;

  const charScore =
    V2CandidateMatch_levenshteinRatio_(
      left,
      right
    );

  const leftSorted =
    left
      .split(" ")
      .filter(Boolean)
      .sort()
      .join(" ");

  const rightSorted =
    right
      .split(" ")
      .filter(Boolean)
      .sort()
      .join(" ");

  const sortedScore =
    V2CandidateMatch_levenshteinRatio_(
      leftSorted,
      rightSorted
    );

  const tokenScore =
    V2CandidateMatch_tokenOverlap_(
      left,
      right
    );

  const blended =
    (
      Math.max(
        charScore,
        sortedScore
      ) * 0.80
    ) +
    (
      tokenScore * 0.20
    );

  return Math.round(
    blended * 100
  ) / 100;

}


/******************************************************
 * PRIVATE: LEVENSHTEIN RATIO 0..100
 ******************************************************/
function V2CandidateMatch_levenshteinRatio_(
  left,
  right
){

  if(left === right)
    return 100;

  if(!left || !right)
    return 0;

  const distance =
    V2CandidateMatch_levenshteinDistance_(
      left,
      right
    );

  const maxLength =
    Math.max(
      left.length,
      right.length
    );

  return (
    (
      1 -
      (
        distance /
        maxLength
      )
    ) *
    100
  );

}


/******************************************************
 * PRIVATE: LEVENSHTEIN DISTANCE
 ******************************************************/
function V2CandidateMatch_levenshteinDistance_(
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

  if(a === b)
    return 0;

  if(!a.length)
    return b.length;

  if(!b.length)
    return a.length;

  let previous =
    new Array(
      b.length + 1
    );

  let current =
    new Array(
      b.length + 1
    );

  for(
    let j = 0;
    j <= b.length;
    j++
  ){
    previous[j] = j;
  }

  for(
    let i = 1;
    i <= a.length;
    i++
  ){

    current[0] = i;

    for(
      let j = 1;
      j <= b.length;
      j++
    ){

      const cost =
        a.charAt(
          i - 1
        ) ===
        b.charAt(
          j - 1
        )
          ? 0
          : 1;

      current[j] =
        Math.min(
          current[
            j - 1
          ] + 1,
          previous[j] + 1,
          previous[
            j - 1
          ] + cost
        );

    }

    const temp =
      previous;

    previous =
      current;

    current =
      temp;

  }

  return previous[
    b.length
  ];

}


/******************************************************
 * PRIVATE: TOKEN OVERLAP 0..100
 ******************************************************/
function V2CandidateMatch_tokenOverlap_(
  left,
  right
){

  const a =
    V2CandidateMatch_uniqueTokens_(
      left
    );

  const b =
    V2CandidateMatch_uniqueTokens_(
      right
    );

  if(
    a.length === 0 ||
    b.length === 0
  ){
    return 0;
  }

  const bMap = {};

  b.forEach(
    function(token){
      bMap[token] = true;
    }
  );

  let intersection = 0;

  a.forEach(
    function(token){

      if(bMap[token]){
        intersection++;
      }

    }
  );

  const union =
    a.length +
    b.length -
    intersection;

  if(union <= 0)
    return 0;

  return (
    intersection /
    union
  ) * 100;

}


/******************************************************
 * PRIVATE: UNIQUE TOKENS
 ******************************************************/
function V2CandidateMatch_uniqueTokens_(
  value
){

  const seen = {};
  const result = [];

  String(
    value || ""
  )
    .split(" ")
    .filter(Boolean)
    .forEach(
      function(token){

        if(seen[token])
          return;

        seen[token] =
          true;

        result.push(
          token
        );

      }
    );

  return result;

}


/******************************************************
 * PRIVATE: NAME NORMALIZATION
 *
 * Handles case / spacing / punctuation differences.
 * Does NOT invent or rewrite an official candidate name.
 ******************************************************/
function V2CandidateMatch_normalizeName_(
  value
){

  let text =
    String(
      value || ""
    );

  try{
    text =
      text.normalize(
        "NFKD"
      );
  }catch(error){
    // Older runtime fallback: keep original text.
  }

  return text
    .toLowerCase()
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
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


/******************************************************
 * PUBLIC: COMPACT NON-EXACT MATCH REVIEW
 *
 * READ-ONLY.
 *
 * Logs:
 * - every SAFE_FUZZY_PREVIEW variant
 * - every REVIEW_FUZZY variant
 * - every AMBIGUOUS_MASTER_NAME variant
 * - top 40 UNMATCHED variants by Gateway record count
 *
 * This avoids Apps Script truncating the useful part of
 * the full preview log.
 ******************************************************/
function V2_logCompactCandidateMatchReview(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const masterIndex =
    V2CandidateMatch_buildMasterIndex_(
      candidates
    );

  const variantIndex =
    V2CandidateMatch_buildGatewayVariantIndex_(
      gateway
    );

  const variants =
    Object.keys(
      variantIndex
    )
      .map(
        function(key){

          const variant =
            variantIndex[key];

          const match =
            V2CandidateMatch_matchVariant_(
              variant,
              masterIndex
            );

          return Object.assign(
            {},
            variant,
            match
          );

        }
      )
      .sort(
        function(a,b){

          if(
            b.gatewayRecordCount !==
            a.gatewayRecordCount
          ){
            return (
              b.gatewayRecordCount -
              a.gatewayRecordCount
            );
          }

          return String(
            a.candidateRaw || ""
          ).localeCompare(
            String(
              b.candidateRaw || ""
            )
          );

        }
      );

  const sections = [
    {
      status:
        "SAFE_FUZZY_PREVIEW",
      limit:
        1000
    },
    {
      status:
        "REVIEW_FUZZY",
      limit:
        1000
    },
    {
      status:
        "AMBIGUOUS_MASTER_NAME",
      limit:
        1000
    },
    {
      status:
        "UNMATCHED",
      limit:
        40
    }
  ];

  const counts = {};

  variants.forEach(
    function(item){

      counts[
        item.matchStatus
      ] =
        (
          counts[
            item.matchStatus
          ] || 0
        ) +
        item.gatewayRecordCount;

    }
  );

  Logger.log(
    "========== V2 CANDIDATE MATCH COMPACT REVIEW =========="
  );

  Logger.log(
    JSON.stringify({
      ok:
        true,
      mode:
        "READ_ONLY",
      version:
        V2_CANDIDATE_MATCH_PREVIEW_CONFIG
          .VERSION,
      gatewayRows:
        gateway.length,
      gatewayVariants:
        variants.length,
      gatewayRecordCountsByStatus:
        counts
    })
  );

  sections.forEach(
    function(section){

      const items =
        variants
          .filter(
            function(item){
              return (
                item.matchStatus ===
                section.status
              );
            }
          );

      Logger.log(
        "---- " +
        section.status +
        " | variants=" +
        items.length +
        " ----"
      );

      items
        .slice(
          0,
          section.limit
        )
        .forEach(
          function(item,index){

            Logger.log(
              [
                index + 1,
                "Raw=" +
                  item.candidateRaw,
                "Records=" +
                  item.gatewayRecordCount,
                "BestID=" +
                  (
                    item.bestCandidateId ||
                    item.proposedCandidateId ||
                    ""
                  ),
                "BestName=" +
                  (
                    item.bestOfficialName ||
                    item.proposedOfficialName ||
                    ""
                  ),
                "Score=" +
                  item.score,
                "Second=" +
                  item.secondBestScore,
                "Margin=" +
                  item.margin,
                "Reason=" +
                  item.reason,
                "Conflicts=" +
                  (
                    item.conflictingCandidateIds ||
                    []
                  ).join(",")
              ].join(
                " | "
              )
            );

          }
        );

      if(
        items.length >
        section.limit
      ){
        Logger.log(
          "... " +
          (
            items.length -
            section.limit
          ) +
          " more " +
          section.status +
          " variants not logged"
        );
      }

  });

  Logger.log(
    "======================================================="
  );

  return {
    ok:
      true,
    mode:
      "READ_ONLY",
    gatewayRows:
      gateway.length,
    gatewayVariants:
      variants.length,
    gatewayRecordCountsByStatus:
      counts
  };

}

