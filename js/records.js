// Shared investigation register — used by investigations.html (list + strip)
// and record.html (detail lookup by id).
const RECORDS = [
  { id: "PROB–017", f: 0.94, status: "OPEN", withheld: false, title: "Interruption as a primitive of machine work",
    question: "CAN A RUNNING AGENT BE STOPPED WITHOUT LOSING WHAT IT KNEW?", apparatus: "0x2F · FOUR HARNESSES", finding: "IN PROGRESS", reading: "open" },
  { id: "PROB–016", f: 0.79, status: "CLOSED", withheld: false, title: "What a machine looks like when nothing runs",
    question: "IS IDLE A STATE OR AN ABSENCE?", apparatus: "057 · 24 H CAPTURE", finding: "A STATE. IT HAS A SHAPE.", reading: "closed" },
  { id: "PROB–015", f: 0.63, status: "WITHHELD", withheld: true },
  { id: "PROB–014", f: 0.47, status: "INCONCLUSIVE", withheld: false, title: "Coordination between agents that never meet",
    question: "WHAT CAN TWO RUNTIMES AGREE ON THROUGH A LEDGER ALONE?", apparatus: "TWO RUNTIMES · SHARED TASK LEDGER", finding: "NOTHING WE COULD DEFEND YET", reading: "broken" },
  { id: "PROB–012", f: 0.26, status: "CLOSED", withheld: false, title: "Inference on one small machine, for a year",
    question: "HOW MUCH INTELLIGENCE FITS UNDER A DESK?", apparatus: "ONE NODE · 64 GB · QUANTISED WEIGHTS", finding: "MORE THAN EXPECTED. LESS THAN ADVERTISED.", reading: "closed" },
  { id: "PROB–009", f: 0.06, status: "WITHHELD", withheld: true },
];
