/*************************************************
 *
 * UTILITIES
 *
 *************************************************/


//-----------------------------------------------
// Safe String
//-----------------------------------------------

function safeString(value){

    if(value===null || value===undefined)
        return "";

    return String(value).trim();

}


//-----------------------------------------------
// Normalize Text
//-----------------------------------------------

function normalizeText(text){

    return safeString(text)
        .replace(/\s+/g," ")
        .trim();

}


//-----------------------------------------------
// Case Insensitive Compare
//-----------------------------------------------

function equalsIgnoreCase(a,b){

    return safeString(a).toLowerCase() ==
           safeString(b).toLowerCase();

}


//-----------------------------------------------
// Contains Ignore Case
//-----------------------------------------------

function containsIgnoreCase(text,search){

    return safeString(text)
        .toLowerCase()
        .indexOf(
            safeString(search).toLowerCase()
        )!=-1;

}


//-----------------------------------------------
// Clone Object
//-----------------------------------------------

function cloneObject(obj){

    return JSON.parse(JSON.stringify(obj));

}


//-----------------------------------------------
// Minutes Since Midnight
//-----------------------------------------------

function timeToMinutes(time){

    if(!time)
        return 0;

    const m = time.match(/(\d{1,2})\:(\d{2})\s*(AM|PM)/i);

    if(!m)
        return 0;

    let hour = Number(m[1]);
    const mins = Number(m[2]);
    const ampm = m[3].toUpperCase();

    if(ampm=="PM" && hour!=12)
        hour+=12;

    if(ampm=="AM" && hour==12)
        hour=0;

    return hour*60+mins;

}


//-----------------------------------------------
// Minutes To Time
//-----------------------------------------------

function minutesToTime(mins){

    let h = Math.floor(mins/60);
    let m = mins%60;

    let ap = "AM";

    if(h>=12)
        ap="PM";

    if(h>12)
        h-=12;

    if(h==0)
        h=12;

    return h +
        ":" +
        ("0"+m).slice(-2) +
        " " +
        ap;

}


//-----------------------------------------------
// Sort Interviews
//-----------------------------------------------

function sortInterviewsByTime(interviews){

    return interviews.sort(function(a,b){

        return timeToMinutes(a.interviewTime) -
               timeToMinutes(b.interviewTime);

    });

}


//-----------------------------------------------
// Current Time
//-----------------------------------------------

function getCurrentTimestamp(){

    return Utilities.formatDate(

        new Date(),

        Session.getScriptTimeZone(),

        "yyyy-MM-dd HH:mm:ss"

    );

}


//-----------------------------------------------
// Logger
//-----------------------------------------------

function logHeader(title){

    Logger.log("====================================");
    Logger.log(title);
    Logger.log("====================================");

}


//-----------------------------------------------
// Pad Number
//-----------------------------------------------

function pad(value){

    return ("0"+value).slice(-2);

}


//-----------------------------------------------
// Unique Array
//-----------------------------------------------

function uniqueArray(arr){

    return [...new Set(arr)];

}


//-----------------------------------------------
// Is Empty
//-----------------------------------------------

function isEmpty(value){

    return value===null ||
           value===undefined ||
           String(value).trim()=="";

}
