/******************************************************
 * READ-ONLY TEST:
 * LOOP INTERVIEW CLIENT PARSER
 *
 * Install temporarily or keep as a diagnostic helper
 * in Incentive Backend - Private.
 *
 * Does NOT write to any sheet.
 ******************************************************/
function testLoopInterviewParser(){

  const secondText =
    "Venkata Koushik Reddy Varikoti – Interview – HD Supply – 1:45 AM IST – Duration: 30 Mins (2nd Round)";

  const thirdText =
    "Venkata Koushik Reddy Varikoti – Interview – Loop Interview - HD Supply – 6:30 PM IST – Duration: 30 Mins (3rd Round)";

  const second =
    parseInterview(secondText);

  const third =
    parseInterview(thirdText);

  Logger.log(
    "========== LOOP INTERVIEW PARSER TEST =========="
  );

  Logger.log(
    "2ND PARSED : " +
    JSON.stringify(
      second,
      null,
      2
    )
  );

  Logger.log(
    "3RD PARSED : " +
    JSON.stringify(
      third,
      null,
      2
    )
  );

  if(!second){
    throw new Error(
      "TEST_FAILED|2ND_ROUND_NOT_PARSED"
    );
  }

  if(!third){
    throw new Error(
      "TEST_FAILED|3RD_ROUND_NOT_PARSED"
    );
  }

  if(
    second.candidate !==
    "Venkata Koushik Reddy Varikoti"
  ){
    throw new Error(
      "TEST_FAILED|2ND_CANDIDATE|" +
      second.candidate
    );
  }

  if(
    third.candidate !==
    "Venkata Koushik Reddy Varikoti"
  ){
    throw new Error(
      "TEST_FAILED|3RD_CANDIDATE|" +
      third.candidate
    );
  }

  if(
    second.client !==
    "HD Supply"
  ){
    throw new Error(
      "TEST_FAILED|2ND_CLIENT|" +
      second.client
    );
  }

  if(
    third.client !==
    "HD Supply"
  ){
    throw new Error(
      "TEST_FAILED|3RD_CLIENT|" +
      third.client
    );
  }

  if(
    Number(second.roundNo) !== 2
  ){
    throw new Error(
      "TEST_FAILED|2ND_ROUND|" +
      second.roundNo
    );
  }

  if(
    Number(third.roundNo) !== 3
  ){
    throw new Error(
      "TEST_FAILED|3RD_ROUND|" +
      third.roundNo
    );
  }

  //--------------------------------------------------
  // Also prove the normal promotion engine can group
  // these as one Candidate + Client history.
  //--------------------------------------------------

  second.dateObj =
    new Date(
      2026,
      7,
      12
    );

  third.dateObj =
    new Date(
      2026,
      7,
      13
    );

  const promotions =
    buildPromotionHistory(
      [
        second,
        third
      ]
    );

  Logger.log(
    "PROMOTIONS : " +
    JSON.stringify(
      promotions.map(
        function(item){
          return {
            candidate:
              item.candidate,
            client:
              item.client,
            previousRound:
              item.previousRound,
            promotionRound:
              item.promotionRound
          };
        }
      ),
      null,
      2
    )
  );

  if(
    promotions.length !== 1
  ){
    throw new Error(
      "TEST_FAILED|EXPECTED_ONE_PROMOTION|" +
      promotions.length
    );
  }

  if(
    promotions[0].client !==
      "HD Supply" ||
    Number(
      promotions[0].previousRoundNo
    ) !== 2 ||
    Number(
      promotions[0].promotionRoundNo
    ) !== 3
  ){
    throw new Error(
      "TEST_FAILED|PROMOTION_DETAILS"
    );
  }

  Logger.log(
    "RESULT : PASS"
  );

  Logger.log(
    "Expected normal promotion: " +
    "HD Supply | 2nd Round -> 3rd Round"
  );

  Logger.log(
    "==============================================="
  );

  return {
    ok: true,
    second:
      second,
    third:
      third,
    promotionCount:
      promotions.length
  };
}

