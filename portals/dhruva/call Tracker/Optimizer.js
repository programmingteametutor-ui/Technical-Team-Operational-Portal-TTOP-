/*****************************************************************************************
 *
 * OPTIMIZER
 * Part 1
 *
 *****************************************************************************************/


/*****************************************************************************************
 *
 * CREATE OPTIMIZER OBJECT
 *
 *****************************************************************************************/
function createOptimizer(){

    const optimizer = {

        scheduler: createScheduler(),

        changes: [],

        skipped: []

    };

    assignInterviews(

        optimizer.scheduler

    );

    return optimizer;

}


/*****************************************************************************************
 *
 * GET HANDLER LOAD
 *
 *****************************************************************************************/
function getHandlerLoad(

    scheduler,

    handler

){

    let count = 0;

    scheduler.assignments.forEach(function(item){

        if(item.handler == handler)

            count++;

    });

    return count;

}


/*****************************************************************************************
 *
 * GET ALL HANDLER LOADS
 *
 *****************************************************************************************/
function getHandlerLoads(

    scheduler

){

    const loads = {};

    Object.keys(

        scheduler.availability

    ).forEach(function(handler){

        loads[handler] = getHandlerLoad(

            scheduler,

            handler

        );

    });

    return loads;

}


/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testOptimizerPart1(){

    const optimizer = createOptimizer();

    Logger.log(

        JSON.stringify(

            getHandlerLoads(

                optimizer.scheduler

            ),

            null,

            2

        )

    );

}
/*****************************************************************************************
 *
 * CALCULATE LOAD STATISTICS
 *
 *****************************************************************************************/
function getLoadStatistics(scheduler){

    const loads = getHandlerLoads(scheduler);

    const handlers = Object.keys(loads);

    let total = 0;

    handlers.forEach(function(handler){

        total += loads[handler];

    });

    const average = total / handlers.length;

    return {

        loads: loads,

        average: average,

        total: total

    };

}


/*****************************************************************************************
 *
 * FIND OVERLOADED HANDLERS
 *
 *****************************************************************************************/
function getOverloadedHandlers(scheduler){

    const stats = getLoadStatistics(scheduler);

    const result = [];

    Object.keys(stats.loads).forEach(function(handler){

        if(stats.loads[handler] > Math.ceil(stats.average)){

            result.push({

                handler: handler,

                load: stats.loads[handler]

            });

        }

    });

    return result;

}


/*****************************************************************************************
 *
 * FIND UNDERLOADED HANDLERS
 *
 *****************************************************************************************/
function getUnderloadedHandlers(scheduler){

    const stats = getLoadStatistics(scheduler);

    const result = [];

    Object.keys(stats.loads).forEach(function(handler){

        if(stats.loads[handler] < Math.floor(stats.average)){

            result.push({

                handler: handler,

                load: stats.loads[handler]

            });

        }

    });

    return result;

}


/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testOptimizerPart2(){

    const optimizer = createOptimizer();

    Logger.log("Average Load = " +

        getLoadStatistics(

            optimizer.scheduler

        ).average.toFixed(2)

    );

    Logger.log(

        JSON.stringify(

            getOverloadedHandlers(

                optimizer.scheduler

            ),

            null,

            2

        )

    );

    Logger.log(

        JSON.stringify(

            getUnderloadedHandlers(

                optimizer.scheduler

            ),

            null,

            2

        )

    );

}
/*****************************************************************************************
 *
 * MOVE ONE INTERVIEW
 *
 *****************************************************************************************/
function moveInterview(

    scheduler,

    assignment,

    newHandler

){

    //-----------------------------------
    // Remove old reservation
    //-----------------------------------

    removeReservation(

        scheduler.availability,

        assignment.handler,

        assignment.interview.interviewTime,

        assignment.interview.duration

    );

    //-----------------------------------
    // Reserve new handler
    //-----------------------------------

    reserveHandler(

        scheduler.availability,

        newHandler,

        assignment.interview.interviewTime,

        assignment.interview.duration,

        "Interview",

        assignment.interview.candidate

    );

    //-----------------------------------
    // Save change
    //-----------------------------------

    assignment.handler = newHandler;

}


/*****************************************************************************************
 *
 * BALANCE LOAD
 * Version 2.0
 *
 *****************************************************************************************/
function optimizeAssignments(scheduler){

    while(true){

        //---------------------------------------
        // Current loads
        //---------------------------------------

        const loads = getHandlerLoads(scheduler);

        //---------------------------------------
        // Highest & Lowest
        //---------------------------------------

        let highestHandler = null;
        let lowestHandler = null;

        let highestLoad = -1;
        let lowestLoad = 999999;

        Object.keys(loads).forEach(function(handler){

            if(loads[handler] > highestLoad){

                highestLoad = loads[handler];
                highestHandler = handler;

            }

            if(loads[handler] < lowestLoad){

                lowestLoad = loads[handler];
                lowestHandler = handler;

            }

        });

        //---------------------------------------
        // Already balanced
        //---------------------------------------

        if(highestLoad - lowestLoad <= 1)
            break;

        //---------------------------------------
        // Move one interview
        //---------------------------------------

        let moved = false;

        scheduler.assignments.forEach(function(assign){

            if(moved)
                return;

           if(assign.handler != highestHandler)
    return;
if(assign.locked)
    return;

//---------------------------------------
// Business Rules
//---------------------------------------

if(!canMoveInterview(assign))
    return;

// Never optimize to Support
if(lowestHandler == "Support")
    return;

// Never move normal calls to Pradeep
if(lowestHandler == "Pradeep")
    return;

           if(

    lowestHandler != "Support" &&
    lowestHandler != "Pradeep" &&

    isHandlerAvailable(

        scheduler.availability,

        lowestHandler,

        assign.interview.interviewTime,

        assign.interview.duration

    )

){
                moveInterview(

                    scheduler,

                    assign,

                    lowestHandler

                );

                optimizerLog(

                    highestHandler,

                    lowestHandler,

                    assign.interview.candidate

                );

                moved = true;

            }

        });

        //---------------------------------------
        // No move possible
        //---------------------------------------

        if(!moved)
            break;

    }

}
/*****************************************************************************************
 *
 * LOG
 *
 *****************************************************************************************/
function optimizerLog(

    from,

    to,

    candidate

){

    Logger.log(

        candidate+

        " : "+

        from+

        " -> "+

        to

    );

}


/*****************************************************************************************
 *
 * TEST
 *
 *****************************************************************************************/
function testOptimizerPart3(){

    const optimizer = createOptimizer();

    optimizeAssignments(

        optimizer.scheduler

    );

    Logger.log(

        JSON.stringify(

            getHandlerLoads(

                optimizer.scheduler

            ),

            null,

            2

        )

    );

}
function testOptimizerPart4(){

    const optimizer = createOptimizer();

    Logger.log("Before");
    Logger.log(
        JSON.stringify(
            getHandlerLoads(
                optimizer.scheduler
            ),
            null,
            2
        )
    );

    optimizeAssignments(
        optimizer.scheduler
    );

    Logger.log("After");
    Logger.log(
        JSON.stringify(
            getHandlerLoads(
                optimizer.scheduler
            ),
            null,
            2
        )
    );

}
/*****************************************
 *
 * CAN MOVE INTERVIEW?
 * BUSINESS RULES
 *
 *****************************************/

function canMoveInterview(assignment){

    //------------------------------------
    // Fixed handler
    //------------------------------------

    if(assignment.fixed)
        return false;

    //------------------------------------
    // Locked assignment
    //------------------------------------

    if(assignment.locked)
        return false;

    //------------------------------------
    // Fixed handler in interview
    //------------------------------------

    if(
        assignment.interview.fixedHandler &&
        assignment.interview.fixedHandler != ""
    ){
        return false;
    }

    //------------------------------------
    // Pradeep fixed calls
    //------------------------------------

    const raw =
        (assignment.interview.raw || "").toLowerCase();

    if(
        raw.indexOf("strictly pradeep")!=-1 ||
        raw.indexOf("strictly pradeep anna")!=-1 ||
        raw.indexOf("pradeep anna")!=-1
    ){
        return false;
    }

    return true;

}
/*****************************************
 *
 * LOAD DIFFERENCE
 *
 *****************************************/

function getLoadDifference(statistics){

    const values = [];

    Object.keys(statistics).forEach(function(handler){

        if(handler=="Support")
            return;

        values.push(statistics[handler]);

    });

    const highest = Math.max.apply(null, values);
    const lowest  = Math.min.apply(null, values);

    return highest - lowest;

}
/*************************************************
 *
 * OPTIMIZER REPORT
 *
 *************************************************/

function optimizerReport(scheduler){

    Logger.log("========================================");
    Logger.log("OPTIMIZER REPORT");
    Logger.log("========================================");

    Logger.log(
        "Total Interviews : " +
        scheduler.assignments.length
    );

    Logger.log("");

    Logger.log("Handler Loads");

    Object.keys(scheduler.statistics)
        .sort()
        .forEach(function(handler){

            Logger.log(
                handler +
                " : " +
                scheduler.statistics[handler]
            );

        });

    Logger.log("");

    let max = 0;
    let min = Number.MAX_SAFE_INTEGER;

    Object.keys(scheduler.statistics).forEach(function(handler){

        if(handler=="Support")
            return;

        max = Math.max(max,scheduler.statistics[handler]);
        min = Math.min(min,scheduler.statistics[handler]);

    });

    Logger.log(
        "Difference : " +
        (max-min)
    );

    Logger.log("");

    Logger.log(
        "Support Calls : " +
        (scheduler.statistics.Support || 0)
    );

    Logger.log("");

    Logger.log(
        "Fixed Interviews : " +
        scheduler.assignments.filter(function(a){

            return a.fixed;

        }).length
    );

    Logger.log("");

    Logger.log(
        "Auto Scheduled : " +
        scheduler.assignments.filter(function(a){

            return !a.fixed;

        }).length
    );

    Logger.log("========================================");

}