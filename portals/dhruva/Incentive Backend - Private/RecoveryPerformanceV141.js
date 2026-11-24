/******************************************************
 * RECOVERY PERFORMANCE HELPERS
 * v1.4.1
 *
 * Purpose:
 * - Preserve the v1.4 Team-first business rules.
 * - Avoid comparing every Team Data call against every
 *   Raw Data / Tracker record.
 * - Build candidate-keyed search pools once, then reuse.
 ******************************************************/

function REC_buildRawSearchIndexV141_(rawRecords){

  const index = {
    exact: {},
    buckets: {},
    all: rawRecords || []
  };

  (rawRecords || []).forEach(function(record){

    if(!record || !record.candidate)
      return;

    const exactKey = REC_exactPersonClientKeyV141_(
      record.candidate,
      record.client
    );

    if(exactKey){
      if(!index.exact[exactKey])
        index.exact[exactKey] = [];
      index.exact[exactKey].push(record);
    }

    REC_candidateBucketKeysV141_(record.candidate)
      .forEach(function(bucketKey){
        if(!index.buckets[bucketKey])
          index.buckets[bucketKey] = [];
        index.buckets[bucketKey].push(record);
      });
  });

  return index;
}


function REC_buildTrackerSearchIndexV141_(trackerRecords){

  const index = {
    exact: {},
    buckets: {},
    all: trackerRecords || []
  };

  (trackerRecords || []).forEach(function(record){

    if(!record || !record.candidate)
      return;

    const exactKey = REC_exactPersonClientKeyV141_(
      record.candidate,
      record.client
    );

    if(exactKey){
      if(!index.exact[exactKey])
        index.exact[exactKey] = [];
      index.exact[exactKey].push(record);
    }

    REC_candidateBucketKeysV141_(record.candidate)
      .forEach(function(bucketKey){
        if(!index.buckets[bucketKey])
          index.buckets[bucketKey] = [];
        index.buckets[bucketKey].push(record);
      });
  });

  return index;
}


function REC_getRawPoolV141_(teamRecord,index){
  return REC_getCandidatePoolV141_(
    teamRecord,
    index
  );
}


function REC_getTrackerPoolV141_(teamRecord,index){
  return REC_getCandidatePoolV141_(
    teamRecord,
    index
  );
}


function REC_getCandidatePoolV141_(teamRecord,index){

  if(!teamRecord || !index)
    return [];

  const output = [];

  const exactKey = REC_exactPersonClientKeyV141_(
    teamRecord.candidate,
    teamRecord.client
  );

  if(
    exactKey &&
    index.exact &&
    index.exact[exactKey]
  ){
    REC_addUniqueRecordsV141_(
      output,
      index.exact[exactKey]
    );
  }

  REC_candidateBucketKeysV141_(teamRecord.candidate)
    .forEach(function(bucketKey){
      if(
        index.buckets &&
        index.buckets[bucketKey]
      ){
        REC_addUniqueRecordsV141_(
          output,
          index.buckets[bucketKey]
        );
      }
    });

  // Very short / unusual candidate names are rare. For
  // those only, keep the old full-search safety fallback.
  if(
    output.length === 0 &&
    REC_normalizeCandidate(teamRecord.candidate)
      .replace(/\s+/g,"").length <= 3
  ){
    return (index.all || []).slice();
  }

  return output;
}


function REC_exactPersonClientKeyV141_(candidate,client){

  if(
    typeof makeSmartKey === "function"
  ){
    try{
      return String(
        makeSmartKey(candidate,client) || ""
      );
    }catch(error){}
  }

  return [
    REC_normalizeCandidate(candidate),
    REC_normalizeClient(client)
  ].join("||");
}


function REC_candidateBucketKeysV141_(candidate){

  const normalized =
    REC_normalizeCandidate(candidate);

  if(!normalized)
    return [];

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean);

  const compact =
    normalized.replace(/\s+/g,"");

  const keys = [];

  function add(value){
    value = String(value || "");
    if(value && keys.indexOf(value) === -1)
      keys.push(value);
  }

  if(compact.length >= 2)
    add("P2:" + compact.substring(0,2));

  if(compact.length >= 4)
    add("P4:" + compact.substring(0,4));

  if(tokens.length){
    const first = tokens[0];
    const last = tokens[tokens.length - 1];

    if(first.length >= 3)
      add("F3:" + first.substring(0,3));

    if(last.length >= 3)
      add("L3:" + last.substring(0,3));
  }

  if(tokens.length >= 2){
    add(
      "I:" +
      tokens.map(function(token){
        return token.charAt(0);
      }).join("")
    );
  }

  return keys;
}


function REC_addUniqueRecordsV141_(target,records){

  (records || []).forEach(function(record){
    if(target.indexOf(record) === -1)
      target.push(record);
  });
}

