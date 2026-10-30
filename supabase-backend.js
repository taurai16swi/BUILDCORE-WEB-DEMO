
/* BuildCore Technologies — Supabase backend
   Uses supabase-config.js for the project URL and publishable/anon key.
*/

const BUILDER_DOCUMENTS_BUCKET = "builder-private-documents";
const CHAT_ATTACHMENTS_BUCKET = "chatter-box-attachments";
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const MESSAGE_MAX_CHARACTERS = 200;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const DEPARTMENT_CODES = new Set(["FD", "BD", "MD", "UX", "HW", "OT"]);

const CHAT_BUCKET_MIME_TYPES = new Set([
  ...ALLOWED_MIME_TYPES,
  "text/plain",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const config = window.BUILDCORE_SUPABASE_CONFIG;

/* Other frontend modules can await this promise before using Supabase. */
let resolveSupabaseReady;

window.BuildCoreSupabaseReady = new Promise((resolve) => {
  resolveSupabaseReady = resolve;
});

function bindUnconfiguredAuthNotice() {
  const message =
    "Account sign-up is not connected yet. Add your Supabase project URL and publishable/anon key to supabase-config.js.";

  document
    .querySelectorAll(
      "#signup-form, #login-form, form[data-auth-signup], form[data-auth-login]"
    )
    .forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const target =
          form.querySelector("[data-auth-message]") ||
          form.querySelector(".form-message");

        if (target) target.textContent = message;
      });
    });

  document.querySelectorAll("[data-auth-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      const status = document.querySelector("#home-signup-status");
      if (status) status.textContent = message;
    });
  });
}

function isSupabaseConfigured() {
  return Boolean(
    config &&
      typeof config.url === "string" &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url) &&
      typeof config.anonKey === "string" &&
      config.anonKey.length > 30 &&
      !config.anonKey.includes("YOUR_SUPABASE")
  );
}

function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList?.toggle("is-error", isError);
}

function setFormStatus(form, message, isError = false) {
  setStatus(
    form?.querySelector("[data-auth-message]") ||
      form?.querySelector(".form-message"),
    message,
    isError
  );
}

function safeFilename(filename) {
  const cleaned = String(filename || "upload")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);

  return cleaned || "upload";
}

function getAllowedMimeType(file, allowedTypes = ALLOWED_MIME_TYPES) {
  if (!file) return null;
  if (allowedTypes.has(file.type)) return file.type;

  const extension = file.name.split(".").pop()?.toLowerCase();

  const fallbackType = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    txt: "text/plain",
    zip: "application/zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }[extension];

  return fallbackType && allowedTypes.has(fallbackType)
    ? fallbackType
    : null;
}

function readSkills(form) {
  return [...form.querySelectorAll('input[name="skills"]:checked')].map(
    (input) => ({
      value: input.value,
      department: input.dataset.dept,
    })
  );
}

function renderMessageStatus(message) {
  const chatRoot = document.querySelector(
    "#chatter-box, [data-chatter-box]"
  );

  setStatus(
    chatRoot?.querySelector("[data-chatter-message-status]"),
    message
  );
}

function bindContactSubmissions(supabase) {
  const form = document.querySelector("#contact-form");
  if (!form) return;

  const status = document.querySelector("#contact-message");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const values = new FormData(form);
    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) submitButton.disabled = true;
    setStatus(status, "Sending your message securely...");

    try {
      const { error } = await supabase
        .from("contact_submissions")
        .insert({
          name: String(values.get("name") || "").trim(),
          email: String(values.get("email") || "").trim(),
          inquiry: String(values.get("inquiry") || ""),
          message: String(values.get("message") || "").trim(),
        });

      if (error) throw error;

      form.reset();
      setStatus(
        status,
        "Thanks for getting in touch. Your message has been received."
      );
    } catch (error) {
      console.error("Contact submission failed:", error);
      setStatus(
        status,
        error.message || "Your message could not be sent. Please try again.",
        true
      );
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

async function initializeSupabaseBackend() {
  if (!isSupabaseConfigured()) {
    console.info(
      "BuildCore Supabase is not configured. The local demo remains available."
    );

    bindUnconfiguredAuthNotice();

    /* Prevent dependent modules from waiting forever. */
    resolveSupabaseReady(null);
    return;
  }

  const { createClient } = await import(
    "https://esm.sh/@supabase/supabase-js@2"
  );

  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  });

  let currentUser = null;
  let currentProfile = null;
  let currentBuilderProfile = null;
  let builderIsApproved = false;
  let subscribedUserId = null;
  let chatChannels = [];
  let chatSendInProgress = false;
  let authRevision = 0;

  const renderedMessageIds = new Set();

  const chatRoot = document.querySelector(
    "#chatter-box, [data-chatter-box]"
  );

  const chatterForm = chatRoot?.matches("form")
    ? chatRoot
    : chatRoot?.querySelector("form[data-chatter-form], form");

  const recipientInput = chatRoot?.querySelector(
    '[name="receiver_id"], [data-chatter-recipient]'
  );

  const messageInput = chatRoot?.querySelector(
    'textarea[name="message_content"], textarea[data-chatter-message]'
  );

  const attachmentInput = chatRoot?.querySelector(
    'input[type="file"][name="attachment"], input[type="file"][data-chatter-attachment]'
  );

  const chatLog = chatRoot?.querySelector(
    "[data-chatter-log], .chat-log, #chatter-messages"
  );

  const messageCounter = chatRoot?.querySelector("[data-chatter-count]");

  const sendButton =
    chatRoot?.querySelector("[data-chatter-send]") ||
    chatterForm?.querySelector('button[type="submit"]');

  const accountTypeInput = document.querySelector("#signup-account-type");

  function showBackendUnavailable(error) {
    console.error("BuildCore Supabase backend error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "The backend request failed.";

    setStatus(
      document.querySelector("#builder-message"),
      message,
      true
    );

    setStatus(
      document.querySelector("#contact-message"),
      message,
      true
    );

    setStatus(
      document.querySelector("[data-backend-status]"),
      message,
      true
    );

    setStatus(
      document.querySelector("[data-account-backend-status]"),
      message,
      true
    );

    renderMessageStatus(message);
  }

  function showAuthVisibility(isSignedIn) {
    document.querySelectorAll("[data-auth-dashboard]").forEach((view) => {
      view.hidden = !isSignedIn;
    });

    document
      .querySelectorAll("[data-auth-hide-when-signed-in]")
      .forEach((view) => {
        view.classList.toggle("is-authenticated", isSignedIn);
      });

    document.querySelectorAll("[data-auth-signed-out]").forEach((view) => {
      view.hidden = isSignedIn;
    });

    document.querySelectorAll("details[data-auth-signed-out]").forEach((view) => {
      if (isSignedIn) view.open = false;
    });

    document.querySelectorAll("[data-account-signed-out]").forEach((view) => {
      view.hidden = isSignedIn;
    });

    document.querySelectorAll("[data-builder-application]").forEach((view) => {
      view.hidden = true;
    });

    document
      .querySelectorAll("#user-structural-id, [data-user-id]")
      .forEach((element) => {
        element.textContent = isSignedIn ? currentUser.id : "";
      });
  }

  async function renderBuilderCertificates(paths) {
    const list = document.querySelector("[data-builder-certificates]");
    if (!list) return;

    list.replaceChildren();

    if (!paths.length) {
      const empty = document.createElement("p");
      empty.textContent = "No certificates added yet.";
      list.append(empty);
      return;
    }

    const storage = supabase.storage.from(BUILDER_DOCUMENTS_BUCKET);

    for (const path of paths) {
      const { data, error } = await storage.createSignedUrl(path, 600);
      if (error) throw error;

      const row = document.createElement("div");
      row.className = "account-certificate";

      const label = document.createElement("label");
      const remove = document.createElement("input");
      remove.type = "checkbox";
      remove.name = "remove_certificates";
      remove.value = path;
      label.append(remove, document.createTextNode(" Remove"));

      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = path.split("/").pop().replace(/^[0-9a-f-]{36}-/i, "");

      row.append(link, label);
      list.append(row);
    }
  }

  async function renderAccount(revision) {
    if (!currentUser || !currentProfile) return;

    setStatus(document.querySelector("[data-account-backend-status]"), "");

    const email = document.querySelector("[data-account-email]");
    const role = document.querySelector("[data-account-role]");
    const nameInput = document.querySelector(
      '#account-profile-form input[name="full_name"]'
    );
    const applicationForm = document.querySelector("#builder-form");
    const builderStatus = document.querySelector(
      "[data-account-builder-status]"
    );
    const builderForm = document.querySelector("[data-builder-settings]");
    const application = document.querySelector("[data-builder-application]");

    if (email) email.textContent = currentUser.email || "";
    if (nameInput) nameInput.value = currentProfile.full_name || "";
    if (applicationForm) {
      if (!applicationForm.elements.name.value) {
        applicationForm.elements.name.value = currentProfile.full_name || "";
      }
      if (!applicationForm.elements.email.value) {
        applicationForm.elements.email.value = currentUser.email || "";
      }
    }

    const roleLabels = {
      admin: "Administrator",
      builder: "Builder",
      company: "Company account",
      customer: "Individual account",
    };
    if (role) role.textContent = roleLabels[currentProfile.role] || "BuildCore account";

    if (builderStatus) builderStatus.replaceChildren();
    if (builderForm) builderForm.hidden = true;

    if (currentProfile.role !== "builder") return;

    if (!currentBuilderProfile) {
      if (builderStatus) {
        const prompt = document.createElement("p");
        prompt.textContent =
          "Your builder account is ready. Submit your builder application to be reviewed by the BuildCore team.";
        const link = document.createElement("a");
        link.href = "?page=builders#builder-application";
        link.className = "text-link";
        link.textContent = "Complete your builder application ↗";
        builderStatus.append(prompt, link);
      }
      if (application) application.hidden = false;
      return;
    }

    if (application) application.hidden = true;

    if (!currentBuilderProfile.is_approved) {
      if (builderStatus) {
        const pending = document.createElement("p");
        pending.textContent = `Your builder application (${currentBuilderProfile.builder_tag}) is awaiting BuildCore admin approval.`;
        builderStatus.append(pending);
      }
      return;
    }

    if (builderStatus) {
      const approved = document.createElement("p");
      approved.textContent = `Approved builder · ${currentBuilderProfile.builder_tag}`;
      builderStatus.append(approved);
    }

    if (!builderForm) return;

    builderForm.hidden = false;
    builderForm.elements.business_name.value =
      currentBuilderProfile.business_name || "";
    builderForm.elements.age.value = currentBuilderProfile.age || "";
    builderForm.elements.phone.value = currentBuilderProfile.phone || "";
    builderForm.elements.country.value = currentBuilderProfile.country || "";
    builderForm.elements.location.value = currentBuilderProfile.location || "";
    builderForm.elements.work_experience.value =
      currentBuilderProfile.work_experience || "";
    builderForm.elements.portfolio_url.value =
      currentBuilderProfile.portfolio_url || "";

    const selectedSkills = new Set(currentBuilderProfile.skills || []);
    builderForm
      .querySelectorAll('input[name="skills"]')
      .forEach((input) => {
        input.checked = selectedSkills.has(input.value);
      });

    const status = builderForm.querySelector("[data-builder-settings-status]");
    setStatus(status, "Loading your private certificates...");
    try {
      await renderBuilderCertificates(
        currentBuilderProfile.certificate_paths || []
      );
      if (revision !== authRevision) return;
      setStatus(status, "");
    } catch (error) {
      console.error("Builder certificates could not be loaded:", error);
      setStatus(
        status,
        error.message || "Your certificates could not be loaded.",
        true
      );
    }
  }

  function setChatLocked(allowed, explanation) {
    if (!chatRoot) return;

    chatRoot
      .querySelectorAll("textarea, button, input, select")
      .forEach((control) => {
        control.disabled = !allowed;
      });

    if (messageInput) {
      if (messageCounter && !messageCounter.id) {
        messageCounter.id = "chatter-message-count";
      }

      messageInput.setAttribute(
        "aria-describedby",
        messageCounter?.id || "chatter-message-count"
      );
    }

    if (messageCounter) {
      messageCounter.textContent = `${
        [...(messageInput?.value || "")].length
      }/${MESSAGE_MAX_CHARACTERS}`;
    }

    if (messageInput) {
      messageInput.placeholder = allowed
        ? "Write a message..."
        : explanation;
    }

    renderMessageStatus(explanation);
  }

  function stopRealtime() {
    const oldChannels = chatChannels;

    chatChannels = [];
    subscribedUserId = null;

    oldChannels.forEach((channel) => {
      void supabase.removeChannel(channel).catch((error) => {
        console.error(
          "Could not close the previous chatter channel:",
          error
        );
      });
    });
  }

  function getCurrentChatPartner() {
    const partner = recipientInput?.value.trim();
    return partner && UUID_PATTERN.test(partner) ? partner : null;
  }

  async function createAttachmentLink(message, container) {
    if (!message.attachment_url) return;

    const { data, error } = await supabase.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .createSignedUrl(message.attachment_url, 60 * 60, {
        download: message.file_name || true,
      });

    if (error) throw error;

    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.textContent = message.file_name || "Open attachment";

    container.append(link);
  }

  async function appendChatMessage(message) {
    if (
      !chatLog ||
      !message?.id ||
      renderedMessageIds.has(message.id)
    ) {
      return;
    }

    const partnerId = getCurrentChatPartner();

    if (
      !partnerId ||
      !(
        (message.sender_id === currentUser?.id &&
          message.receiver_id === partnerId) ||
        (message.receiver_id === currentUser?.id &&
          message.sender_id === partnerId)
      )
    ) {
      return;
    }

    renderedMessageIds.add(message.id);

    const item = document.createElement("article");
    item.className = "chat-message";
    item.dataset.messageId = message.id;

    const content = document.createElement("p");
    content.textContent = message.message_content || "";
    item.append(content);

    if (message.attachment_url) {
      try {
        await createAttachmentLink(message, item);
      } catch (error) {
        renderedMessageIds.delete(message.id);

        console.error(
          "Could not create an authorized chat attachment link:",
          error
        );

        renderMessageStatus(
          "This attachment could not be opened. Check your access and try again."
        );
      }
    }

    const timestamp = document.createElement("time");
    timestamp.dateTime = message.created_at;
    timestamp.textContent = new Date(
      message.created_at
    ).toLocaleString();

    item.append(timestamp);
    chatLog.append(item);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function loadChatHistory() {
    if (!currentUser || !chatLog || !getCurrentChatPartner()) return;

    const { data, error } = await supabase
      .from("chatter_box_messages")
      .select(
        "id, sender_id, receiver_id, message_content, attachment_url, file_name, created_at"
      )
      .or(
        `sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`
      )
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) throw error;

    chatLog.replaceChildren();
    renderedMessageIds.clear();

    for (const message of data) {
      await appendChatMessage(message);
    }
  }

  function subscribeToChatMessages(userId) {
    if (!chatRoot || subscribedUserId === userId) return;

    stopRealtime();
    subscribedUserId = userId;

    const ownMessageFilters = [
      { field: "sender_id", name: "sent" },
      { field: "receiver_id", name: "received" },
    ];

    chatChannels = ownMessageFilters.map(({ field, name }) => {
      return supabase
        .channel(
          `buildcore-chatter-${name}-${userId}-${crypto.randomUUID()}`
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chatter_box_messages",
            filter: `${field}=eq.${userId}`,
          },
          (payload) => {
            if (
              currentUser?.id === userId &&
              payload.new.sender_id !== payload.new.receiver_id
            ) {
              void appendChatMessage(payload.new).catch((error) => {
                console.error(
                  "Could not render a live chatter message:",
                  error
                );

                renderMessageStatus(
                  "A new message arrived, but could not be displayed."
                );
              });
            }
          }
        )
        .subscribe((status, error) => {
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT"
          ) {
            const detail = error?.message || status;

            console.error(
              "BuildCore chatter real-time subscription failed:",
              detail
            );

            renderMessageStatus(
              "Live chat could not connect. Check the Supabase Realtime setup."
            );
          }
        });
    });
  }

  async function loadPendingBuilders() {
    const list = document.querySelector("[data-admin-builder-list]");
    if (!list) return;

    list.replaceChildren();

    const status = document.querySelector(
      "[data-admin-builder-status]"
    );

    const { data, error } = await supabase
      .from("builder_profiles")
      .select(
        "id, builder_tag, business_name, age, phone, skills, country, location, work_experience, identity_document_type, identity_document_path, certificate_paths, created_at, profiles!inner(full_name)"
      )
      .eq("is_approved", false)
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!data.length) {
      setStatus(
        status,
        "There are no builder applications waiting for approval."
      );
      return;
    }

    setStatus(
      status,
      `${data.length} builder application${
        data.length === 1 ? "" : "s"
      } awaiting review.`
    );

    data.forEach((builder) => {
      const card = document.createElement("article");
      card.className = "service-card";
      card.dataset.builderId = builder.id;

      const title = document.createElement("h3");
      title.textContent = builder.profiles.full_name;

      const business = document.createElement("p");
      business.textContent = `${builder.business_name} · ${builder.builder_tag}`;

      const skills = document.createElement("p");
      skills.textContent = (builder.skills || []).join(", ");

      const location = document.createElement("p");
      location.textContent = `${builder.location}, ${builder.country}`;

      const approve = document.createElement("button");
      approve.className = "button button-orange";
      approve.type = "button";
      approve.dataset.approveBuilder = builder.id;
      approve.textContent = "Approve builder";

      card.append(title, business, skills, location, approve);
      list.append(card);
    });
  }

  async function updateSession(session, revision) {
    if (revision !== authRevision) return;

    currentUser = session?.user || null;
    currentProfile = null;
    currentBuilderProfile = null;
    builderIsApproved = false;

    if (!currentUser) {
      stopRealtime();
      showAuthVisibility(false);

      document
        .querySelectorAll("[data-admin-dashboard]")
        .forEach((view) => {
          view.hidden = true;
        });

      setChatLocked(
        false,
        "Sign in with an approved builder or admin account to use chat."
      );

      const adminList = document.querySelector(
        "[data-admin-builder-list]"
      );

      if (adminList) adminList.replaceChildren();
      return;
    }

    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError) throw userError;

    if (
      !userData.user ||
      userData.user.id !== currentUser.id
    ) {
      currentUser = null;
      showAuthVisibility(false);
      return;
    }

    currentUser = userData.user;

    const pendingRole = sessionStorage.getItem(
      "buildcore-pending-account-type"
    );

    if (pendingRole) {
      if (!["builder", "customer", "company"].includes(pendingRole)) {
        sessionStorage.removeItem("buildcore-pending-account-type");
        throw new Error(
          "The selected account type is invalid. Please start signup again."
        );
      }

      const { error: roleError } = await supabase.rpc(
        "set_my_account_type",
        {
          requested_role: pendingRole,
        }
      );

      if (roleError) throw roleError;

      sessionStorage.removeItem("buildcore-pending-account-type");
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", currentUser.id)
      .single();

    if (profileError) throw profileError;
    if (revision !== authRevision) return;

    currentProfile = profile;
    showAuthVisibility(true);

    const authorizedAdmin = profile.role === "admin";

    if (profile.role === "builder") {
      const { data: builder, error: builderError } = await supabase
        .from("builder_profiles")
        .select(
          "id, builder_tag, business_name, is_approved, age, phone, skills, work_experience, country, location, portfolio_url, certificate_paths"
        )
        .eq("id", currentUser.id)
        .maybeSingle();

      if (builderError) throw builderError;
      if (revision !== authRevision) return;

      currentBuilderProfile = builder;
      builderIsApproved = builder?.is_approved === true;
    }

    await renderAccount(revision);
    if (revision !== authRevision) return;

    if (authorizedAdmin || builderIsApproved) {
      setChatLocked(
        true,
        "Chat is ready. Messages are private to their participants."
      );

      subscribeToChatMessages(currentUser.id);
    } else {
      stopRealtime();

      setChatLocked(
        false,
        profile.role === "builder"
          ? "Your builder profile must be approved before chat is available."
          : "Chat is available to approved builders and administrators."
      );
    }

    document
      .querySelectorAll("[data-admin-dashboard]")
      .forEach((view) => {
        view.hidden = !authorizedAdmin;
      });

    if (authorizedAdmin) {
      await loadPendingBuilders();
    } else {
      const adminList = document.querySelector(
        "[data-admin-builder-list]"
      );

      if (adminList) adminList.replaceChildren();
    }
  }

  function bindAuthForms() {
    const signupForms = document.querySelectorAll(
      "#signup-form, form[data-auth-signup]"
    );

    signupForms.forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;

        const values = new FormData(form);

        const role =
          form.dataset.role ||
          accountTypeInput?.value ||
          values.get("role") ||
          "customer";

        if (!form.dataset.role && accountTypeInput && !accountTypeInput.value) {
          setFormStatus(
            form,
            "Choose whether you're joining as a regular user, company, or builder.",
            true
          );

          accountTypeInput.focus();
          return;
        }

        if (!["builder", "customer", "company"].includes(role)) {
          setFormStatus(
            form,
            "Choose a regular user, company, or builder account.",
            true
          );
          return;
        }

        setFormStatus(form, "Creating your account...");

        const redirectUrl = new URL(window.location.href);
        redirectUrl.hash = "";
        redirectUrl.searchParams.set(
          "page",
          role === "builder" ? "builders" : "home"
        );

        const redirect = /^https?:$/.test(location.protocol)
          ? { emailRedirectTo: redirectUrl.toString() }
          : {};

        try {
          const { data, error } = await supabase.auth.signUp({
            email: String(values.get("email") || "").trim(),
            password: String(values.get("password") || ""),
            options: {
              data: {
                full_name: String(values.get("full_name") || "").trim(),
                role,
              },
              ...redirect,
            },
          });

          if (error) {
            console.error(
              "BuildCore account registration failed:",
              error
            );

            setFormStatus(form, error.message, true);
            return;
          }

          const confirmation = data.session
            ? "Your account is ready."
            : "Account created. Confirm your email, then sign in to finish your profile.";

          setFormStatus(
            form,
            role === "builder"
              ? `${confirmation} Complete your builder profile to receive your unique BuildCore ID.`
              : confirmation
          );

          form.reset();
        } catch (error) {
          console.error(
            "BuildCore account registration could not reach Supabase:",
            error
          );

          setFormStatus(
            form,
            error.message ||
              "Account registration failed. Check your connection and try again.",
            true
          );
        }
      });
    });

    const loginForms = document.querySelectorAll(
      "#login-form, form[data-auth-login]"
    );

    loginForms.forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;

        const values = new FormData(form);
        setFormStatus(form, "Signing in...");

        try {
          const { error } = await supabase.auth.signInWithPassword({
            email: String(values.get("email") || "").trim(),
            password: String(values.get("password") || ""),
          });

          if (error) {
            console.error("BuildCore sign-in failed:", error);
            setFormStatus(form, error.message, true);
            return;
          }

          setFormStatus(form, "You're signed in.");
        } catch (error) {
          console.error(
            "BuildCore sign-in could not reach Supabase:",
            error
          );

          setFormStatus(
            form,
            error.message ||
              "Sign-in failed. Check your connection and try again.",
            true
          );
        }
      });
    });

    document.querySelectorAll("[data-auth-signout]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const { error } = await supabase.auth.signOut();
          if (error) showBackendUnavailable(error);
        } catch (error) {
          showBackendUnavailable(error);
        }
      });
    });

    document.querySelectorAll("[data-auth-provider]").forEach((button) => {
      button.addEventListener("click", async () => {
        const provider = button.dataset.authProvider;

        if (!["google", "apple", "azure"].includes(provider)) {
          setStatus(
            document.querySelector("#home-signup-status"),
            "This sign-in provider is not supported.",
            true
          );
          return;
        }

        const signupStatus = document.querySelector(
          "#home-signup-status"
        );

        const selectedRole = accountTypeInput?.value;

        if (!["builder", "customer", "company"].includes(selectedRole)) {
          setStatus(
            signupStatus,
            "Choose a regular user, company, or builder account first.",
            true
          );
          return;
        }

        button.disabled = true;

        sessionStorage.setItem(
          "buildcore-pending-account-type",
          selectedRole
        );

        const providerName =
          provider === "azure" ? "Outlook" : provider;

        setStatus(signupStatus, `Connecting to ${providerName}...`);

        try {
          const redirectUrl = new URL(window.location.href);
          redirectUrl.hash = "";
          redirectUrl.searchParams.set(
            "page",
            selectedRole === "builder" ? "builders" : "home"
          );

          const options = {
            redirectTo: redirectUrl.toString(),
          };

          if (provider === "apple") options.scopes = "name email";
          if (provider === "azure") options.scopes = "email";

          const { error } = await supabase.auth.signInWithOAuth({
            provider,
            options,
          });

          if (error) throw error;
        } catch (error) {
          sessionStorage.removeItem("buildcore-pending-account-type");

          console.error(
            `BuildCore ${providerName} OAuth sign-up failed:`,
            error
          );

          setStatus(
            signupStatus,
            error.message ||
              `${providerName} sign-up failed. Please try again.`,
            true
          );

          button.disabled = false;
        }
      });
    });
  }

  function bindBuilderSubmission() {
    const form = document.querySelector("#builder-form");
    const message = document.querySelector("#builder-message");

    if (!form) return;

    const consent = form.querySelector(".consent-check span");

    if (consent) {
      consent.textContent =
        "I agree BuildCore may contact me about opportunities. My identity document and profile will be stored in private Supabase storage for application review.";
    }

    const privacyNote = form.querySelector(".form-privacy");

    if (privacyNote) {
      privacyNote.textContent =
        "Identity documents are private. Only you and authorized BuildCore administrators can access your application. Your profile PDF does not contain document scans.";
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus(message, "");

      if (!form.reportValidity()) return;

      if (!currentUser) {
        setStatus(
          message,
          "Create a builder account or sign in first, then submit your builder profile.",
          true
        );
        return;
      }

      if (currentProfile?.role !== "builder") {
        setStatus(
          message,
          "Sign in with a builder account before submitting a builder profile.",
          true
        );
        return;
      }

      const skills = readSkills(form);

      if (!skills.length) {
        setStatus(
          message,
          "Choose at least one skill to create your profile.",
          true
        );

        form
          .querySelector(".skill-field")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });

        form.querySelector('input[name="skills"]')?.focus();
        return;
      }

      const department = skills[0].department;

      if (!DEPARTMENT_CODES.has(department)) {
        setStatus(
          message,
          "The selected skill does not have a supported Builder ID department code.",
          true
        );
        return;
      }

      const values = new FormData(form);

      const identityFile = form.querySelector(
        '[name="identityDocument"]'
      )?.files?.[0];

      const certificateFiles = [
        ...(form.querySelector('[name="certificates"]')?.files || []),
      ];

      if (!identityFile) {
        setStatus(
          message,
          "Please select your identity document before submitting.",
          true
        );
        return;
      }

      const files = [identityFile, ...certificateFiles];

      const invalidFile = files.find(
        (file) =>
          file.size > DOCUMENT_MAX_BYTES ||
          !getAllowedMimeType(file)
      );

      if (invalidFile) {
        setStatus(
          message,
          invalidFile.size > DOCUMENT_MAX_BYTES
            ? `${invalidFile.name} is larger than 10 MB. Choose a smaller file.`
            : `${invalidFile.name} must be a PDF, JPG, or PNG file.`,
          true
        );
        return;
      }

      const uploadedPaths = [];
      const storage = supabase.storage.from(
        BUILDER_DOCUMENTS_BUCKET
      );

      const uploadDocument = async (file) => {
        const path = `${currentUser.id}/${crypto.randomUUID()}-${safeFilename(file.name)}`;

        const { error } = await storage.upload(path, file, {
          cacheControl: "3600",
          contentType: getAllowedMimeType(file),
          upsert: false,
        });

        if (error) throw error;

        uploadedPaths.push(path);
        return path;
      };

      setStatus(
        message,
        "Uploading your documents to private storage..."
      );

      form
        .querySelectorAll('button[type="submit"]')
        .forEach((button) => {
          button.disabled = true;
        });

      try {
        const identityPath = await uploadDocument(identityFile);
        const certificatePaths = [];

        for (const file of certificateFiles) {
          certificatePaths.push(await uploadDocument(file));
        }

        const businessName =
          String(values.get("businessName") || "").trim() ||
          `Independent Builder — ${String(values.get("name") || "").trim()}`;

        const { data: builder, error: insertError } = await supabase
          .from("builder_profiles")
          .insert({
            id: currentUser.id,
            business_name: businessName,
            department_code: department,
            age: Number(values.get("age")),
            phone: String(values.get("phone") || ""),
            skills: skills.map((skill) => skill.value),
            work_experience: String(values.get("experience") || ""),
            country: String(values.get("country") || ""),
            location: String(values.get("location") || ""),
            portfolio_url:
              String(values.get("portfolio") || "").trim() || null,
            identity_document_type: String(
              values.get("documentType") || ""
            ),
            identity_document_path: identityPath,
            certificate_paths: certificatePaths,
          })
          .select("id, builder_tag, is_approved")
          .single();

        if (insertError) throw insertError;

        if (window.BuildCorePreview?.downloadBuilderPdf) {
          window.BuildCorePreview.downloadBuilderPdf(
            values,
            builder.builder_tag,
            skills,
            false
          );
        }

        setStatus(
          message,
          `Your application was submitted. Builder ID: ${builder.builder_tag}. Your profile PDF is downloading.`
        );

        currentBuilderProfile = {
          ...builder,
          business_name: businessName,
          age: Number(values.get("age")),
          phone: String(values.get("phone") || ""),
          skills: skills.map((skill) => skill.value),
          work_experience: String(values.get("experience") || ""),
          country: String(values.get("country") || ""),
          location: String(values.get("location") || ""),
          portfolio_url: String(values.get("portfolio") || "").trim() || null,
          certificate_paths: certificatePaths,
        };
        await renderAccount(authRevision);
        showBackendVisibility(true);
      } catch (error) {
        console.error("Builder profile submission failed:", error);

        if (uploadedPaths.length) {
          try {
            const { error: cleanupError } =
              await storage.remove(uploadedPaths);

            if (cleanupError) {
              console.error(
                "Could not remove uploaded files after the builder application failed:",
                cleanupError
              );
            }
          } catch (cleanupError) {
            console.error(
              "Could not clean up uploaded files after the builder application failed:",
              cleanupError
            );
          }
        }

        setStatus(
          message,
          error.message ||
            "Your builder profile could not be submitted. Please try again.",
          true
        );
      } finally {
        form
          .querySelectorAll('button[type="submit"]')
          .forEach((button) => {
            button.disabled = false;
          });
      }
    });
  }

  function showBackendVisibility(isVisible) {
    document.querySelectorAll("[data-auth-dashboard]").forEach((view) => {
      view.hidden = !isVisible || !currentUser;
    });
  }

  function bindAccountSettings() {
    const nameForm = document.querySelector("#account-profile-form");
    const builderForm = document.querySelector("#builder-settings-form");

    nameForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!nameForm.reportValidity() || !currentUser) return;

      const name = String(new FormData(nameForm).get("full_name") || "").trim();
      const status = nameForm.querySelector("[data-account-name-status]");
      const button = nameForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(status, "Saving your name...");

      try {
        const { error } = await supabase.rpc("set_my_profile_name", {
          requested_full_name: name,
        });
        if (error) throw error;

        currentProfile.full_name = name;
        setStatus(status, "Your name has been updated.");
      } catch (error) {
        console.error("Account name update failed:", error);
        setStatus(
          status,
          error.message || "Your name could not be updated.",
          true
        );
      } finally {
        if (button) button.disabled = false;
      }
    });

    builderForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!builderForm.reportValidity() || !currentUser) return;

      if (
        currentProfile?.role !== "builder" ||
        !currentBuilderProfile?.is_approved
      ) {
        setStatus(
          builderForm.querySelector("[data-builder-settings-status]"),
          "Only approved builders can update this profile.",
          true
        );
        return;
      }

      const status = builderForm.querySelector(
        "[data-builder-settings-status]"
      );
      const button = builderForm.querySelector('button[type="submit"]');
      const values = new FormData(builderForm);
      const skills = [
        ...builderForm.querySelectorAll('input[name="skills"]:checked'),
      ].map((input) => input.value);
      const files = [
        ...(builderForm.querySelector('[name="new_certificates"]')?.files || []),
      ];

      if (!skills.length) {
        setStatus(status, "Choose at least one skill.", true);
        builderForm.querySelector('input[name="skills"]')?.focus();
        return;
      }

      const invalidFile = files.find(
        (file) =>
          file.size > DOCUMENT_MAX_BYTES || !getAllowedMimeType(file)
      );
      if (invalidFile) {
        setStatus(
          status,
          invalidFile.size > DOCUMENT_MAX_BYTES
            ? `${invalidFile.name} is larger than 10 MB. Choose a smaller file.`
            : `${invalidFile.name} must be a PDF, JPG, or PNG file.`,
          true
        );
        return;
      }

      const existingPaths = currentBuilderProfile.certificate_paths || [];
      const removedPaths = [
        ...builderForm.querySelectorAll(
          'input[name="remove_certificates"]:checked'
        ),
      ].map((input) => input.value);
      const keptPaths = existingPaths.filter(
        (path) => !removedPaths.includes(path)
      );
      const uploadedPaths = [];
      const storage = supabase.storage.from(BUILDER_DOCUMENTS_BUCKET);

      if (button) button.disabled = true;
      setStatus(status, "Saving your builder profile...");

      try {
        for (const file of files) {
          const path = `${currentUser.id}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
          const { error } = await storage.upload(path, file, {
            cacheControl: "3600",
            contentType: getAllowedMimeType(file),
            upsert: false,
          });
          if (error) throw error;
          uploadedPaths.push(path);
        }

        const certificatePaths = [...keptPaths, ...uploadedPaths];
        const { error } = await supabase.rpc(
          "update_my_approved_builder_profile",
          {
            requested_business_name: String(
              values.get("business_name") || ""
            ).trim(),
            requested_age: Number(values.get("age")),
            requested_phone: String(values.get("phone") || "").trim(),
            requested_skills: skills,
            requested_work_experience: String(
              values.get("work_experience") || ""
            ).trim(),
            requested_country: String(values.get("country") || "").trim(),
            requested_location: String(values.get("location") || "").trim(),
            requested_portfolio_url:
              String(values.get("portfolio_url") || "").trim() || null,
            requested_certificate_paths: certificatePaths,
          }
        );
        if (error) throw error;

        currentBuilderProfile = {
          ...currentBuilderProfile,
          business_name: String(values.get("business_name") || "").trim(),
          age: Number(values.get("age")),
          phone: String(values.get("phone") || "").trim(),
          skills,
          work_experience: String(
            values.get("work_experience") || ""
          ).trim(),
          country: String(values.get("country") || "").trim(),
          location: String(values.get("location") || "").trim(),
          portfolio_url:
            String(values.get("portfolio_url") || "").trim() || null,
          certificate_paths: certificatePaths,
        };
        builderForm.reset();
        await renderAccount(authRevision);

        if (removedPaths.length) {
          const { error: removeError } = await storage.remove(removedPaths);
          if (removeError) {
            console.error(
              "Removed builder certificates could not be deleted from storage:",
              removeError
            );
            setStatus(
              status,
              "Your profile was saved, but one or more removed certificate files could not be deleted. Contact BuildCore support.",
              true
            );
            return;
          }
        }

        setStatus(status, "Your builder profile has been updated.");
      } catch (error) {
        console.error("Builder profile update failed:", error);

        if (uploadedPaths.length) {
          try {
            const { error: cleanupError } =
              await storage.remove(uploadedPaths);

            if (cleanupError) {
              console.error(
                "New certificate uploads could not be cleaned up after the profile update failed:",
                cleanupError
              );
            }
          } catch (cleanupError) {
            console.error(
              "New certificate uploads could not be cleaned up after the profile update failed:",
              cleanupError
            );
          }
        }

        setStatus(
          status,
          error.message || "Your builder profile could not be updated.",
          true
        );
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  function bindAdminApprovals() {
    const list = document.querySelector("[data-admin-builder-list]");
    if (!list) return;

    list.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-approve-builder]");

      if (!button || currentProfile?.role !== "admin") return;

      button.disabled = true;

      const builderId = button.dataset.approveBuilder;

      try {
        const { error } = await supabase
          .from("builder_profiles")
          .update({ is_approved: true })
          .eq("id", builderId)
          .eq("is_approved", false);

        if (error) throw error;

        await loadPendingBuilders();
      } catch (error) {
        button.disabled = false;
        console.error("Builder approval failed:", error);

        setStatus(
          document.querySelector("[data-admin-builder-status]"),
          error.message || "Builder approval failed.",
          true
        );
      }
    });
  }

  async function sendChatMessage() {
    if (chatSendInProgress) return;

    if (
      !currentUser ||
      !(
        currentProfile?.role === "admin" ||
        (currentProfile?.role === "builder" && builderIsApproved)
      )
    ) {
      renderMessageStatus(
        "Chat is available only to approved builders and administrators."
      );
      return;
    }

    const receiverId = recipientInput?.value.trim() || "";

    if (!UUID_PATTERN.test(receiverId)) {
      renderMessageStatus("Enter the recipient's Supabase user ID.");
      recipientInput?.focus();
      return;
    }

    if (receiverId === currentUser.id) {
      renderMessageStatus("Choose another user as the recipient.");
      return;
    }

    const content = messageInput?.value || "";
    const characterCount = [...content].length;
    const file = attachmentInput?.files?.[0] || null;

    if (characterCount > MESSAGE_MAX_CHARACTERS) {
      renderMessageStatus(
        `Messages must be ${MESSAGE_MAX_CHARACTERS} characters or fewer.`
      );
      return;
    }

    if (!content.trim() && !file) {
      renderMessageStatus(
        "Write a message or attach a file before sending."
      );
      return;
    }

    if (
      file &&
      (
        file.size > CHAT_ATTACHMENT_MAX_BYTES ||
        !getAllowedMimeType(file, CHAT_BUCKET_MIME_TYPES)
      )
    ) {
      renderMessageStatus(
        "Attachments must be an approved file type and no larger than 5 MB."
      );

      if (attachmentInput) attachmentInput.value = "";
      return;
    }

    chatSendInProgress = true;
    if (sendButton) sendButton.disabled = true;

    let uploadedPath = null;

    try {
      if (file) {
        uploadedPath = `${currentUser.id}/${crypto.randomUUID()}-${safeFilename(file.name)}`;

        const { error: uploadError } = await supabase.storage
          .from(CHAT_ATTACHMENTS_BUCKET)
          .upload(uploadedPath, file, {
            cacheControl: "3600",
            contentType: getAllowedMimeType(
              file,
              CHAT_BUCKET_MIME_TYPES
            ),
            upsert: false,
          });

        if (uploadError) throw uploadError;
      }

      const { data: message, error } = await supabase
        .from("chatter_box_messages")
        .insert({
          sender_id: currentUser.id,
          receiver_id: receiverId,
          message_content: content.trim() || null,
          attachment_url: uploadedPath,
          file_name: file?.name || null,
        })
        .select(
          "id, sender_id, receiver_id, message_content, attachment_url, file_name, created_at"
        )
        .single();

      if (error) throw error;

      await appendChatMessage(message);

      if (messageInput) messageInput.value = "";
      if (attachmentInput) attachmentInput.value = "";

      if (messageCounter) {
        messageCounter.textContent = `0/${MESSAGE_MAX_CHARACTERS}`;
      }

      renderMessageStatus("Message sent.");
    } catch (error) {
      console.error("Sending a chatter message failed:", error);

      if (uploadedPath) {
        try {
          const { error: cleanupError } = await supabase.storage
            .from(CHAT_ATTACHMENTS_BUCKET)
            .remove([uploadedPath]);

          if (cleanupError) {
            console.error(
              "Could not remove an unsent chat attachment:",
              cleanupError
            );
          }
        } catch (cleanupError) {
          console.error(
            "Could not clean up an unsent chat attachment:",
            cleanupError
          );
        }
      }

      renderMessageStatus(
        error.message || "Your message could not be sent. Please try again."
      );
    } finally {
      chatSendInProgress = false;

      if (
        sendButton &&
        (
          currentProfile?.role === "admin" ||
          (currentProfile?.role === "builder" && builderIsApproved)
        )
      ) {
        sendButton.disabled = false;
      }
    }
  }

  function bindChatterBox() {
    if (!chatRoot) return;

    setChatLocked(
      false,
      "Sign in with an approved builder or admin account to use chat."
    );

    if (messageInput) {
      messageInput.addEventListener("input", () => {
        const characters = [...messageInput.value];

        if (characters.length > MESSAGE_MAX_CHARACTERS) {
          messageInput.value = characters
            .slice(0, MESSAGE_MAX_CHARACTERS)
            .join("");
        }

        if (messageCounter) {
          messageCounter.textContent = `${
            [...messageInput.value].length
          }/${MESSAGE_MAX_CHARACTERS}`;
        }
      });
    }

    if (attachmentInput) {
      attachmentInput.addEventListener("change", () => {
        const file = attachmentInput.files?.[0];
        if (!file) return;

        if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
          window.alert(
            "This attachment exceeds the 5 MB limit. Choose a smaller file."
          );

          attachmentInput.value = "";
          renderMessageStatus(
            "Choose an attachment no larger than 5 MB."
          );
          return;
        }

        if (!getAllowedMimeType(file, CHAT_BUCKET_MIME_TYPES)) {
          window.alert(
            "This attachment type is not supported. Choose a PDF, image, text file, DOCX, or ZIP."
          );

          attachmentInput.value = "";
          renderMessageStatus("Choose a supported attachment type.");
        }
      });
    }

    chatRoot
      .querySelector("[data-chatter-attach]")
      ?.addEventListener("click", () => {
        attachmentInput?.click();
      });

    recipientInput?.addEventListener("change", () => {
      renderedMessageIds.clear();

      void loadChatHistory().catch(showBackendUnavailable);
    });

    chatterForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      void sendChatMessage();
    });

    if (!chatterForm && sendButton) {
      sendButton.addEventListener("click", () => {
        void sendChatMessage();
      });
    }
  }

  /* Connect all existing frontend forms and controls. */
  bindAuthForms();
  bindBuilderSubmission();
  bindAccountSettings();
  bindAdminApprovals();
  bindChatterBox();
  bindContactSubmissions(supabase);

  window.BuildCoreSupabase = {
    client: supabase,

    async signUp({
      email,
      password,
      fullName,
      role = "customer",
    }) {
      if (!["builder", "customer", "company"].includes(role)) {
        throw new Error(
          "New accounts can only be regular users, companies, or builders."
        );
      }

      return supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role,
          },
        },
      });
    },

    signIn: (email, password) =>
      supabase.auth.signInWithPassword({ email, password }),

    signOut: () => supabase.auth.signOut(),
  };

  /* Release dependent modules once the client is ready. */
  resolveSupabaseReady(window.BuildCoreSupabase);

  supabase.auth.onAuthStateChange((_event, session) => {
    const revision = ++authRevision;

    queueMicrotask(() => {
      void updateSession(session, revision).catch(
        showBackendUnavailable
      );
    });
  });
}

initializeSupabaseBackend().catch((error) => {
  console.error(
    "BuildCore Supabase initialization failed:",
    error
  );

  const message =
    "Supabase could not initialize. Check the project URL, publishable/anon key, network connection, and SDK import.";

  setStatus(
    document.querySelector("[data-backend-status]"),
    message,
    true
  );

  setStatus(
    document.querySelector("#builder-message"),
    message,
    true
  );

  setStatus(
    document.querySelector("#contact-message"),
    message,
    true
  );

  /* Release dependent modules even if initialization fails. */
  resolveSupabaseReady(null);
});
