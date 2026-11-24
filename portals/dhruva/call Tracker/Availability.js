/*****************************************************************************************
 *
 * Availability Manager
 * Part 1
 * Version : 1.0
 *
 *****************************************************************************************/


/*****************************************************************************************
 *
 * BUILD EMPTY CALENDARS
 *
 *****************************************************************************************/
function createAvailabilityMap(){

    const availability = {};

    MAIN_HANDLERS.forEach(function(handler){

        availability[handler] = [];

    });

    availability[SPECIAL_HANDLER] = [];
    availability[SUPPORT_HANDLER] = [];

    return availability;

}


/*****************************************************************************************
 *
 * LOAD BUSY SLOT SHEET
 *
 *****************************************************************************************/
function getBusySlotSheet(){

    let ss =
        SpreadsheetApp.getActiveSpreadsheet();

    if(
        !ss &&
        typeof CSB_workbook_ === "function"
    ){
        ss = CSB_workbook_();
    }

    if(!ss)
        return null;

    return ss.getSheetByName(
        SHEETS.BUSY
    );

}


/*****************************************************************************************
 *
 * READ ALL BUSY SLOT ROWS
 *
 *****************************************************************************************/
function getBusySlotRows(){

    const sheet = getBusySlotSheet();

    if(!sheet)
        return [];

    const values = sheet.getDataRange().getValues();

    if(values.length <= 1)
        return [];

    return values.slice(1);

}


/*****************************************************************************************
 *
 * BUILD AVAILABILITY OBJECT
 *
 *****************************************************************************************/
function getAvailability(){

    const availability = createAvailabilityMap();

    loadBusySlots(availability);

    return availability;

}

/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testAvailabilityPart2(){

    const availability = getAvailability();

    Logger.log(

        JSON.stringify(

            availability,

            null,

            2

        )

    );

}
/*****************************************************************************************
 *
 * LOAD BUSY SLOTS
 *
 *****************************************************************************************/
function loadBusySlots(availability){

    const rows = getBusySlotRows();

    rows.forEach(function(row){

        const handler = String(row[0] || "").trim();

        if(handler === "")
            return;

        const slot = createBusySlot(
            row[1],
            Number(row[2] || 0)
        );

        if(!slot)
            return;

        if(!availability[handler])
            availability[handler] = [];

        availability[handler].push(slot);

    });

}
/*****************************************************************************************
 *
 * CONVERT TIME TO MINUTES
 *
 *****************************************************************************************/
function timeToMinutes(time){

    // Requirement 3: scheduler availability must use the same continuous
    // working-day timeline as Scheduler.gs so post-midnight calls follow PM calls.
    if(
        typeof schedulerTimelineMinutes_ === "function"
    ){
        return schedulerTimelineMinutes_(
            time
        );
    }

    // Defensive fallback for isolated tests.
    time = String(time || "").trim().toUpperCase();

    if(time=="")
        return -1;

    const m = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

    if(!m)
        return -1;

    let h = parseInt(m[1],10);
    const min = parseInt(m[2],10);
    const ap = m[3];

    if(ap=="PM" && h!=12)
        h+=12;

    if(ap=="AM" && h==12)
        h=0;

    let total = h*60+min;

    if(total < 360)
        total += 1440;

    return total;

}


/*****************************************************************************************
 *
 * CONVERT MINUTES TO TIME
 *
 *****************************************************************************************/
function minutesToTime(total){

    total=Math.round(total);

    // Display the clock portion even when the internal scheduling timeline
    // is on day 2 (for example 1440 => 12:00 AM).
    total =
        ((total % 1440) + 1440) % 1440;

    let h=Math.floor(total/60);
    let m=total%60;

    let ap="AM";

    if(h>=12)
        ap="PM";

    if(h==0)
        h=12;

    else if(h>12)
        h-=12;

    return h+
        ":"+
        ("0"+m).slice(-2)+
        " "+
        ap;

}


/*****************************************************************************************
 *
 * BUILD BUSY SLOT
 *
 *****************************************************************************************/
function createBusySlot(startTime,duration){

    const start=timeToMinutes(startTime);

    if(start<0)
        return null;

    duration =
        Number(duration || 0);

    if(duration <= 0)
        return null;

    return{

        start:start,

        end:start+duration,

        duration:duration

    };

}


/*****************************************************************************************
 *
 * ADD SLOT TO HANDLER
 *
 *****************************************************************************************/
function addBusySlot(

    availability,

    handler,

    startTime,

    duration,

    source,

    candidate

){

    if(!availability[handler])
        availability[handler]=[];

    const slot=createBusySlot(

        startTime,

        duration

    );

    if(!slot)
        return;

    slot.source=source||"";

    slot.candidate=candidate||"";

    availability[handler].push(slot);

}


/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testAvailabilityPart3(){

    const availability=createAvailabilityMap();

    addBusySlot(

        availability,

        "Dhruva",

        "8:30 PM",

        30,

        "Interview",

        "Ajay Mora"

    );

    Logger.log(

        JSON.stringify(

            availability,

            null,

            2

        )

    );

}
/*****************************************************************************************
 *
 * CHECK IF HANDLER IS AVAILABLE
 *
 *****************************************************************************************/
function isHandlerAvailable(

    availability,

    handler,

    startTime,

    duration

){

    if(
        typeof schedulerIsHandlerAvailable_ === "function"
    ){
        return schedulerIsHandlerAvailable_(
            availability,
            handler,
            startTime,
            duration
        );
    }

    if(!availability[handler])
        return true;

    const slot=createBusySlot(

        startTime,

        duration

    );

    if(!slot)
        return false;

    for(let i=0;i<availability[handler].length;i++){

        const busy=availability[handler][i];

        //-----------------------------------
        // Overlap
        //-----------------------------------

        if(

            slot.start < busy.end &&

            slot.end > busy.start

        ){

            return false;

        }

    }

    return true;

}


/*****************************************************************************************
 *
 * RESERVE HANDLER
 *
 *****************************************************************************************/
function reserveHandler(

    availability,

    handler,

    startTime,

    duration,

    source,

    candidate

){

    if(
        typeof schedulerReserveHandler_ === "function"
    ){
        return schedulerReserveHandler_(
            availability,
            handler,
            startTime,
            duration,
            source,
            candidate
        );
    }

    if(

        !isHandlerAvailable(

            availability,

            handler,

            startTime,

            duration

        )

    ){

        return false;

    }

    addBusySlot(

        availability,

        handler,

        startTime,

        duration,

        source,

        candidate

    );

    return true;

}


/*****************************************************************************************
 *
 * RELEASE HANDLER
 *
 *****************************************************************************************/
function releaseHandler(

    availability,

    handler,

    candidate

){

    if(!availability[handler])
        return;

    availability[handler]=availability[handler].filter(function(slot){

        return slot.candidate!=candidate;

    });

}


/*****************************************************************************************
 *
 * GET HANDLER BUSY SLOTS
 *
 *****************************************************************************************/
function getHandlerBusySlots(

    availability,

    handler

){

    if(!availability[handler])

        return [];

    return availability[handler];

}


/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testAvailabilityPart4(){

    const availability=createAvailabilityMap();

    reserveHandler(

        availability,

        "Dhruva",

        "8:30 PM",

        30,

        "Interview",

        "Ajay Mora"

    );

    Logger.log(

        isHandlerAvailable(

            availability,

            "Dhruva",

            "8:45 PM",

            30

        )

    );

    Logger.log(

        isHandlerAvailable(

            availability,

            "Dhruva",

            "9:05 PM",

            30

        )

    );

    Logger.log(

        JSON.stringify(

            availability,

            null,

            2

        )

    );

}
/*****************************************************************************************
 *
 * REMOVE RESERVATION
 *
 *****************************************************************************************/
function removeReservation(
    availability,
    handler,
    time,
    duration
){

    if(!availability[handler])
        return;

    const start = interviewMinutes({
        interviewTime: time
    });

    const end = start + duration;

    availability[handler] = availability[handler].filter(function(slot){

        return !(

            slot.start === start &&
            slot.end === end

        );

    });

}
