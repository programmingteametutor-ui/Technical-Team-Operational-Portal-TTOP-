/*********************************************************************
 * Interview Scheduler
 * Constants.gs
 * Version : 2.0
 *********************************************************************/

/************** SHEET NAMES ****************/

const SHEET_NAME = "InterviewBot 2026";
const SHEETS = {

  MAIN: "InterviewBot 2026",

  CONFIG: "Config",

  BUSY: "BusySlots",

  LOG: "Logs"

};


/************** HANDLERS ****************/

const HANDLERS = [

"Dhruva",
"Naresh",
"Bharat",
"Venkatesh",
"Avinash",
"Karthik",
"Gopal",
"Pradeep",
"Support"

];


/************** FIXED HANDLER KEYWORDS ****************/

const FIXED_HANDLER_KEYWORDS = {

  DHRUVA: "Dhruva",

  NARESH: "Naresh",

  BHARAT: "Bharat",

  VENKATESH: "Venkatesh",

  AVINASH: "Avinash",

  KARTHIK: "Karthik",

  GOPAL: "Gopal",

  PRADEEP: "Pradeep",

  SUPPORT: "Support"

};


/************** NIGHT ROTATION ****************/

const NIGHT_ROTATION = {

  MONDAY: ["Dhruva","Naresh"],

  TUESDAY: ["Dhruva","Naresh"],

  WEDNESDAY: ["Avinash","Bharat"],

  THURSDAY: ["Avinash","Bharat"],

  FRIDAY: ["Venkatesh","Karthik"]

};


/************** COLUMN NUMBERS ****************/

const COL = {

  SLNO : 1,

  MASTER : 2,

  MATCH_TEXT : 4,

  EXTRACTED : 5,

  HANDLER : 6

};


/************** DEFAULT SETTINGS ****************/

const SETTINGS = {

  DEFAULT_DURATION : 30,

  AFTER_HOUR : 2,

  WORK_START : 12,

  WORK_END : 4,

  MATCH_THRESHOLD : 70,

  SUPPORT_NAME : "Support",

  PRADEEP_NAME : "Pradeep"

};


/************** COLORS ****************/

const COLORS = {

  MATCH_FOUND : "#d9ead3",

  MATCH_NOT_FOUND : "#f4cccc",

  AUTO_ASSIGNED : "#d0e0e3",

  MANUAL : "#fff2cc",

  CONFLICT : "#ea9999"

};


/************** STATUS ****************/

const STATUS = {

  MATCHED : "MATCHED",

  NOT_FOUND : "NOT FOUND",

  ASSIGNED : "ASSIGNED",

  CONFLICT : "CONFLICT",

  MANUAL : "MANUAL"

};


/************** REGEX ****************/

const REGEX = {

  DATE :

  /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/,

  TIME :

  /(\d{1,2})([:.](\d{2}))?\s*(AM|PM)?/i,

  DURATION :

  /(\d+)\s*(MIN|MINS|MINUTES|HR|HRS|HOUR|HOURS)/i

};
