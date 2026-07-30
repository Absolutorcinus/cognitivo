"use strict";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 20000;
const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".txt"];
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
]);

const samples = {
  invoice: {
    name: "Northstar_Invoice_0148.pdf",
    type: "Supplier invoice",
    content: `NORTHSTAR STUDIO
49 River Street, Dublin 2

INVOICE

Invoice number: INV-2026-0148
Issue date: 24 July 2026
Due date: 23 August 2026

Bill to:
Acme Operations Europe
12 Market Lane, Warsaw

Description                       Amount
Brand system implementation      €9,800.00
Production support               €2,600.00

Subtotal                         €12,400.00
VAT 0%                               €0.00
Service fee                          €80.00

TOTAL DUE                        €12,480.00
Payment terms: Net 30
IBAN: IE29 AIBK 9311 5212 3456 78`,
    fields: [
      ["invoice-number", "Invoice number", "INV-2026-0148", 99],
      ["supplier", "Supplier", "Northstar Studio", 96, "NORTHSTAR STUDIO"],
      ["issue-date", "Issue date", "24 July 2026", 98],
      ["due-date", "Due date", "23 August 2026", 95],
      ["total", "Total amount", "€12,480.00", 92],
      ["terms", "Payment terms", "Net 30", 88],
    ],
  },
  "purchase-order": {
    name: "Purchase_Order_PO-8824.txt",
    type: "Purchase order",
    content: `ACME OPERATIONS EUROPE
PURCHASE ORDER

PO number: PO-8824
Order date: 27 July 2026
Vendor: Lumina Systems Ltd.

Project: Finance process automation
Cost centre: OPS-214
Delivery date: 15 September 2026

Software configuration           €18,500.00
Training and enablement           €4,200.00

TOTAL                            €22,700.00
Currency: EUR
Approved by: Marta Kowalska`,
    fields: [
      ["po-number", "PO number", "PO-8824", 99],
      ["vendor", "Vendor", "Lumina Systems Ltd.", 97],
      ["cost-centre", "Cost centre", "OPS-214", 96],
      ["delivery-date", "Delivery date", "15 September 2026", 93],
      ["total", "Total amount", "€22,700.00", 96],
      ["approver", "Approved by", "Marta Kowalska", 91],
    ],
  },
};

const extractionPatterns = [
  [
    "document-number",
    "Document number",
    /(?:invoice|document|reference|po)\s*(?:number|no\.?|#)?\s*[:=-]\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
  ],
  [
    "date",
    "Document date",
    /(?:issue|invoice|order|document)?\s*date\s*[:=-]\s*([^\r\n]{4,40})/i,
  ],
  [
    "supplier",
    "Supplier / vendor",
    /(?:supplier|vendor|issued by)\s*[:=-]\s*([^\r\n]{2,80})/i,
  ],
  [
    "total",
    "Total amount",
    /(?:total(?:\s+due)?|amount\s+due)\s*[:=-]?\s*((?:EUR|USD|GBP|PLN|€|\$|£)\s?[\d,.]+|[\d,.]+\s?(?:EUR|USD|GBP|PLN))/i,
  ],
  ["currency", "Currency", /currency\s*[:=-]\s*([A-Z]{3})/i],
  [
    "terms",
    "Payment terms",
    /payment\s+terms\s*[:=-]\s*([^\r\n]{2,50})/i,
  ],
];

const state = {
  content: "",
  fields: [],
  activeId: "",
};

const elements = {
  acceptAll: document.querySelector("#accept-all"),
  averageConfidence: document.querySelector("#average-confidence"),
  chooseFile: document.querySelector("#choose-file"),
  completeReview: document.querySelector("#complete-review"),
  documentName: document.querySelector("#document-name"),
  documentText: document.querySelector("#document-text"),
  documentType: document.querySelector("#document-type"),
  dropButton: document.querySelector("#drop-button"),
  dropZone: document.querySelector("#drop-zone"),
  errorBanner: document.querySelector("#error-banner"),
  fieldCount: document.querySelector("#field-count"),
  fieldList: document.querySelector("#field-list"),
  fileInput: document.querySelector("#file-input"),
  notice: document.querySelector("#notice"),
  paperLabel: document.querySelector("#paper-label"),
  progressFill: document.querySelector("#progress-fill"),
  progressLabel: document.querySelector("#progress-label"),
  progressTrack: document.querySelector("#progress-track"),
  sampleSelect: document.querySelector("#sample-select"),
};

function sampleFields(sample) {
  return sample.fields.map(([id, label, value, confidence, source]) => ({
    id,
    label,
    value,
    confidence,
    source: source || value,
    review: confidence < 90 ? "attention" : "pending",
  }));
}

function loadSample(id) {
  const sample = samples[id];
  if (!sample) return;

  state.content = sample.content;
  state.fields = sampleFields(sample);
  state.activeId = state.fields[0]?.id || "";
  elements.documentName.textContent = sample.name;
  elements.documentType.textContent = `${sample.type} · Demo workspace`;
  elements.paperLabel.textContent = sample.type;
  elements.sampleSelect.value = id;
  setNotice(`${sample.type} sample loaded. Select a field to locate its evidence.`);
  clearError();
  render();
}

function setNotice(message) {
  elements.notice.textContent = message;
}

function clearError() {
  elements.errorBanner.hidden = true;
  elements.errorBanner.textContent = "";
}

function showError(message) {
  elements.errorBanner.textContent = `File not accepted. ${message}`;
  elements.errorBanner.hidden = false;
}

function renderDocument() {
  elements.documentText.replaceChildren();
  const active = state.fields.find((field) => field.id === state.activeId);
  const evidence = active?.source.toLocaleLowerCase();

  state.content.split(/\r?\n/).forEach((line) => {
    const paragraph = document.createElement("p");
    paragraph.className = "document-line";
    paragraph.textContent = line || "\u00a0";
    if (evidence && line.toLocaleLowerCase().includes(evidence)) {
      paragraph.classList.add("is-evidence");
    }
    elements.documentText.append(paragraph);
  });
}

function createFieldCard(field) {
  const card = document.createElement("article");
  card.className = "field-card";
  card.dataset.fieldId = field.id;
  if (state.activeId === field.id) card.classList.add("is-active");
  if (field.review === "accepted") card.classList.add("is-accepted");
  if (field.review === "attention") card.classList.add("needs-attention");

  const meta = document.createElement("div");
  meta.className = "field-meta";

  const label = document.createElement("label");
  label.htmlFor = `field-${field.id}`;
  label.textContent = field.label;

  const confidence = document.createElement("span");
  confidence.className = `confidence-tag${field.confidence < 95 ? " medium" : ""}`;
  confidence.textContent = `${field.confidence}% confidence`;
  meta.append(label, confidence);

  const valueRow = document.createElement("div");
  valueRow.className = "field-value-row";

  const input = document.createElement("input");
  input.id = `field-${field.id}`;
  input.value = field.value;
  input.maxLength = 120;
  input.addEventListener("focus", () => {
    state.activeId = field.id;
    render();
  });
  input.addEventListener("input", (event) => {
    field.value = event.target.value;
    field.review = "attention";
    updateSummary();
    card.classList.remove("is-accepted");
    card.classList.add("needs-attention");
    acceptButton.textContent = "Accept";
  });

  const acceptButton = document.createElement("button");
  acceptButton.className = "accept-field";
  acceptButton.type = "button";
  acceptButton.textContent = field.review === "accepted" ? "✓" : "Accept";
  acceptButton.setAttribute("aria-label", `Accept ${field.label}`);
  acceptButton.addEventListener("click", () => {
    field.review = "accepted";
    state.activeId = field.id;
    render();
  });
  valueRow.append(input, acceptButton);

  const evidenceRow = document.createElement("div");
  evidenceRow.className = "field-evidence";
  const sourceLabel = document.createElement("span");
  sourceLabel.textContent = "Source";
  const quote = document.createElement("q");
  quote.textContent = field.source;
  evidenceRow.append(sourceLabel, quote);

  card.append(meta, valueRow, evidenceRow);
  card.addEventListener("click", (event) => {
    if (event.target === input || event.target === acceptButton) return;
    state.activeId = field.id;
    render();
  });
  return card;
}

function renderFields() {
  elements.fieldList.replaceChildren();
  if (!state.fields.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = "No extracted fields yet";
    const copy = document.createElement("p");
    copy.textContent =
      "Load a built-in sample or choose a labelled TXT file to try local extraction.";
    empty.append(title, copy);
    elements.fieldList.append(empty);
    return;
  }

  state.fields.forEach((field) => {
    elements.fieldList.append(createFieldCard(field));
  });
}

function updateSummary() {
  const accepted = state.fields.filter(
    (field) => field.review === "accepted",
  ).length;
  const confidence = state.fields.length
    ? Math.round(
        state.fields.reduce((sum, field) => sum + field.confidence, 0) /
          state.fields.length,
      )
    : 0;
  const completion = state.fields.length
    ? Math.round((accepted / state.fields.length) * 100)
    : 0;

  elements.averageConfidence.textContent = confidence ? `${confidence}%` : "—";
  elements.fieldCount.textContent = String(state.fields.length);
  elements.progressLabel.textContent = `${accepted} / ${state.fields.length} validated`;
  elements.progressFill.style.width = `${completion}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(completion));
  elements.acceptAll.disabled =
    !state.fields.length || accepted === state.fields.length;
  elements.completeReview.disabled =
    !state.fields.length || accepted !== state.fields.length;
}

function render() {
  renderDocument();
  renderFields();
  updateSummary();
}

function extractTextFields(content) {
  return extractionPatterns.flatMap(([id, label, expression]) => {
    const match = content.match(expression);
    if (!match?.[1]) return [];
    const value = match[1].trim().slice(0, 120);
    return [
      {
        id,
        label,
        value,
        confidence: 90,
        source: value,
        review: "pending",
      },
    ];
  });
}

async function processFile(file) {
  clearError();
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const typeAllowed =
    ALLOWED_MIME_TYPES.has(file.type) ||
    (file.type === "" && ALLOWED_EXTENSIONS.includes(extension));

  if (!typeAllowed || !ALLOWED_EXTENSIONS.includes(extension)) {
    showError("Choose a PDF, PNG, JPG, JPEG, or plain-text file.");
    return;
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    showError("The file must be larger than 0 bytes and no more than 10 MB.");
    return;
  }

  elements.documentName.textContent = file.name.slice(0, 120);
  elements.sampleSelect.value = "custom";

  if (extension === ".txt") {
    const content = (await file.text()).slice(0, MAX_TEXT_CHARACTERS);
    state.content = content;
    state.fields = extractTextFields(content);
    state.activeId = state.fields[0]?.id || "";
    elements.documentType.textContent = "Plain-text document · Local extraction";
    elements.paperLabel.textContent = "Plain-text document";
    setNotice(
      state.fields.length
        ? `Local extraction found ${state.fields.length} field${state.fields.length === 1 ? "" : "s"}. Nothing left your browser.`
        : "No supported labels were found. Try a built-in sample to explore the review flow.",
    );
    render();
    return;
  }

  state.content = `FILE READY FOR PRIVATE REVIEW

${file.name}
${formatBytes(file.size)} · ${file.type || "Unknown media type"}

For privacy, this prototype does not transmit or render uploaded PDF and image content. A production version would connect this review experience to your approved OCR service.`;
  state.fields = [];
  state.activeId = "";
  elements.documentType.textContent = "Private demo file · OCR disabled";
  elements.paperLabel.textContent = "Private demo file";
  setNotice(
    "File validated locally. OCR is intentionally disabled in this public demo; use a built-in sample to try the extraction workflow.",
  );
  render();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

elements.chooseFile.addEventListener("click", () => elements.fileInput.click());
elements.dropButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) void processFile(file);
  event.target.value = "";
});
elements.sampleSelect.addEventListener("change", (event) => {
  loadSample(event.target.value);
});
elements.acceptAll.addEventListener("click", () => {
  state.fields.forEach((field) => {
    field.review = "accepted";
  });
  setNotice("All extracted fields have been marked as validated.");
  render();
});
elements.completeReview.addEventListener("click", () => {
  setNotice(
    "Review complete. This validated record is now ready for an approved export workflow.",
  );
});

["dragenter", "dragover"].forEach((type) => {
  elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});
elements.dropZone.addEventListener("dragleave", () => {
  elements.dropZone.classList.remove("is-dragging");
});
elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer.files?.[0];
  if (file) void processFile(file);
});

loadSample("invoice");
