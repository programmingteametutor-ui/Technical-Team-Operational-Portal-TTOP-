/******************************************************
 * PORTALHANDLERIDENTITY.GS
 * Canonical Handler identity resolver for the portal.
 *
 * Source of truth: central V2 Handler Master.
 * Matching rule: exact canonical name or exact configured alias.
 * No fuzzy/substring matching.
 ******************************************************/

var PHI_HANDLER_ALIAS_MAP_ = null;


function PHI_basicHandlerKey_(value){

  return String(value || "")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase();
}


function PHI_splitHandlerAliases_(value){

  return String(value || "")
    .replace(/\r?\n/g,",")
    .replace(/[;|]/g,",")
    .split(",")
    .map(function(value){
      return String(value || "")
        .replace(/\s+/g," ")
        .trim();
    })
    .filter(function(value){
      return !!value;
    });
}


function PHI_handlerAliasMap_(){

  if(PHI_HANDLER_ALIAS_MAP_){
    return PHI_HANDLER_ALIAS_MAP_;
  }

  const map = {};
  const canonicalKeys = {};

  try{

    const ss =
      typeof portalBackend_ === "function"
        ? portalBackend_()
        : (
            typeof PAC_backend_ === "function"
              ? PAC_backend_()
              : null
          );

    if(!ss){
      PHI_HANDLER_ALIAS_MAP_ = map;
      return map;
    }

    const sheet =
      ss.getSheetByName(
        "V2 Handler Master"
      );

    if(
      !sheet ||
      sheet.getLastRow() < 2
    ){
      PHI_HANDLER_ALIAS_MAP_ = map;
      return map;
    }

    const values =
      sheet.getDataRange().getDisplayValues();

    const headers =
      values[0].map(function(value){
        return PHI_basicHandlerKey_(value);
      });

    const nameCol =
      headers.indexOf("handler name");

    const aliasCol =
      headers.indexOf("aliases");

    if(nameCol < 0){
      PHI_HANDLER_ALIAS_MAP_ = map;
      return map;
    }

    // Pass 1: canonical names always resolve to themselves.
    for(let i = 1; i < values.length; i++){

      const canonicalName =
        String(values[i][nameCol] || "")
          .replace(/\s+/g," ")
          .trim();

      if(!canonicalName){
        continue;
      }

      const canonicalKey =
        PHI_basicHandlerKey_(canonicalName);

      canonicalKeys[canonicalKey] = true;
      map[canonicalKey] = canonicalKey;
    }

    // Pass 2: exact aliases point to the canonical name.
    if(aliasCol >= 0){

      for(let i = 1; i < values.length; i++){

        const canonicalName =
          String(values[i][nameCol] || "")
            .replace(/\s+/g," ")
            .trim();

        if(!canonicalName){
          continue;
        }

        const canonicalKey =
          PHI_basicHandlerKey_(canonicalName);

        const aliases =
          PHI_splitHandlerAliases_(
            values[i][aliasCol]
          );

        aliases.forEach(function(alias){

          const aliasKey =
            PHI_basicHandlerKey_(alias);

          if(
            !aliasKey ||
            aliasKey === canonicalKey
          ){
            return;
          }

          // Never allow an alias to hijack another person's
          // configured canonical Handler Name.
          if(
            canonicalKeys[aliasKey] &&
            aliasKey !== canonicalKey
          ){
            Logger.log(
              "HANDLER ALIAS COLLIDES WITH CANONICAL NAME -> " +
              alias +
              " | attempted=" +
              canonicalKey
            );
            return;
          }

          if(
            map[aliasKey] &&
            map[aliasKey] !== canonicalKey
          ){
            Logger.log(
              "AMBIGUOUS HANDLER ALIAS -> " +
              alias +
              " | existing=" +
              map[aliasKey] +
              " | attempted=" +
              canonicalKey
            );
            map[aliasKey] = null;
            return;
          }

          if(map[aliasKey] === null){
            return;
          }

          map[aliasKey] = canonicalKey;
        });
      }
    }

  }catch(error){

    Logger.log(
      "Handler alias map unavailable: " +
      (
        error && error.message
          ? error.message
          : String(error)
      )
    );

  }

  PHI_HANDLER_ALIAS_MAP_ = map;
  return map;
}


function PHI_handlerIdentityKey_(value){

  const rawKey =
    PHI_basicHandlerKey_(value);

  if(!rawKey){
    return "";
  }

  const map =
    PHI_handlerAliasMap_();

  return map[rawKey] || rawKey;
}


function PHI_clearHandlerIdentityCache_(){
  PHI_HANDLER_ALIAS_MAP_ = null;
}


function PHI_testHandlerAliasesReadOnly(){

  const samples = [
    "Vamshidhar Reddy",
    "Vamshidhar",
    "Vamshi"
  ];

  const result =
    samples.map(function(name){
      return {
        input: name,
        key: PHI_handlerIdentityKey_(name)
      };
    });

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


function PHI_testPortalIntegrationReadOnly(){

  const samples = [
    "Vamshidhar Reddy",
    "Vamshidhar",
    "Vamshi"
  ];

  const result =
    samples.map(function(name){
      return {
        input: name,
        PHI: PHI_handlerIdentityKey_(name),
        PC:
          typeof PC_handlerKey_ === "function"
            ? PC_handlerKey_(name)
            : "PC_handlerKey_ NOT FOUND",
        PO:
          typeof PO_handlerKey_ === "function"
            ? PO_handlerKey_(name)
            : "PO_handlerKey_ NOT FOUND"
      };
    });

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}
