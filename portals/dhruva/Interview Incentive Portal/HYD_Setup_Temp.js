function configureHydPortalConnectionOnce() {

  const props = PropertiesService.getScriptProperties();

  props.setProperties({

    // HYD Incentive Tracker spreadsheet ID
    PORTAL_TEAM_HYD_OPERATIONS_ID:
      "1pDKLkZc4mCU7pcTWG-aYgovj7DJjF7C77292JyQ3zwU",

    // HYD Incentive Backend - Private spreadsheet ID
    PORTAL_TEAM_HYD_PRIVATE_ID:
      "1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w",

    // HYD Incentive Tracker Web App deployment
    PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_URL:
      "https://script.google.com/macros/s/AKfycbxq3iH5LQXZgJSmk5EyduewAjVsraUIwgAFQh4FRGzTuPe1H-df-IsA60_PowkFAIiG1w/exec",

    PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_SECRET:
      "AKfycbxq3iH5LQXZgJSmk5EyduewAjVsraUIwgAFQh4FRGzTuPe1H-df-IsA60_PowkFAIiG1w",

    // HYD Incentive Backend - Private Web App deployment
    PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_URL:
      "https://script.google.com/macros/s/AKfycbyHsMsTYAVf3nsKggpGvzuc_zoEVtLGWO_bkjAmLSes-WJFRcmpUqAPL7XhfXZPObcY/exec",

    PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_SECRET:
      "AKfycbyHsMsTYAVf3nsKggpGvzuc_zoEVtLGWO_bkjAmLSes-WJFRcmpUqAPL7XhfXZPObcY"

  }, false);

  Logger.log("HYD portal properties saved successfully.");
}
function updateHydSchedulerSecretOnce() {

  PropertiesService
    .getScriptProperties()
    .setProperty(
      "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_SECRET",
      "d2066ca0d7b7403bb7c229e9e9c973374bc6ddca2a9a4ba384dcab1a991c88f5e3851f4eb0e84fd2a6a9c9f747616c8f"
    );

  Logger.log("HYD scheduler bridge secret updated.");
}