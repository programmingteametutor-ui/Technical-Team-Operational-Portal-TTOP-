/* ============================================================
   TTOP – data.js
   Default team roster only (no sample candidates, assessments,
   interviews or incentives). Used the first time the portal is
   opened in a browser; after that the Team page is the source of
   truth — add, edit or deactivate people there.

   Team model — two distinct teams:
   - Candidate POC Team: these people ARE the candidate's
     Technical POC. Set once on the candidate profile (candidate.
     candidatePOC) and never asked again when adding interviews.
     Also credited on placement incentives.
   - Support Team: used for "Tool Drive" (interview.doneBy, entered
     manually) and "Call Support" (interview.assignedPOC).
   ============================================================ */

const DefaultTeam = (() => {

  const supportTeam = [
  ];

  const candidatePocTeam = [
  ];

  return { supportTeam, candidatePocTeam };
})();
