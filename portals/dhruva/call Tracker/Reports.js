/*************************************************
 *
 * REPORTS
 *
 *************************************************/


//-----------------------------------------------
// Generate Complete Report
//-----------------------------------------------

function generateSchedulerReport(scheduler){

    reportHeader();

    reportStatistics(scheduler);

    reportAssignments(scheduler);

    reportSupport(scheduler);

    reportUnassigned(scheduler);

}


//-----------------------------------------------
// Report Header
//-----------------------------------------------

function reportHeader(){

    Logger.log("==========================================");
    Logger.log(" INTERVIEW SCHEDULER REPORT ");
    Logger.log("==========================================");
    Logger.log(
        "Generated : " +
        Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "dd-MMM-yyyy HH:mm:ss"
        )
    );
    Logger.log("");

}


//-----------------------------------------------
// Statistics
//-----------------------------------------------

function reportStatistics(scheduler){

    Logger.log("----------- HANDLER LOAD -----------");

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

    Logger.log(
        "Total Interviews : " +
        scheduler.assignments.length
    );

    Logger.log(
        "Support Assigned : " +
        (scheduler.statistics["Support"] || 0)
    );

    Logger.log("");

}


//-----------------------------------------------
// Assignment List
//-----------------------------------------------

function reportAssignments(scheduler){

    Logger.log("----------- ASSIGNMENTS -----------");

    scheduler.assignments.forEach(function(assign){

        Logger.log(

            assign.handler +
            " --> " +
            assign.interview.candidate +
            " | " +
            assign.interview.interviewTime +
            " | " +
            assign.interview.duration +
            " mins"

        );

    });

    Logger.log("");

}


//-----------------------------------------------
// Support Calls
//-----------------------------------------------

function reportSupport(scheduler){

    Logger.log("----------- SUPPORT -----------");

    const support = scheduler.assignments.filter(function(a){

        return a.handler=="Support";

    });

    if(support.length==0){

        Logger.log("No Support Calls");

    }else{

        support.forEach(function(a){

            Logger.log(

                a.interview.candidate +
                " | " +
                a.interview.interviewTime

            );

        });

    }

    Logger.log("");

}


//-----------------------------------------------
// Unassigned Interviews
//-----------------------------------------------

function reportUnassigned(scheduler){

    Logger.log("----------- UNASSIGNED -----------");

    if(
        !scheduler.unassigned ||
        scheduler.unassigned.length==0
    ){

        Logger.log("None");

    }else{

        scheduler.unassigned.forEach(function(i){

            Logger.log(

                i.candidate +
                " | " +
                i.interviewTime

            );

        });

    }

    Logger.log("");

}
