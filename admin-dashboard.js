const config = window.BUILDCORE_SUPABASE_CONFIG;
const MEDIA_BUCKET = "site-media";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
]);
const loginPanel = document.querySelector("#login-panel");
const loginForm = document.querySelector("#admin-login");
const loginStatus = document.querySelector("#login-status");
const accessDenied = document.querySelector("#access-denied");
const dashboard = document.querySelector("#dashboard");
const signOutButton = document.querySelector("#sign-out");
let supabase;
let currentUser;
let cachedUpdates = [];
const defaultFooterLinks = [
  { key: "visit", label: "Visit", href: "?page=about#about", position: 1 },
  { key: "map", label: "Map", href: "", position: 2 },
  { key: "events", label: "Events", href: "?page=insights#insights", position: 3 },
  { key: "jobs", label: "Jobs", href: "?page=opportunities#opportunities", position: 4 },
  { key: "contact", label: "Contact", href: "?page=contact#contact", position: 5 },
  { key: "privacy", label: "Privacy", href: "", position: 6 },
  { key: "terms", label: "Terms", href: "", position: 7 },
  { key: "accessibility", label: "Accessibility", href: "", position: 8 },
  { key: "social-media-hub", label: "Social Media Hub", href: "", position: 9 },
];

function isConfigured() {
  return Boolean(
    config
      && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url)
      && typeof config.anonKey === "string"
      && config.anonKey.length > 30
      && !config.anonKey.includes("YOUR_SUPABASE"),
  );
}

function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function safeFilename(filename) {
  return filename.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(-120) || "upload";
}

function allowedMimeType(file) {
  if (ALLOWED_MEDIA_TYPES.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const types = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  const type = types[extension];
  return type && ALLOWED_MEDIA_TYPES.has(type) ? type : null;
}

function formatDate(value, options = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function setDashboardVisible(isVisible) {
  dashboard.hidden = !isVisible;
  loginPanel.hidden = isVisible;
  accessDenied.hidden = true;
  signOutButton.hidden = !isVisible;
}

function showAccessDenied() {
  dashboard.hidden = true;
  loginPanel.hidden = true;
  accessDenied.hidden = false;
  signOutButton.hidden = false;
}

function setEmpty(container, message) {
  const note = document.createElement("p");
  note.className = "empty-note";
  note.textContent = message;
  container.replaceChildren(note);
}

async function uploadMedia(file) {
  const mimeType = allowedMimeType(file);
  if (!mimeType || file.size > MAX_UPLOAD_BYTES || file.size === 0) {
    throw new Error("Choose a supported image or video file no larger than 25 MB.");
  }
  const path = `${currentUser.id}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const storage = supabase.storage.from(MEDIA_BUCKET);
  const { error: uploadError } = await storage.upload(path, file, {
    cacheControl: "3600",
    contentType: mimeType,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: publicUrl } = storage.getPublicUrl(path);
  const { error: recordError } = await supabase.from("media_assets").insert({
    path,
    public_url: publicUrl.publicUrl,
    original_name: file.name,
    mime_type: mimeType,
    size_bytes: file.size,
    uploaded_by: currentUser.id,
  });
  if (recordError) {
    const { error: cleanupError } = await storage.remove([path]);
    if (cleanupError) console.error("Could not clean up an unregistered media upload:", cleanupError);
    throw recordError;
  }
  return publicUrl.publicUrl;
}

function renderUpdateList(updates) {
  const list = document.querySelector("#update-list");
  const recent = document.querySelector("#recent-updates");
  document.querySelector("#update-count").textContent = String(updates.length);
  document.querySelector("#nav-updates-count").textContent = String(updates.filter((item) => item.status === "published").length);
  if (!updates.length) {
    setEmpty(list, "No updates yet. Create your first story.");
    setEmpty(recent, "Your recent stories will appear here.");
    return;
  }

  list.replaceChildren();
  recent.replaceChildren();
  updates.forEach((update) => {
    const row = document.createElement("article");
    row.className = "update-row";
    const copy = document.createElement("div");
    copy.className = "update-row-copy";
    const title = document.createElement("strong");
    title.textContent = update.title;
    const details = document.createElement("span");
    details.textContent = `${update.category} · ${formatDate(update.updated_at)}`;
    copy.append(title, details);
    const badge = document.createElement("span");
    badge.className = `status-badge status-${update.status}`;
    badge.textContent = update.status;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => beginEditing(update));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => void deleteUpdate(update));
    actions.append(edit, remove);
    row.append(copy, badge, actions);
    list.append(row);

    if (recent.childElementCount < 5) {
      const recentItem = document.createElement("div");
      recentItem.className = "recent-item";
      const marker = document.createElement("span");
      marker.className = `recent-marker status-${update.status}`;
      const recentCopy = document.createElement("span");
      const recentTitle = document.createElement("strong");
      recentTitle.textContent = update.title;
      const recentDate = document.createElement("small");
      recentDate.textContent = `${update.status === "published" ? "Published" : "Draft"} · ${formatDate(update.updated_at)}`;
      recentCopy.append(recentTitle, recentDate);
      recentItem.append(marker, recentCopy);
      recent.append(recentItem);
    }
  });
}

function renderMedia(media) {
  const grid = document.querySelector("#media-grid");
  document.querySelector("#media-count").textContent = String(media.length);
  document.querySelector("#stat-media").textContent = String(media.length);
  if (!media.length) {
    setEmpty(grid, "Your uploaded files will appear here.");
    return;
  }
  grid.replaceChildren();
  media.forEach((asset) => {
    const card = document.createElement("article");
    card.className = "media-card";
    const preview = document.createElement(asset.mime_type.startsWith("video/") ? "video" : "img");
    if (preview instanceof HTMLVideoElement) {
      preview.controls = true;
      preview.preload = "metadata";
    } else {
      preview.alt = "";
      preview.loading = "lazy";
    }
    preview.src = asset.public_url;
    const detail = document.createElement("div");
    detail.className = "media-card-detail";
    const name = document.createElement("strong");
    name.textContent = asset.original_name;
    const date = document.createElement("small");
    date.textContent = `${(asset.size_bytes / 1024 / 1024).toFixed(1)} MB · ${formatDate(asset.created_at)}`;
    detail.append(name, date);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-link";
    copy.textContent = "Copy link";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(asset.public_url);
        copy.textContent = "Copied";
      } catch (error) {
        console.error("Could not copy the media URL:", error);
        copy.textContent = "Copy unavailable";
      }
    });
    card.append(preview, detail, copy);
    grid.append(card);
  });
}

function renderInbox(submissions) {
  const list = document.querySelector("#inbox-list");
  const newCount = submissions.filter((item) => item.status === "new").length;
  document.querySelector("#stat-enquiries").textContent = String(newCount);
  document.querySelector("#nav-inbox-count").textContent = String(newCount);
  document.querySelector("#inbox-count").textContent = `${submissions.length} ${submissions.length === 1 ? "enquiry" : "enquiries"}`;
  if (!submissions.length) {
    setEmpty(list, "There are no enquiries yet.");
    return;
  }
  list.replaceChildren();
  submissions.forEach((submission) => {
    const article = document.createElement("article");
    article.className = "inbox-item";
    const header = document.createElement("div");
    header.className = "inbox-item-header";
    const identity = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = submission.name;
    const email = document.createElement("a");
    email.href = `mailto:${submission.email}`;
    email.textContent = submission.email;
    identity.append(name, email);
    const status = document.createElement("select");
    status.setAttribute("aria-label", `Status for enquiry from ${submission.name}`);
    [
      ["new", "New"],
      ["in_progress", "In progress"],
      ["resolved", "Resolved"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      status.append(option);
    });
    status.value = submission.status;
    status.addEventListener("change", () => void updateEnquiryStatus(submission, status));
    header.append(identity, status);
    const topic = document.createElement("div");
    topic.className = "inbox-topic";
    topic.append(document.createTextNode(submission.inquiry));
    const date = document.createElement("time");
    date.dateTime = submission.created_at;
    date.textContent = formatDate(submission.created_at, { dateStyle: "medium", timeStyle: "short" });
    topic.append(date);
    const message = document.createElement("p");
    message.textContent = submission.message;
    article.append(header, topic, message);
    list.append(article);
  });
}

async function refreshDashboard() {
  const [updatesResult, mediaResult, submissionsResult] = await Promise.all([
    supabase.from("site_updates").select("id, title, slug, excerpt, body, category, cover_image_url, status, published_at, created_at, updated_at").order("updated_at", { ascending: false }),
    supabase.from("media_assets").select("path, public_url, original_name, mime_type, size_bytes, created_at").order("created_at", { ascending: false }),
    supabase.from("contact_submissions").select("id, name, email, inquiry, message, status, created_at, updated_at").order("created_at", { ascending: false }),
  ]);
  if (updatesResult.error) throw updatesResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (submissionsResult.error) throw submissionsResult.error;
  cachedUpdates = updatesResult.data;
  renderUpdateList(cachedUpdates);
  renderMedia(mediaResult.data);
  renderInbox(submissionsResult.data);
  document.querySelector("#stat-published").textContent = String(cachedUpdates.filter((item) => item.status === "published").length);
  document.querySelector("#stat-drafts").textContent = String(cachedUpdates.filter((item) => item.status === "draft").length);
  await refreshFooterLinks();
}

function renderFooterLinkEditor(links) {
  const list = document.querySelector("#footer-link-editor-list");
  const savedLinks = new Map(links.map((link) => [link.key, link]));
  list.replaceChildren();
  defaultFooterLinks.forEach((defaultLink) => {
    const savedLink = savedLinks.get(defaultLink.key);
    const row = document.createElement("div");
    row.className = "footer-link-editor-row";
    row.dataset.key = defaultLink.key;

    const labelField = document.createElement("label");
    labelField.textContent = "Label";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.name = "label";
    labelInput.maxLength = 60;
    labelInput.required = true;
    labelInput.value = savedLink?.label || defaultLink.label;
    labelField.append(labelInput);

    const hrefField = document.createElement("label");
    hrefField.textContent = "Link address";
    const hrefInput = document.createElement("input");
    hrefInput.type = "text";
    hrefInput.name = "href";
    hrefInput.maxLength = 500;
    hrefInput.autocomplete = "url";
    hrefInput.placeholder = "Add a URL or leave blank";
    hrefInput.value = savedLink?.href || "";
    hrefField.append(hrefInput);

    const visibilityLabel = document.createElement("label");
    visibilityLabel.className = "footer-link-visibility";
    const visibilityInput = document.createElement("input");
    visibilityInput.type = "checkbox";
    visibilityInput.name = "enabled";
    visibilityInput.checked = savedLink ? savedLink.enabled : true;
    visibilityLabel.append(visibilityInput, document.createTextNode("Show link"));

    row.append(labelField, hrefField, visibilityLabel);
    list.append(row);
  });
}

async function refreshFooterLinks() {
  const status = document.querySelector("#footer-links-status");
  try {
    const { data, error } = await supabase
      .from("footer_links")
      .select("key, label, href, position, enabled")
      .order("position", { ascending: true });
    if (error) throw error;
    renderFooterLinkEditor(data);
    setStatus(status, "");
    return true;
  } catch (error) {
    console.error("Could not load footer links:", error);
    setStatus(status, `${error.message || "Footer links could not be loaded."} Run the latest supabase.sql in the Supabase SQL Editor to enable footer-link management.`, true);
    return false;
  }
}

function isAllowedFooterHref(value) {
  const href = value.trim();
  if (!href || /[\u0000-\u001f]/.test(href)) return true;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
    try {
      return ["http:", "https:", "mailto:", "tel:"].includes(new URL(href).protocol);
    } catch {
      return false;
    }
  }
  return /^(\/(?!\/)|\?|#)/.test(href) && !href.includes("\\");
}

function bindFooterLinksForm() {
  const form = document.querySelector("#footer-links-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const rows = [...form.querySelectorAll(".footer-link-editor-row")];
    const invalidRow = rows.find((row) => !isAllowedFooterHref(row.querySelector('[name="href"]').value));
    if (invalidRow) {
      const label = invalidRow.querySelector('[name="label"]').value;
      setStatus(document.querySelector("#footer-links-status"), `Enter a safe website path or http(s), mailto, or tel link for ${label}.`, true);
      invalidRow.querySelector('[name="href"]').focus();
      return;
    }
    const records = rows.map((row, index) => ({
        key: row.dataset.key,
        label: row.querySelector('[name="label"]').value.trim(),
        href: row.querySelector('[name="href"]').value.trim(),
        position: defaultFooterLinks[index].position,
        enabled: row.querySelector('[name="enabled"]').checked,
      }));
    if (records.some((record) => record.label.length < 2)) {
      setStatus(document.querySelector("#footer-links-status"), "Each footer label must contain at least two characters.", true);
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus(document.querySelector("#footer-links-status"), "Saving footer links...");
    try {
      const { error } = await supabase.from("footer_links").upsert(records, { onConflict: "key" });
      if (error) throw error;
      if (await refreshFooterLinks()) {
        setStatus(document.querySelector("#footer-links-status"), "Footer links saved.");
      }
    } catch (error) {
      console.error("Could not save footer links:", error);
      setStatus(document.querySelector("#footer-links-status"), error.message || "Footer links could not be saved.", true);
    } finally {
      button.disabled = false;
    }
  });
}

function slugify(value) {
  const slug = value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
  return slug || `update-${crypto.randomUUID().slice(0, 8)}`;
}

function resetEditor() {
  const form = document.querySelector("#update-form");
  form.reset();
  form.elements.id.value = "";
  form.elements.category.value = "News";
  document.querySelector("#editor-eyebrow").textContent = "NEW STORY";
  document.querySelector("#editor-title").textContent = "Create an update";
  document.querySelector("#cancel-edit").hidden = true;
  setStatus(document.querySelector("#update-status"), "");
}

function beginEditing(update) {
  const form = document.querySelector("#update-form");
  form.elements.id.value = update.id;
  form.elements.title.value = update.title;
  form.elements.excerpt.value = update.excerpt;
  form.elements.body.value = update.body;
  form.elements.category.value = update.category;
  form.elements.cover.value = "";
  document.querySelector("#editor-eyebrow").textContent = "EDIT STORY";
  document.querySelector("#editor-title").textContent = "Update your story";
  document.querySelector("#cancel-edit").hidden = false;
  document.querySelector("#panel-updates").scrollIntoView({ behavior: "smooth" });
}

async function deleteUpdate(update) {
  if (!window.confirm(`Delete “${update.title}”? This cannot be undone.`)) return;
  try {
    const { error } = await supabase.from("site_updates").delete().eq("id", update.id);
    if (error) throw error;
    await refreshDashboard();
  } catch (error) {
    console.error("Could not delete the update:", error);
    setStatus(document.querySelector("#update-status"), error.message || "The update could not be deleted.", true);
  }
}

async function updateEnquiryStatus(submission, control) {
  control.disabled = true;
  try {
    const { error } = await supabase.from("contact_submissions")
      .update({ status: control.value }).eq("id", submission.id);
    if (error) throw error;
    await refreshDashboard();
  } catch (error) {
    console.error("Could not update the enquiry status:", error);
    setStatus(document.querySelector("#dashboard-status"), error.message || "The enquiry could not be updated.", true);
    control.value = submission.status;
  } finally {
    control.disabled = false;
  }
}

function bindUpdateForm() {
  const form = document.querySelector("#update-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const submitter = event.submitter;
    const status = submitter?.value === "draft" ? "draft" : "published";
    const saveButton = submitter;
    if (saveButton) saveButton.disabled = true;
    setStatus(document.querySelector("#update-status"), "Saving your update...");
    try {
      let coverImageUrl = cachedUpdates.find((item) => item.id === values.get("id"))?.cover_image_url || null;
      const cover = values.get("cover");
      if (cover instanceof File && cover.size) coverImageUrl = await uploadMedia(cover);
      const update = {
        title: String(values.get("title") || "").trim(),
        slug: slugify(String(values.get("title") || "")),
        excerpt: String(values.get("excerpt") || "").trim(),
        body: String(values.get("body") || "").trim(),
        category: String(values.get("category") || "").trim(),
        cover_image_url: coverImageUrl,
        status,
      };
      const id = String(values.get("id") || "");
      const result = id
        ? await supabase.from("site_updates").update(update).eq("id", id).select("id").maybeSingle()
        : await supabase.from("site_updates").insert(update).select("id").single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("The update could not be found. Refresh the page and try again.");
      resetEditor();
      await refreshDashboard();
      setStatus(document.querySelector("#update-status"), status === "published" ? "Update published on your website." : "Draft saved.");
    } catch (error) {
      console.error("Could not save the update:", error);
      setStatus(document.querySelector("#update-status"), error.message || "The update could not be saved.", true);
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });
  document.querySelector("#cancel-edit").addEventListener("click", resetEditor);
}

function bindMediaForm() {
  const form = document.querySelector("#media-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const file = new FormData(form).get("file");
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus(document.querySelector("#media-status"), "Uploading your file...");
    try {
      await uploadMedia(file);
      form.reset();
      await refreshDashboard();
      setStatus(document.querySelector("#media-status"), "File uploaded and ready to use.");
    } catch (error) {
      console.error("Could not upload media:", error);
      setStatus(document.querySelector("#media-status"), error.message || "The file could not be uploaded.", true);
    } finally {
      button.disabled = false;
    }
  });
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Could not sign out:", error);
    setStatus(document.querySelector("#denied-status"), error.message, true);
  }
}

async function updateSession(session) {
  if (!session?.user) {
    currentUser = null;
    setDashboardVisible(false);
    loginPanel.hidden = false;
    accessDenied.hidden = true;
    setStatus(loginStatus, "");
    return;
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user || userData.user.id !== session.user.id) {
    await supabase.auth.signOut();
    return;
  }
  currentUser = userData.user;
  const { data: profile, error } = await supabase.from("profiles")
    .select("id, full_name, role").eq("id", currentUser.id).single();
  if (error) throw error;
  if (profile.role !== "admin") {
    showAccessDenied();
    return;
  }

  setDashboardVisible(true);
  const name = profile.full_name || "Admin";
  document.querySelector("#account-name").textContent = name;
  document.querySelector("#account-avatar").textContent = [...name][0]?.toUpperCase() || "B";
  document.querySelector("#welcome-name").textContent = name.split(/\s+/)[0];
  document.querySelector("#today-date").textContent = formatDate(new Date().toISOString());
  try {
    await refreshDashboard();
    setStatus(document.querySelector("#dashboard-status"), "");
  } catch (loadError) {
    console.error("Could not load the admin dashboard:", loadError);
    setStatus(document.querySelector("#dashboard-status"), loadError.message || "Dashboard data could not be loaded.", true);
  }
}

async function initialize() {
  if (!isConfigured()) {
    document.querySelector("#setup-note").hidden = false;
    setStatus(loginStatus, "The Supabase connection is not configured.", true);
    loginForm.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
    return;
  }
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  supabase = createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  });
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    const values = new FormData(loginForm);
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus(loginStatus, "Signing in securely...");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(values.get("email") || ""),
        password: String(values.get("password") || ""),
      });
      if (error) throw error;
      loginForm.reset();
    } catch (error) {
      console.error("Admin sign-in failed:", error);
      setStatus(loginStatus, error.message || "Could not sign in. Please try again.", true);
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("#sign-out").addEventListener("click", () => void signOut());
  document.querySelector("#denied-sign-out").addEventListener("click", () => void signOut());
  bindUpdateForm();
  bindMediaForm();
  bindFooterLinksForm();
  supabase.auth.onAuthStateChange((_event, session) => {
    queueMicrotask(() => {
      void updateSession(session).catch((error) => {
        console.error("Could not verify the administrator session:", error);
        setStatus(loginStatus, error.message || "Your admin session could not be verified.", true);
      });
    });
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  await updateSession(data.session);
}

void initialize().catch((error) => {
  console.error("BuildCore admin dashboard could not initialize:", error);
  setStatus(loginStatus, error.message || "The dashboard could not connect. Check your Supabase configuration.", true);
});
