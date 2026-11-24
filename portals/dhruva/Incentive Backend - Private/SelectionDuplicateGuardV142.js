/******************************************************
 * SELECTION LOGICAL DUPLICATE GUARD v1.4.2
 ******************************************************/
function PB_buildLogicalSelectionKey_(row){
  if(!Array.isArray(row) || row.length<10) return "";

  const type=PB_normalizeText(row[0]);
  if(type!=="selection") return "";

  const candidate=PB_normalizeIdentity(row[1]);
  const client=PB_canonicalClient_(row[2]);
  const selectionDate=PB_normalizeDate(row[6]);

  if(!candidate || !client || !selectionDate) return "";

  // Same Candidate + Client + Selection Date = same Selection event.
  // From/To wording, handler, amount and status must not create a duplicate.
  return [type,candidate,client,selectionDate].join("||");
}

function testSelectionDuplicateProtectionV142(){
  const oldStyle=["Selection","Adiraju anusha","Mydentist","Final","Selected","","25-Aug-2026","Test Handler",2000,"Pending"];
  const newStyle=["Selection","Adiraju anusha","Mydentist","-","Selected","","25-Aug-2026","Test Handler",2000,"Pending"];
  const laterSelection=["Selection","Adiraju anusha","Mydentist","-","Selected","","26-Aug-2026","Test Handler",2000,"Pending"];

  const keyOld=PB_buildLogicalSelectionKey_(oldStyle);
  const keyNew=PB_buildLogicalSelectionKey_(newStyle);
  const keyLater=PB_buildLogicalSelectionKey_(laterSelection);

  const result={
    ok:Boolean(keyOld) && keyOld===keyNew && keyOld!==keyLater,
    sameEventDifferentFromBlocked:keyOld===keyNew,
    differentSelectionDateRemainsDistinct:keyOld!==keyLater,
    oldKey:keyOld,
    newKey:keyNew,
    laterKey:keyLater
  };

  Logger.log(JSON.stringify(result,null,2));
  if(!result.ok) throw new Error("SELECTION_DUPLICATE_GUARD_TEST_FAILED");
  return result;
}

function auditSelectionDuplicatesV142(){
  const tracker=getPrivateTrackerSheet();
  const lastRow=tracker.getLastRow();

  if(lastRow<=1){
    const empty={ok:true,selectionRows:0,duplicateGroups:0,duplicateRows:0,groups:[]};
    Logger.log(JSON.stringify(empty,null,2));
    return empty;
  }

  const values=tracker.getRange(2,1,lastRow-1,10).getValues();
  const groups={};
  let selectionRows=0;

  values.forEach(function(row,index){
    if(PB_normalizeText(row[0])!=="selection") return;
    selectionRows++;
    const key=PB_buildLogicalSelectionKey_(row);
    if(!key) return;
    if(!groups[key]) groups[key]=[];
    groups[key].push({
      sheetRow:index+2,
      candidate:row[1],
      client:row[2],
      fromRound:row[3],
      toRound:row[4],
      previousDate:row[5],
      selectionDate:row[6],
      handler:row[7],
      amount:row[8],
      status:row[9]
    });
  });

  const duplicates=[];
  let duplicateRows=0;
  Object.keys(groups).forEach(function(key){
    if(groups[key].length<=1) return;
    duplicateRows+=groups[key].length-1;
    duplicates.push({logicalKey:key,count:groups[key].length,rows:groups[key]});
  });

  const result={
    ok:true,
    selectionRows:selectionRows,
    duplicateGroups:duplicates.length,
    duplicateRows:duplicateRows,
    groups:duplicates
  };

  Logger.log("========== SELECTION DUPLICATE AUDIT v1.4.2 ==========");
  Logger.log(JSON.stringify(result,null,2));
  Logger.log("======================================================");
  return result;
}
/******************************************************
 * READ-ONLY COMPACT SELECTION DUPLICATE CLEANUP PREVIEW
 * Version 1.4.2
 *
 * TARGET:
 * Pradeep Anna Team -> Incentive Backend - Private
 *
 * Add this function to the existing:
 * SelectionDuplicateGuardV142.gs
 *
 * DOES NOT MODIFY OR DELETE Incentive Tracker rows.
 ******************************************************/
function previewSelectionDuplicateCleanupV142(){

  const tracker =
    getPrivateTrackerSheet();

  const lastRow =
    tracker.getLastRow();

  if(lastRow <= 1){
    Logger.log(
      "No Incentive Tracker data."
    );
    return {
      ok: true,
      duplicateGroups: 0,
      duplicateRows: 0,
      groups: []
    };
  }

  const values =
    tracker
      .getRange(
        2,
        1,
        lastRow - 1,
        10
      )
      .getValues();

  const groups = {};

  values.forEach(function(row,index){

    if(
      PB_normalizeText(row[0]) !==
      "selection"
    ){
      return;
    }

    const key =
      PB_buildLogicalSelectionKey_(row);

    if(!key)
      return;

    if(!groups[key])
      groups[key] = [];

    groups[key].push({
      sheetRow: index + 2,
      candidate: String(row[1] || ""),
      client: String(row[2] || ""),
      fromRound: String(row[3] || ""),
      selectionDate: PB_normalizeDate(row[6]),
      handler: String(row[7] || ""),
      amount: row[8],
      status: String(row[9] || "")
    });

  });

  const duplicateGroups = [];

  Object.keys(groups)
    .forEach(function(key){

      const rows =
        groups[key];

      if(rows.length <= 1)
        return;

      const handlerSet = {};
      const statusSet = {};

      rows.forEach(function(item){
        handlerSet[
          PB_normalizeText(item.handler)
        ] = true;

        statusSet[
          PB_normalizeText(item.status)
        ] = true;
      });

      //------------------------------------------------
      // READ-ONLY recommendation:
      // 1. Prefer Paid over Approved over Pending.
      // 2. Prefer richer From Round over "-".
      // 3. Prefer older/lower permanent tracker row.
      //------------------------------------------------
      function score(item){

        const status =
          PB_normalizeText(
            item.status
          );

        let statusScore = 0;

        if(status === "paid")
          statusScore = 300;
        else if(status === "approved")
          statusScore = 200;
        else if(status === "pending")
          statusScore = 100;

        const from =
          String(
            item.fromRound || ""
          ).trim();

        const fromScore =
          (
            from &&
            from !== "-"
          )
            ? 20
            : 0;

        // Lower row is older; small tiebreak advantage.
        const rowScore =
          Math.max(
            0,
            10 - (
              Number(item.sheetRow) /
              100000
            )
          );

        return (
          statusScore +
          fromScore +
          rowScore
        );
      }

      const ranked =
        rows
          .slice()
          .sort(function(a,b){

            const diff =
              score(b) -
              score(a);

            if(diff !== 0)
              return diff;

            return (
              Number(a.sheetRow) -
              Number(b.sheetRow)
            );
          });

      const keep =
        ranked[0];

      const remove =
        ranked
          .slice(1)
          .map(function(item){
            return item.sheetRow;
          });

      duplicateGroups.push({
        logicalKey: key,
        candidate: keep.candidate,
        client: keep.client,
        selectionDate: keep.selectionDate,
        keepRow: keep.sheetRow,
        removeRows: remove,
        count: rows.length,
        handlerConflict:
          Object.keys(handlerSet).length > 1,
        statusConflict:
          Object.keys(statusSet).length > 1,
        rows: rows
      });

    });

  duplicateGroups
    .sort(function(a,b){
      return (
        Number(a.keepRow) -
        Number(b.keepRow)
      );
    });

  let duplicateRows = 0;

  duplicateGroups.forEach(function(group){

    duplicateRows +=
      group.removeRows.length;

    Logger.log(
      "KEEP " +
      group.keepRow +
      " | REMOVE " +
      group.removeRows.join(",") +
      " | " +
      group.candidate +
      " | " +
      group.client +
      " | " +
      group.selectionDate +
      (
        group.handlerConflict
          ? " | HANDLER_CONFLICT"
          : ""
      ) +
      (
        group.statusConflict
          ? " | STATUS_CONFLICT"
          : ""
      )
    );

  });

  const result = {
    ok: true,
    duplicateGroups:
      duplicateGroups.length,
    duplicateRows:
      duplicateRows,
    groups:
      duplicateGroups
  };

  Logger.log(
    "SUMMARY | GROUPS " +
    duplicateGroups.length +
    " | EXTRA ROWS " +
    duplicateRows
  );

  return result;
}
