function ADMIN_setHydIncentiveBridgeConfig(){

  const ui = SpreadsheetApp.getUi();

  const urlResponse = ui.prompt(
    "HYD Incentive Bridge URL",
    "Paste the HYD Incentive Backend - Private Web App /exec URL:",
    ui.ButtonSet.OK_CANCEL
  );

  if(urlResponse.getSelectedButton() !== ui.Button.OK){
    return;
  }

  const url = String(
    urlResponse.getResponseText() || ""
  ).trim();

  if(
    !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(url)
  ){
    ui.alert("Invalid Apps Script /exec URL.");
    return;
  }

  const secretResponse = ui.prompt(
    "HYD Incentive Bridge Secret",
    "Paste the secret created by setupPortalIncentiveBridgeSecret():",
    ui.ButtonSet.OK_CANCEL
  );

  if(secretResponse.getSelectedButton() !== ui.Button.OK){
    return;
  }

  const secret = String(
    secretResponse.getResponseText() || ""
  ).trim();

  if(secret.length < 60){
    ui.alert("The incentive bridge secret is too short.");
    return;
  }

  const props = PropertiesService.getScriptProperties();

  props.setProperties({
    "PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_URL": url,
    "PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_SECRET": secret
  }, false);

  ui.alert(
    "HYD Incentive Bridge configuration saved successfully."
  );
}
function ADMIN_testHydIncentiveBridgeReadOnly(){

  const props = PropertiesService.getScriptProperties();

  const url = String(
    props.getProperty(
      "PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_URL"
    ) || ""
  ).trim();

  const secret = String(
    props.getProperty(
      "PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_SECRET"
    ) || ""
  ).trim();

  const result = {
    urlConfigured: Boolean(url),
    secretConfigured: Boolean(secret),
    secretLength: secret.length,
    bridgeOk: false,
    bridgeError: "",
    service: "",
    privateTrackerAvailable: false
  };

  if(!url || !secret){
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  try{

    const response = UrlFetchApp.fetch(
      url,
      {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          secret: secret,
          command: "ping",
          payload: {},
          requestId: Utilities.getUuid()
        }),
        muteHttpExceptions: true,
        followRedirects: true
      }
    );

    const text = response.getContentText();

    let parsed = null;

    try{
      parsed = JSON.parse(text);
    }catch(error){
      result.bridgeError =
        "INCENTIVE_BRIDGE_BAD_RESPONSE";

      Logger.log(JSON.stringify(result, null, 2));
      return result;
    }

    if(parsed && parsed.ok === true){

      result.bridgeOk = true;

      const data = parsed.data || {};

      result.service =
        String(data.service || "");

      result.privateTrackerAvailable =
        data.privateTrackerAvailable === true;

    }else{

      result.bridgeError =
        parsed && parsed.error
          ? String(parsed.error)
          : "INCENTIVE_BRIDGE_REQUEST_FAILED";
    }

  }catch(error){

    result.bridgeError =
      String(
        error && error.message
          ? error.message
          : error
      );
  }

  Logger.log(JSON.stringify(result, null, 2));

  return result;
}