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
    { id: "SUP-1", name: "Karthik", email: "karthik@ttop.internal", activeStatus: "Active" },
    { id: "SUP-2", name: "Gopi", email: "gopi@ttop.internal", activeStatus: "Active" },
    { id: "SUP-3", name: "Vamsi", email: "vamsi@ttop.internal", activeStatus: "Active" }
  ];

  const candidatePocTeam = [
    { id: "CPOC-1", name: "Kumar", email: "kumar@ttop.internal", activeStatus: "Active" },
    { id: "CPOC-2", name: "Pavan", email: "pavan@ttop.internal", activeStatus: "Active" },
    { id: "CPOC-3", name: "Dilip", email: "dilip@ttop.internal", activeStatus: "Active" }
  ];

  return { supportTeam, candidatePocTeam };
})();
