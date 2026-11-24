/******************************************************
 * PORTAL OPERATION RUNTIME v1.0
 *
 * Install in: Interview Portal Control
 *
 * Purpose:
 * - Runtime progress for long portal-side operations.
 * - No doGet/doPost.
 * - Does not create a background trigger.
 *
 * NOTE:
 * Scheduler/Incentive bridge operations keep progress in
 * their own bridge projects. This runtime is used by
 * portal-native operations such as bulk handler approval.
 ******************************************************/

const PORTAL_OPERATION_RUNTIME = {
  CACHE_PREFIX: "POR_PROGRESS_",
  TTL_SECONDS: 21600
};


/******************************************************
 * INTERNAL: SET PROGRESS
 ******************************************************/
function POR_setProgress_(
  operationId,
  percent,
  stage,
  detail,
  status,
  extra
){

  const id =
    String(operationId || "")
      .trim();

  if(!id){
    return;
  }

  const value = {
    operationId: id,
    percent: Math.max(
      0,
      Math.min(
        100,
        Number(percent || 0)
      )
    ),
    stage: String(stage || ""),
    detail: String(detail || ""),
    status: String(status || "Running"),
    updatedAt: new Date().toISOString()
  };

  if(
    extra &&
    typeof extra === "object"
  ){
    Object.keys(extra)
      .forEach(function(key){
        value[key] = extra[key];
      });
  }

  CacheService
    .getScriptCache()
    .put(
      PORTAL_OPERATION_RUNTIME.CACHE_PREFIX + id,
      JSON.stringify(value),
      PORTAL_OPERATION_RUNTIME.TTL_SECONDS
    );
}


/******************************************************
 * INTERNAL: GET PROGRESS
 ******************************************************/
function POR_getProgress_(
  operationId
){

  const id =
    String(operationId || "")
      .trim();

  if(!id){
    return null;
  }

  const raw =
    CacheService
      .getScriptCache()
      .get(
        PORTAL_OPERATION_RUNTIME.CACHE_PREFIX + id
      );

  if(!raw){
    return null;
  }

  try{
    return JSON.parse(raw);
  }catch(error){
    return null;
  }
}


/******************************************************
 * PUBLIC: POLL PORTAL-NATIVE OPERATION PROGRESS
 ******************************************************/
function getPortalOperationProgress(
  token,
  operationId
){

  PO_requireAdmin_(token);

  return {
    ok: true,
    progress:
      POR_getProgress_(operationId) || {
        operationId: String(operationId || ""),
        percent: 0,
        stage: "Waiting",
        detail: "",
        status: "Waiting"
      }
  };
}
