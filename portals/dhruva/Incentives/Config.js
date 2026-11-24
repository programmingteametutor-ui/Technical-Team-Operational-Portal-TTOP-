/******************************************************
 * CONFIG
 ******************************************************/

const CONFIG = {

  RAW_SHEET: "Raw Data",

  TEAM_SHEET: "Team Data",

  PROMOTION_HISTORY_SHEET: "Promotion History",

  TRACKER_SHEET: "Incentive Tracker",

  SUMMARY_SHEET: "Incentive Summary",

  POSSIBLE_MATCHES_SHEET: "Possible Matches",

  CLIENT_ALIAS_SHEET: "Client Alias",

  CANDIDATE_ALIAS_SHEET: "Candidate Alias"

};


/******************************************************
 * INCENTIVES
 ******************************************************/

const INCENTIVES = {

  FIRST_PROMOTION: 100,

  PROMOTION: 500,

  SELECTED: 2000

};


/******************************************************
 * HANDLERS TO IGNORE
 ******************************************************/

const IGNORE_HANDLERS = [

  "",

  "support",

  "cancelled",

  "canceled",

  "rescheduled"

];
/******************************************************
 * RECOVERY SETTINGS
 ******************************************************/
CONFIG.RECOVERY = {

  MIN_CONFIDENCE : 95,

  CANDIDATE_WEIGHT : 50,

  CLIENT_WEIGHT : 30,

  ROUND_WEIGHT : 10,

  DATE_WEIGHT : 10

};