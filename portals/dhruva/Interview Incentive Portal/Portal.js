/******************************************************
 * PORTAL.GS
 * Secure Portal - Phase 2
 ******************************************************/

function doGet(){

  return HtmlService
    .createTemplateFromFile(
      "Working Portal"
    )
    .evaluate()
    .setTitle(
      "Call Pilots Operations Portal"
    )
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1"
    );

}
