/******************************************************
 * PORTAL BUILD DIAGNOSTIC — READ ONLY
 * Version: IDENTITY-UI-DIAG-1.0.2
 *
 * Add this as a NEW Apps Script file in Interview Portal Control.
 * It does not write to any sheet or change any portal data.
 ******************************************************/
function PBD_testPortalBuildReadOnly(){

  let raw = "";
  let htmlReadMethod = "";

  try{
    const template = HtmlService.createTemplateFromFile("Working Portal");

    if(
      template &&
      typeof template.getRawContent === "function"
    ){
      raw = String(template.getRawContent() || "");
      htmlReadMethod = "getRawContent";
    }else if(
      template &&
      typeof template.getCode === "function"
    ){
      raw = String(template.getCode() || "");
      htmlReadMethod = "getCode";
    }
  }catch(error){
    raw = "";
    htmlReadMethod = "ERROR: " + String(error && error.message || error);
  }

  const serviceUrl =
    String(
      ScriptApp.getService().getUrl() || ""
    ).trim();

  const checks = {
    identityBuildMarker:
      raw.indexOf("Identity UI 1.0.2") !== -1,

    identityCellRenderer:
      raw.indexOf("function callIdentityCellHtml") !== -1,

    mapCandidateButton:
      raw.indexOf("Map Candidate") !== -1,

    changeCandidateButton:
      raw.indexOf("Change Candidate") !== -1,

    mapClientButton:
      raw.indexOf("Map / Add Client") !== -1,

    pendingOutcomeChangeUi:
      raw.indexOf("Change to ") !== -1 &&
      raw.indexOf("Awaiting Admin") !== -1,

    identityModal:
      raw.indexOf('id="identityMappingModal"') !== -1
  };

  const ok =
    Object.keys(checks).every(
      function(key){
        return checks[key] === true;
      }
    );

  const result = {
    ok: ok,
    mode: "READ_ONLY_PORTAL_BUILD_DIAGNOSTIC",
    diagnosticVersion: "IDENTITY-UI-DIAG-1.0.2",
    serviceUrl: serviceUrl,
    htmlReadMethod: htmlReadMethod,
    workingPortalChars: raw.length,
    checks: checks,
    nextAction:
      ok
        ? "Open exactly serviceUrl after deploying a NEW VERSION of the existing deployment. The Call Schedule badge must include Identity UI 1.0.2."
        : "Working Portal in this Apps Script project does not contain the complete Identity UI 1.0.2 code. Replace it before deployment."
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
