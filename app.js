const pageSections = {
  home: ["home", "intro", "home-signup", "home-explore"],
  services: ["services"],
  solutions: ["solutions"],
  work: ["work"],
  builders: ["builders"],
  opportunities: ["opportunities"],
  about: ["about"],
  partners: ["partners"],
  insights: ["insights"],
  contact: ["contact"],
  account: ["account"],
};

const pageTitles = {
  home: "Home",
  services: "Services",
  solutions: "Solutions",
  work: "Our work",
  builders: "Join as a builder",
  opportunities: "Opportunities",
  about: "About BuildCore",
  partners: "Partners",
  insights: "Blog & events",
  contact: "Contact",
  account: "Your account",
};

const currentPage = new URLSearchParams(window.location.search).get("page");
const activePage = Object.hasOwn(pageSections, currentPage) ? currentPage : "home";
document.body.dataset.page = activePage;
document.title = `${pageTitles[activePage]} — BuildCore Technologies | Engineering Digital Infrastructure`;
document.querySelectorAll("main > section[id]").forEach((section) => {
  section.hidden = !pageSections[activePage].includes(section.id);
});

function openAuthDisclosureFromHash() {
  const authDisclosure = document.getElementById(window.location.hash.slice(1));
  if (!authDisclosure?.matches("details.form-disclosure") || !authDisclosure.closest("#builders")) return;

  if (authDisclosure.id === "builder-application") {
    authDisclosure.open = true;
  } else {
    document.querySelectorAll("#builder-signup, #builder-login").forEach((disclosure) => {
      disclosure.open = disclosure === authDisclosure;
    });
  }
  window.requestAnimationFrame(() => authDisclosure.scrollIntoView({ block: "start" }));
}

openAuthDisclosureFromHash();
window.addEventListener("hashchange", openAuthDisclosureFromHash);

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  const sectionId = link.getAttribute("href").slice(1);
  const targetPage = Object.entries(pageSections).find(([, sections]) => sections.includes(sectionId))?.[0];
  if (targetPage) link.href = `?page=${targetPage}#${sectionId}`;
});

const requestedInquiry = new URLSearchParams(window.location.search).get("inquiry");
if (requestedInquiry) {
  const inquirySelect = document.querySelector('#contact-form select[name="inquiry"]');
  if (inquirySelect && [...inquirySelect.options].some((option) => option.value === requestedInquiry)) {
    inquirySelect.value = requestedInquiry;
  }
}

const menuToggle = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector(".primary-nav");

menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
  primaryNav.classList.toggle("is-open", !isOpen);
});

primaryNav.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    primaryNav.classList.remove("is-open");
  }
});

document.querySelector("#current-year").textContent = String(new Date().getFullYear());

const builderForm = document.querySelector("#builder-form");
const builderMessage = document.querySelector("#builder-message");
const skillInputs = [...builderForm.querySelectorAll('input[name="skills"]')];
const toast = document.querySelector("#toast");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
}

function selectedSkills() {
  return skillInputs.filter((input) => input.checked);
}

function setFormMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function allocateBuilderId(department) {
  const storageKey = "buildcore-builder-preview-number";
  const nextNumber = Number.parseInt(localStorage.getItem(storageKey) || "0", 10);
  if (!Number.isSafeInteger(nextNumber) || nextNumber < 0) {
    throw new Error("The local preview ID counter is invalid. Clear this site's local storage and try again.");
  }
  localStorage.setItem(storageKey, String(nextNumber + 1));
  return `BCT-BLD-${String(nextNumber).padStart(5, "0")}-${department}`;
}

function asciiPdfText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapPdfLine(value, maxLength = 84) {
  const words = String(value).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (word.length > maxLength) {
      if (line) lines.push(line);
      line = "";
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      continue;
    }
    if (line && `${line} ${word}`.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createPdfBlob(lines) {
  const pageLines = [];
  for (let index = 0; index < lines.length; index += 43) {
    pageLines.push(lines.slice(index, index + 43));
  }
  const objects = [];
  const pageIds = pageLines.map((_, index) => 4 + index * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pageLines.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const content = [
      "BT",
      "/F1 15 Tf",
      "50 790 Td",
      "(BUILDCORE TECHNOLOGIES) Tj",
      "/F1 9 Tf",
      "0 -24 Td",
      "(Builder profile - local preview copy) Tj",
      "/F1 10 Tf",
      "0 -28 Td",
      ...page.flatMap((line, lineIndex) => {
        const command = lineIndex === 0 ? `(${asciiPdfText(line)}) Tj` : `0 -15 Td (${asciiPdfText(line)}) Tj`;
        return [command];
      }),
      "ET",
    ].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`;
  });

  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  let byteLength = new TextEncoder().encode(parts[0]).length;
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = byteLength;
    const object = `${id} 0 obj\n${objects[id]}\nendobj\n`;
    parts.push(object);
    byteLength += new TextEncoder().encode(object).length;
  }
  const xrefOffset = byteLength;
  const xref = [`xref\n0 ${objects.length}\n`, "0000000000 65535 f \n"];
  for (let id = 1; id < objects.length; id += 1) {
    xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  xref.push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  parts.push(xref.join(""));
  return new Blob(parts, { type: "application/pdf" });
}

function createBuilderPdfBlob(formData, builderId, skills, isPreview = true) {
  const certificateFiles = formData.getAll("certificates").filter((file) => file.name);
  const lines = [
    "BUILDER APPLICATION",
    "",
    `Builder ID: ${builderId}`,
    `Professional / business name: ${formData.get("businessName") || "Independent Builder"}`,
    `Name: ${formData.get("name")}`,
    `Age: ${formData.get("age")}`,
    `Email: ${formData.get("email")}`,
    `Phone / WhatsApp: ${formData.get("phone")}`,
    `Location: ${formData.get("location")}, ${formData.get("country")}`,
    `Skills: ${skills.map((skill) => skill.value).join(", ")}`,
    `Experience: ${formData.get("experience")}`,
    `Portfolio: ${formData.get("portfolio") || "Not provided"}`,
    `Identity document type: ${formData.get("documentType")}`,
    `Identity file selected: ${formData.get("identityDocument").name}`,
    `Certificates selected: ${certificateFiles.length ? certificateFiles.map((file) => file.name).join(", ") : "None"}`,
    `Created: ${new Date().toLocaleString()}`,
    "",
    isPreview ? "DEMO NOTICE" : "PRIVACY NOTICE",
    ...(isPreview
      ? [
          "This preview PDF was generated in your browser. The identity document and certificates",
          "are not attached to this PDF, uploaded, or stored by BuildCore through this demo.",
          "This preview ID is not a permanent or globally reserved Builder ID.",
          "Please do not submit real identity documents on this demo website.",
        ]
      : [
          "This profile was submitted to BuildCore using its configured Supabase project.",
          "Identity documents and certificates are held separately in private storage and are",
          "not embedded in this downloadable profile PDF.",
        ]),
  ].flatMap((line) => wrapPdfLine(line));

  return createPdfBlob(lines);
}

function downloadBuilderPdf(formData, builderId, skills, isPreview = true) {
  const blob = createBuilderPdfBlob(formData, builderId, skills, isPreview);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `BuildCore-${builderId}-profile.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.BuildCorePreview = { createBuilderPdfBlob, downloadBuilderPdf };

builderForm.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
  const oversizedFile = [...input.files].find((file) => file.size > 10 * 1024 * 1024);
  if (oversizedFile) {
    input.value = "";
    setFormMessage(builderMessage, `${oversizedFile.name} is larger than 10 MB. Choose a smaller file.`, true);
  } else {
    setFormMessage(builderMessage, "");
  }
});

builderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setFormMessage(builderMessage, "");
  const config = window.BUILDCORE_SUPABASE_CONFIG;
  if (config?.url && config?.anonKey) return;
  if (!builderForm.reportValidity()) return;

  const skills = selectedSkills();
  if (!skills.length) {
    setFormMessage(builderMessage, "Choose at least one skill to create your profile.", true);
    builderForm.querySelector(".skill-field").scrollIntoView({ behavior: "smooth", block: "center" });
    skillInputs[0].focus();
    return;
  }

  const files = [
    ...builderForm.querySelector('[name="identityDocument"]').files,
    ...builderForm.querySelector('[name="certificates"]').files,
  ];
  const oversizedFile = files.find((file) => file.size > 10 * 1024 * 1024);
  if (oversizedFile) {
    setFormMessage(builderMessage, `${oversizedFile.name} is larger than 10 MB. Choose a smaller file.`, true);
    return;
  }

  try {
    const formData = new FormData(builderForm);
    const builderId = allocateBuilderId(skills[0].dataset.dept);
    downloadBuilderPdf(formData, builderId, skills);
    setFormMessage(builderMessage, `Your local preview profile is ready. Preview Builder ID: ${builderId}. Your PDF download should begin now.`);
    showToast(`Preview profile created: ${builderId}`);
  } catch (error) {
    setFormMessage(builderMessage, error instanceof Error ? error.message : "The preview profile could not be created.", true);
  }
});

document.querySelectorAll("[data-inquiry]").forEach((link) => {
  link.addEventListener("click", () => {
    const inquirySelect = document.querySelector('#contact-form select[name="inquiry"]');
    inquirySelect.value = link.dataset.inquiry;
  });
});

const sectionRail = document.querySelector(".section-rail");
if (sectionRail && "IntersectionObserver" in window) {
  const railLinks = [...sectionRail.querySelectorAll('a[href^="#"]')].filter((link) => {
    const sectionId = new URL(link.href).hash.slice(1);
    return pageSections[activePage].includes(sectionId);
  });
  sectionRail.hidden = railLinks.length < 2;
  const railSections = railLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);
  const railObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const activeLink = sectionRail.querySelector(`a[href="#${entry.target.id}"]`);
        railLinks.forEach((link) => {
          if (link === activeLink) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      });
    },
    { rootMargin: "-42% 0px -42% 0px" },
  );
  railSections.forEach((section) => railObserver.observe(section));
}

document.querySelector("#contact-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#contact-message");
  if (!form.reportValidity()) return;

  const data = new FormData(form);
  const config = window.BUILDCORE_SUPABASE_CONFIG;
  const isSupabaseConfigured = Boolean(
    config
      && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url)
      && typeof config.anonKey === "string"
      && config.anonKey.length > 30
      && !config.anonKey.includes("YOUR_SUPABASE"),
  );
  if (isSupabaseConfigured) {
    setFormMessage(message, "Sending your message securely...");
    return;
  }
  const subject = `BuildCore enquiry: ${data.get("inquiry")}`;
  const body = [
    `Name: ${data.get("name")}`,
    `Email: ${data.get("email")}`,
    `Enquiry: ${data.get("inquiry")}`,
    "",
    String(data.get("message")),
  ].join("\n");
  const mailto = `mailto:buildcoretechnologieslimited@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  setFormMessage(message, "Opening your email app with this message. If it doesn’t open, email buildcoretechnologieslimited@gmail.com directly.");
  window.location.href = mailto;
});
