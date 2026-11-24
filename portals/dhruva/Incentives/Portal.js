/******************************************************
 * PORTAL.GS
 * Phase 1 - Web App Entry Point
 *
 * Purpose:
 * - Serve the portal UI only.
 * - No incentive data is exposed here.
 ******************************************************/

function doGet(){

  return HtmlService
    .createTemplateFromFile("Working Portal")
    .evaluate()
    .setTitle("Interview Incentive Portal")
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1"
    );

}

