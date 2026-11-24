/******************************************************
 * INCENTIVE HARDENING v1.3 - READ-ONLY TESTS
 * Target: Pradeep Incentive Backend - Private
 ******************************************************/
function testIncentiveHardeningPatterns(){

  const parserCases = [
    [
      "Nihal Inapanuri – Final Interview – Home Depot – 12:30 AM IST – Duration: 30 Mins (4th Round – With Director)",
      "Home Depot",
      4
    ],
    [
      "NAVYA SRI MULUKUNTLA – Interview – interview (round 1) - Maxim Healthcare – 8:30 PM IST – Duration: 30 Mins",
      "Maxim Healthcare",
      1
    ],
    [
      "Ravi Teja Algubelli – Interview – AbbVie - interview – 11:30 PM IST – Duration: 45 Mins (2nd Round)",
      "AbbVie",
      2
    ],
    [
      "Ravi teja algubelli – Interview – Aprio - Interview – 6:30 PM IST – Duration: 30 Mins (2nd Round)",
      "Aprio",
      2
    ],
    [
      "Keerthi Muppalaneni---McGrath RentCorp--Interview--3:00AM IST(30min)(1st round,need to elaborate)",
      "McGrath RentCorp",
      1
    ],
    [
      "Narsimha Rao Vengisetti – Final Interview – Bimbo Bakeries USA – 9:30 PM IST – Duration: 30 Mins (3rd Round)",
      "Bimbo Bakeries USA",
      3
    ],
    [
      "Akshara movva – Interview – Technical Interview - Harlingen CISD – 12:00 AM IST – Duration: 120 Mins (2nd Round)",
      "Harlingen CISD",
      2
    ],
    [
      "Nihal inapanuri – Interview – final interview - home depot – 8:00 PM IST – Duration: 30 Mins (5th Round) (senior director)",
      "home depot",
      5
    ],
    [
      "Sekhar Reddy Kandula – Interview – Assessment Through Interview - YoungWilliams – 1:30 AM IST – Duration: 60 Mins (2nd Round)",
      "YoungWilliams",
      2
    ],
    [
      "Venkata Koushik Reddy Varikoti – Interview – Loop Interview - HD Supply – 6:30 PM IST – Duration: 30 Mins (3rd Round)",
      "HD Supply",
      3
    ]
  ];

  const parserResults =
    parserCases.map(function(test){

      const parsed =
        parseInterview(test[0]);

      return {
        ok:
          !!parsed &&
          parsed.client === test[1] &&
          Number(parsed.roundNo) === Number(test[2]),
        text: test[0],
        parsed: parsed
      };

    });

  const venkataA = [
    "Promotion",
    "Venkata Koushik Reddy Varikoti",
    "Loop Interview - HD Supply",
    "3rd Round",
    "4th Round",
    "13-Aug-2026",
    "13-Aug-2026",
    "Dhruva",
    500,
    "Pending"
  ];

  const venkataB = [
    "Promotion",
    "Venkata Koushik Reddy Varikoti",
    "HD Supply",
    "3rd Round",
    "4th Round",
    "13-Aug-2026",
    "14-Aug-2026",
    "Dhruva",
    500,
    "Pending"
  ];

  const amulyaA = [
    "Promotion",
    "Amulya Bellam Chowdary",
    "Bristol Myers Squibb",
    "1st Round",
    "2nd Round",
    "16-Jul-2026",
    "03-Aug-2026",
    "Naresh",
    100,
    "Pending"
  ];

  const amulyaB = [
    "Promotion",
    "Amulya Bellam Chowdary",
    "Bristol Myers Squibb",
    "1st Round",
    "2nd Round",
    "16-Jul-2026",
    "06-Aug-2026",
    "Naresh",
    100,
    "Pending"
  ];

  const venkataSameLogicalKey =
    PB_buildLogicalPromotionKey_(venkataA) ===
    PB_buildLogicalPromotionKey_(venkataB);

  const amulyaSameLogicalKey =
    PB_buildLogicalPromotionKey_(amulyaA) ===
    PB_buildLogicalPromotionKey_(amulyaB);

  const normalSameDay =
    REC_compareChronology(
      {
        dateObj: new Date(2026,7,10),
        time: "8:00 PM",
        isLoopInterview: false
      },
      {
        dateObj: new Date(2026,7,10),
        time: "9:00 PM",
        isLoopInterview: false
      }
    );

  const loopSameDay =
    REC_compareChronology(
      {
        dateObj: new Date(2026,7,10),
        time: "8:00 PM",
        isLoopInterview: true
      },
      {
        dateObj: new Date(2026,7,10),
        time: "9:00 PM",
        isLoopInterview: true
      }
    );

  const result = {
    pass:
      parserResults.every(function(item){
        return item.ok;
      }) &&
      venkataSameLogicalKey &&
      amulyaSameLogicalKey &&
      normalSameDay.valid === false &&
      normalSameDay.reason === "same_day_non_loop" &&
      loopSameDay.valid === true,
    parserResults: parserResults,
    venkataSameLogicalKey: venkataSameLogicalKey,
    amulyaSameLogicalKey: amulyaSameLogicalKey,
    normalSameDay: normalSameDay,
    loopSameDay: loopSameDay
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;

}

