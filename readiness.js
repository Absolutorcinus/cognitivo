"use strict";

const readinessForm = document.querySelector("#readiness-form");
const scoreElement = document.querySelector("#readiness-score");
const levelElement = document.querySelector("#readiness-level");
const summaryElement = document.querySelector("#readiness-summary");
const actionsElement = document.querySelector("#readiness-actions");
const downloadButton = document.querySelector("#download-readiness");
let currentResult = null;

const resultBands = [
  { max: 3, level: "Frame the opportunity", summary: "The next step is to narrow the workflow and make the decision, owner, evidence, and risk visible.", actions: ["Name one accountable business owner.", "Choose a single workflow and measurable outcome.", "Identify required data and the most serious failure mode."] },
  { max: 7, level: "Ready for a focused prototype", summary: "The use case has useful foundations, but important assumptions should be tested before an implementation commitment.", actions: ["Create representative evaluation cases.", "Define what a reviewer must approve or correct.", "Run a time-boxed prototype with explicit stop/scale criteria."] },
  { max: 10, level: "Prepare for controlled implementation", summary: "The use case appears comparatively well framed. Validate the remaining gaps and turn controls into operational requirements.", actions: ["Confirm architecture and data approvals.", "Set release thresholds and ongoing monitoring.", "Document ownership, change control, rollback, and incident handling."] },
];

function renderResult(score) {
  const band = resultBands.find((candidate) => score <= candidate.max) || resultBands[2];
  currentResult = { score, ...band };
  scoreElement.textContent = `${score}/10`;
  levelElement.textContent = band.level;
  summaryElement.textContent = band.summary;
  actionsElement.replaceChildren();
  band.actions.forEach((action) => {
    const item = document.createElement("li");
    item.textContent = action;
    actionsElement.append(item);
  });
  downloadButton.disabled = false;
}

readinessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(readinessForm);
  const score = ["outcome", "data", "ownership", "evaluation", "operations"].reduce((sum, key) => sum + Number(data.get(key)), 0);
  renderResult(score);
  scoreElement.scrollIntoView({ behavior: "smooth", block: "center" });
});

downloadButton.addEventListener("click", () => {
  if (!currentResult) return;
  const content = ["COGNITIVIS AI READINESS RESULT", `Prepared: ${new Date().toLocaleDateString("en-GB")}`, "", `Score: ${currentResult.score}/10`, `Readiness: ${currentResult.level}`, "", currentResult.summary, "", "RECOMMENDED NEXT MOVES", ...currentResult.actions.map((action) => `- ${action}`), "", "This directional self-assessment was generated locally and was not submitted to Cognitivis."].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "cognitivis-ai-readiness.txt";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});
