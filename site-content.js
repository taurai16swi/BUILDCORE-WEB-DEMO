
const updatesRoot = document.querySelector("#published-updates");

function renderUpdate(update) {
  const article = document.createElement("article");
  article.className = "published-update-card";

  if (update.cover_image_url) {
    const image = document.createElement("img");
    image.src = update.cover_image_url;
    image.alt = update.title || "BuildCore update";
    image.loading = "lazy";
    image.onerror = () => image.remove();
    article.append(image);
  }

  const meta = document.createElement("div");
  meta.className = "published-update-meta";

  const category = document.createElement("span");
  category.textContent = update.category || "Update";

  const date = document.createElement("time");

  if (update.published_at) {
    date.dateTime = update.published_at;

    const parsedDate = new Date(update.published_at);

    date.textContent = Number.isNaN(parsedDate.getTime())
      ? ""
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
        }).format(parsedDate);
  }

  meta.append(category, date);

  const title = document.createElement("h3");
  title.textContent = update.title || "";

  const excerpt = document.createElement("p");
  excerpt.textContent = update.excerpt || "";

  article.append(meta, title, excerpt);

  if (update.body) {
    const details = document.createElement("details");
    details.className = "published-update-details";

    const summary = document.createElement("summary");
    summary.textContent = "Read the update";

    const body = document.createElement("p");
    body.textContent = update.body;

    details.append(summary, body);
    article.append(details);
  }

  return article;
}

async function loadPublishedUpdates() {
  if (!updatesRoot) return;

  try {
    // Wait for the shared Supabase client to finish initializing.
    const backend = await window.BuildCoreSupabaseReady;
    const supabase = backend?.client;

    if (!supabase) {
      console.info(
        "Published updates are unavailable because Supabase is not configured."
      );
      return;
    }

    const { data, error } = await supabase
      .from("site_updates")
      .select(
        "title, excerpt, body, category, cover_image_url, published_at"
      )
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(6);

    if (error) throw error;

    if (!data || data.length === 0) {
      updatesRoot.replaceChildren();
      return;
    }

    const heading = document.createElement("h3");
    heading.className = "published-updates-heading";
    heading.textContent = "Latest articles, events & updates";

    const grid = document.createElement("div");
    grid.className = "published-update-grid";
    grid.append(...data.map(renderUpdate));

    updatesRoot.replaceChildren(heading, grid);
  } catch (error) {
    console.error("Could not load BuildCore updates:", error);

    updatesRoot.textContent =
      "The latest updates are temporarily unavailable.";
  }
}

void loadPublishedUpdates();
