/*************************************************
 *
 * MANUAL OVERRIDE
 *
 *************************************************/


//-----------------------------------------------
// Apply Manual Overrides
//-----------------------------------------------

function applyManualOverrides(scheduler){

    const overrides = getManualOverrides();

    overrides.forEach(function(override){

        scheduler.assignments.forEach(function(assign){

            if(assign.interview.row != override.row)
                return;

            //------------------------------------
            // Change Handler
            //------------------------------------

            assign.handler = override.handler;

            //------------------------------------
            // Lock Assignment
            //------------------------------------

            assign.locked = true;

            assign.reason = "Manual Override";

        });

    });

}


//-----------------------------------------------
// Read Manual Overrides
//-----------------------------------------------

function getManualOverrides(){

    const sheet = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("ManualOverride");

    if(!sheet)
        return [];

    const values = sheet
        .getDataRange()
        .getValues();

    const list = [];

    for(let i=1;i<values.length;i++){

        const row = values[i];

        if(!row[0] || !row[1])
            continue;

        list.push({

            row:Number(row[0]),

            handler:String(row[1]).trim()

        });

    }

    return list;

}


//-----------------------------------------------
// Lock Assignment
//-----------------------------------------------

function lockAssignment(assignment){

    assignment.locked = true;

}


//-----------------------------------------------
// Unlock Assignment
//-----------------------------------------------

function unlockAssignment(assignment){

    assignment.locked = false;

}


//-----------------------------------------------
// Is Locked?
//-----------------------------------------------

function isAssignmentLocked(assignment){

    return assignment.locked === true;

}
