function diagnoseHydSchedulerBridge(){

  const props =
    PropertiesService.getScriptProperties();

  const url =
    String(
      props.getProperty(
        "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_URL"
      ) || ""
    ).trim();

  const secret =
    String(
      props.getProperty(
        "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_SECRET"
      ) || ""
    ).trim();

  if(!url){
    throw new Error(
      "HYD_SCHEDULER_URL_NOT_CONFIGURED"
    );
  }

  if(!secret){
    throw new Error(
      "HYD_SCHEDULER_SECRET_NOT_CONFIGURED"
    );
  }

  const response =
    UrlFetchApp.fetch(
      url,
      {
        method: "post",
        contentType: "application/json",

        payload:
          JSON.stringify({
            secret: secret,
            command: "state",
            payload: {},
            requestId:
              Utilities.getUuid()
          }),

        muteHttpExceptions: true,
        followRedirects: true
      }
    );

  const text =
    response.getContentText();

  const result = {
    httpCode:
      response.getResponseCode(),

    contentType:
      String(
        response.getHeaders()["Content-Type"] ||
        response.getHeaders()["content-type"] ||
        ""
      ),

    responseLength:
      text.length,

    looksLikeJson:
      /^\s*[\{\[]/.test(text),

    responseStart:
      text.substring(0,500)
  };

  try{
    result.parsed =
      JSON.parse(text);
  }
  catch(error){
    result.parseError =
      error.message;
  }

  Logger.log(
    "========== HYD SCHEDULER BRIDGE DIAGNOSTIC =========="
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

function TEST_hydAvailableMonthsReadOnly(){

  return PTR_withExecutionTeamCode_(
    "HYD",
    function(){

      const loaded =
        PCO_loadCallDashboardFacts_("");

      const facts =
        loaded && Array.isArray(loaded.facts)
          ? loaded.facts
          : [];

      const monthMap = {};
      const dateMap = {};

      facts.forEach(function(item){

        const dateKey =
          String(item.dateKey || "").trim();

        if(/^\d{4}-\d{2}-\d{2}$/.test(dateKey)){

          dateMap[dateKey] = true;

          monthMap[
            dateKey.substring(0,7)
          ] = true;
        }

      });

      const result = {
        latestDateKey:
          loaded.latestDateKey || "",

        totalFacts:
          facts.length,

        callMonths:
          Object.keys(monthMap)
            .sort(),

        detectedDates:
          Object.keys(dateMap)
            .sort()
      };

      Logger.log(
        JSON.stringify(
          result,
          null,
          2
        )
      );

      return result;
    }
  );
}